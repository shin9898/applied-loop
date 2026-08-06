import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { runHeadlessLLM, parseLLMJson, HeadlessLLMError } from "@/lib/headless-llm";
import {
  activeGoalsPromptBlock,
  applyGoalSuggestionsFromGrade,
} from "@/lib/goal";
import {
  activeRequirementsPromptBlock,
  applyRequirementSuggestions,
  refreshRequirementsForGate,
} from "@/lib/requirement";
import { serializeGradePayload } from "@/lib/grade-payload";
import { readTutorialState } from "@/lib/tutorial-state";

// 発火抑制ルール (ADR-0006 §2)。チューニングはここを変えるだけでよい
export const GATE_THROTTLE_HOURS = 4;
export const GATE_DAILY_CAP = 3;
export const GATE_BACKLOG_CAP = 5;
/** request_gate / generateGate が LLM に渡す diff 上限（超分は切り捨て。DB には保存しない） */
export const DIFF_MAX_CHARS = 8000;

const RETRY_DELAY_MS = 72 * 3600 * 1000; // 72h ルール
const SR_BASE_DAYS = 7;
const SR_MAX_DAYS = 60;
const PERFECT_INTERVAL_CAP_DAYS = 14; // ADR-0010: 全観点 score=2 時の延長上限
const RESOURCE_KINDS = new Set(["doc", "file", "commit", "adr"]);
const ROOT_CAUSES = new Set(["knowledge", "verification", "premise"]);

const execFileAsync = promisify(execFile);

export type RootCause = "knowledge" | "verification" | "premise";

export type GateResource = { kind: string; label: string; ref: string };
export type RubricScore = {
  aspect: string;
  score: 0 | 1 | 2;
  note: string;
  teach?: string;
  model?: string;
};

export type EventInput = {
  kind: string;
  repo: string;
  repoPath?: string;
  ref: string;
  summary?: string;
};

export type RecordEventResult =
  | { outcome: "fired"; eventId: string }
  | { outcome: "skipped"; eventId: string; reason: string }
  | { outcome: "duplicate" };

/**
 * イベントを記録し発火判定する (ADR-0006 §2)。
 * fired の場合、呼び出し元は generateGate を非同期で実行すること。
 */
export async function recordEvent(input: EventInput): Promise<RecordEventResult> {
  const key = { kind: input.kind, repo: input.repo, ref: input.ref };
  const existing = await prisma.devEvent.findUnique({
    where: { kind_repo_ref: key },
  });
  if (existing) return { outcome: "duplicate" };

  const skip = await checkThrottle(input.repo);
  const event = await prisma.devEvent.create({
    data: {
      ...key,
      repoPath: input.repoPath ?? null,
      summary: input.summary?.slice(0, 200) ?? null,
      fired: !skip,
      skipReason: skip ?? null,
    },
  });
  if (skip) return { outcome: "skipped", eventId: event.id, reason: skip };
  return { outcome: "fired", eventId: event.id };
}

async function checkThrottle(repo: string): Promise<string | null> {
  const pendingCount = await prisma.gate.count({ where: { status: "pending" } });
  if (pendingCount >= GATE_BACKLOG_CAP) return "backlog";

  // B2-3: チュートリアル完了前は時間・日次キャップを免除（初日1件を通す）
  const tutorialOpen = !readTutorialState().completedAt;
  if (tutorialOpen) return null;

  const since = new Date(Date.now() - GATE_THROTTLE_HOURS * 3600 * 1000);
  const recentGate = await prisma.gate.findFirst({
    where: { event: { repo }, createdAt: { gte: since } },
    select: { id: true },
  });
  if (recentGate) return "throttled";

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = await prisma.gate.count({
    where: { createdAt: { gte: dayStart } },
  });
  if (todayCount >= GATE_DAILY_CAP) return "daily_cap";

  return null;
}

/** diff 本文を切り詰め（ADR-0006: DB には保存しない） */
export function truncateDiffForGate(diff: string): string {
  const trimmed = diff.trim();
  if (!trimmed) return "";
  return trimmed.length > DIFF_MAX_CHARS
    ? `${trimmed.slice(0, DIFF_MAX_CHARS)}\n...(truncated)`
    : trimmed;
}

/** ローカルの git から diff を取得する (repoPath は execFile の引数としてのみ使用) */
async function getDiff(repoPath: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "show", ref, "--format=%s%n%b", "--unified=3", "--no-color"],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    const trimmed = truncateDiffForGate(stdout);
    return trimmed || null;
  } catch {
    return null;
  }
}

type GeneratedQuestion = {
  question: string;
  principle?: string;
  target_concept?: string;
  targetConcept?: string;
  domain?: string;
  context_summary?: string;
  contextSummary?: string;
  rubric?: unknown;
  resources?: unknown;
  requirement_suggestions?: unknown;
  requirementSuggestions?: unknown;
};

function normalizeRubricCriteria(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, 3);
  return items.length > 0 ? items : null;
}

function normalizeResources(raw: unknown): GateResource[] | null {
  if (!Array.isArray(raw)) return null;
  const items: GateResource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = typeof r.kind === "string" ? r.kind.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const ref = typeof r.ref === "string" ? r.ref.trim() : "";
    if (!RESOURCE_KINDS.has(kind) || !label || !ref) continue;
    items.push({ kind, label, ref });
  }
  return items.length > 0 ? items : null;
}

type QuestionBuildOk = {
  ok: true;
  question: string;
  targetConcept: string | null;
  domain: string | null;
  contextSummary: string | null;
  rubric: string[] | null;
  resources: GateResource[] | null;
  reqSuggestions: unknown;
};

type QuestionBuildFail = {
  ok: false;
  reason: "gen_failed" | "gen_failed_auth" | "gen_failed_parse";
};

async function buildQuestionFromDiff(
  diff: string,
): Promise<QuestionBuildOk | QuestionBuildFail> {
  const reqBlock = await activeRequirementsPromptBlock();
  const reqJson = reqBlock
    ? ',"requirement_suggestions":["requirementId",...]'
    : "";

  const prompt = [
    "以下の git diff (事例) から、理解度ゲートの問いを1つ生成せよ。2段階で考えよ。",
    "",
    "【第1段階: 原則抽出】",
    "diff から、他の状況・プロジェクトでも転用できる一般原則を1つ抽出せよ。",
    "原則は具体的な関数名・リポジトリ名・列名に依存せず、将来の実務で判断の指針になる粒度にすること。",
    "悪い例: 「NotificationRepository.Save の INSERT は fallback_reason 列を含まない」",
    "良い例: 「永続化の正しさは書き込み時点だけでなく、読み戻し・失敗時を含むライフサイクル全体で確認する」",
    "",
    "【第2段階: 出題】",
    "抽出した原則を問う問題を、次の4型のいずれか1つで作れ。",
    "  diagnosis (診断): 「この症状が出た時、どこから切り分けるか手順を説明せよ」",
    "  transfer (転用): 「この原則を別の状況 X に適用するとどうなるか」",
    "  judgment (判断): 「なぜこの設計判断をしたか。代替案とのトレードオフを説明せよ」",
    "  prevention (予防): 「この失敗を次回未然に防ぐために何を仕組み化すべきか」",
    "",
    "【禁止】",
    "穴埋め形式 (_____ や空欄補充) は禁止。",
    "「この時の Lesson は?」「この変更の要点は?」のような事例固有の暗記クイズは禁止。",
    "問題文にリポジトリ名・関数名・列名などの固有情報を並べて主役にしないこと。原則が主役。固有情報は必要最小限の文脈ヒントに留める。",
    "",
    "測るのは概念の本質の理解と調査力であり、記憶力ではない。",
    "rubric は合否を分ける概念の本質の観点を最大3つ。",
    "resources は回答時に参照できる一次情報。kind は doc(URL) / file(リポジトリ内パス) / commit(sha) / adr(docs/adr 内参照)。",
    "resources.ref は参照のみ (ファイル本文は含めない)。存在しそうな URL/パスを推定してよい。",
    'domain は大分類の短いラベル (例: "TypeScript / MCP", "PdM / 設計", "DB / Prisma")。',
    "context_summary は「このコミットでやったこと」の 2-3 行要約。回答のヒントや正解を書かない。前提の思い出し用。",
    "principle は第1段階で抽出した一般原則。target_concept にも同じ原則を入れてよい。",
    reqBlock ?? "",
    "出題は日本語で。JSON のみで出力:",
    `{"principle":"...","question":"...","type":"diagnosis"|"transfer"|"judgment"|"prevention","target_concept":"...","domain":"...","context_summary":"...","rubric":["観点1","観点2"],"resources":[{"kind":"doc","label":"...","ref":"https://..."}]${reqJson}}`,
    "",
    "<diff>",
    diff,
    "</diff>",
  ]
    .filter(Boolean)
    .join("\n");

  let parsed: GeneratedQuestion | null = null;
  try {
    parsed = parseLLMJson<GeneratedQuestion>(await runHeadlessLLM(prompt));
  } catch (e) {
    if (
      e instanceof HeadlessLLMError &&
      (e.kind === "auth" || e.kind === "quota")
    ) {
      return { ok: false, reason: "gen_failed_auth" };
    }
    return { ok: false, reason: "gen_failed" };
  }
  if (!parsed?.question?.trim()) {
    return { ok: false, reason: "gen_failed_parse" };
  }

  const targetConcept =
    (typeof parsed.principle === "string" && parsed.principle.trim()) ||
    (typeof parsed.target_concept === "string" &&
      parsed.target_concept.trim()) ||
    (typeof parsed.targetConcept === "string" &&
      parsed.targetConcept.trim()) ||
    null;
  const domain =
    typeof parsed.domain === "string" && parsed.domain.trim()
      ? parsed.domain.trim().slice(0, 80)
      : null;
  const contextSummary =
    (typeof parsed.context_summary === "string" &&
      parsed.context_summary.trim()) ||
    (typeof parsed.contextSummary === "string" &&
      parsed.contextSummary.trim()) ||
    null;

  return {
    ok: true,
    question: parsed.question.trim(),
    targetConcept,
    domain,
    contextSummary: contextSummary ? contextSummary.slice(0, 600) : null,
    rubric: normalizeRubricCriteria(parsed.rubric),
    resources: normalizeResources(parsed.resources),
    reqSuggestions:
      parsed.requirement_suggestions ?? parsed.requirementSuggestions,
  };
}

/** 発火したイベントから出題を生成して Gate を作成する (非同期ジョブ)。
 *  失敗は skipReason を gen_failed* に更新して記録する (認証切れは要ユーザー対応) */
export async function generateGate(eventId: string): Promise<void> {
  const event = await prisma.devEvent.findUnique({ where: { id: eventId } });
  if (!event || !event.fired) return;

  const fail = async (reason: string) => {
    await prisma.devEvent.update({
      where: { id: eventId },
      data: { fired: false, skipReason: reason },
    });
  };

  if (!event.repoPath) return fail("gen_failed");
  const diff = await getDiff(event.repoPath, event.ref);
  if (!diff) return fail("gen_failed_diff");

  const built = await buildQuestionFromDiff(diff);
  if (!built.ok) return fail(built.reason);

  const gate = await prisma.gate.create({
    data: {
      eventId,
      kind: "initial",
      question: built.question,
      targetConcept: built.targetConcept,
      domain: built.domain,
      contextSummary: built.contextSummary,
      rubricCriteria: built.rubric ? JSON.stringify(built.rubric) : null,
      resources: built.resources ? JSON.stringify(built.resources) : null,
    },
  });

  try {
    const { recordActivationOnce } = await import("@/lib/activation-funnel");
    recordActivationOnce("first_supply", { source: "hook", gateId: gate.id });
  } catch {
    /* ignore */
  }

  await applyRequirementSuggestions(built.reqSuggestions, {
    targetType: "gate",
    targetId: gate.id,
  }).catch((e) =>
    console.error("[requirement] apply suggestions from generateGate failed:", e),
  );
}

export type RequestGateResult =
  | {
      ok: true;
      gateId: string;
      question: string;
      contextSummary: string | null;
      domain: string | null;
    }
  | {
      ok: false;
      code:
        | "empty_diff"
        | "backlog"
        | "gen_failed"
        | "gen_failed_auth"
        | "gen_failed_parse";
      message: string;
    };

/**
 * 会話からの供給（ADR-0019 P1 B1-2）。
 * diff は引数で受け取り、DB には保存しない。DevEvent も作らない。
 */
export async function requestGateFromDiff(input: {
  diff: string;
  repo?: string | null;
  summary?: string | null;
}): Promise<RequestGateResult> {
  const diff = truncateDiffForGate(input.diff);
  if (!diff) {
    return {
      ok: false,
      code: "empty_diff",
      message: "diff が空です。変更差分を渡してください。",
    };
  }

  const pendingCount = await prisma.gate.count({
    where: { status: "pending" },
  });
  if (pendingCount >= GATE_BACKLOG_CAP) {
    return {
      ok: false,
      code: "backlog",
      message: `未回答のしれんが ${GATE_BACKLOG_CAP} 件以上ある。先に list_pending_gates で解くか片付けること。`,
    };
  }

  const built = await buildQuestionFromDiff(diff);
  if (!built.ok) {
    const messages: Record<QuestionBuildFail["reason"], string> = {
      gen_failed: "しれんの生成に失敗した。採点 CLI（claude/codex）と認証を確認せよ。",
      gen_failed_auth:
        "しれん生成が認証で止まった。claude / codex にログインし直して再実行せよ。",
      gen_failed_parse: "しれん生成の応答を読めなかった。もう一度 request_gate せよ。",
    };
    return {
      ok: false,
      code: built.reason,
      message: messages[built.reason],
    };
  }

  const repoHint = input.repo?.trim().slice(0, 80) || null;
  const summaryHint = input.summary?.trim().slice(0, 200) || null;
  const contextSummary =
    built.contextSummary ||
    [summaryHint, repoHint ? `repo: ${repoHint}` : null, "（会話からの request_gate）"]
      .filter(Boolean)
      .join("\n") ||
    null;

  const gate = await prisma.gate.create({
    data: {
      kind: "initial",
      question: built.question,
      targetConcept: built.targetConcept,
      domain: built.domain,
      contextSummary: contextSummary ? contextSummary.slice(0, 600) : null,
      rubricCriteria: built.rubric ? JSON.stringify(built.rubric) : null,
      resources: built.resources ? JSON.stringify(built.resources) : null,
    },
  });

  await applyRequirementSuggestions(built.reqSuggestions, {
    targetType: "gate",
    targetId: gate.id,
  }).catch((e) =>
    console.error(
      "[requirement] apply suggestions from requestGateFromDiff failed:",
      e,
    ),
  );

  try {
    const { recordActivationOnce } = await import("@/lib/activation-funnel");
    recordActivationOnce("first_supply", {
      source: "request_gate",
      gateId: gate.id,
    });
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    gateId: gate.id,
    question: gate.question,
    contextSummary: gate.contextSummary,
    domain: gate.domain,
  };
}

/** 直近24時間の出題生成失敗 (認証切れ検知用) */
export async function recentGenFailures(): Promise<{ auth: number; other: number }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const failures = await prisma.devEvent.findMany({
    where: { skipReason: { startsWith: "gen_failed" }, receivedAt: { gte: since } },
    select: { skipReason: true },
  });
  return {
    auth: failures.filter((f) => f.skipReason === "gen_failed_auth").length,
    other: failures.filter((f) => f.skipReason !== "gen_failed_auth").length,
  };
}

type GradeResult = {
  verdict?: "pass" | "fail" | string;
  passed?: boolean;
  feedback?: string;
  /** 不合格時必須寄り: 実際の仕組み・正しいモデル（2-4文） */
  correct_model?: string | null;
  correctModel?: string | null;
  misconception?: string | null;
  misconceptions?: string[];
  root_cause?: string | null;
  rootCause?: string | null;
  rubric?: unknown;
  goal_suggestions?: unknown;
};

function normalizeRootCause(raw: unknown): RootCause | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return ROOT_CAUSES.has(v) ? (v as RootCause) : null;
}

/** Capture.sourceContext 用: gateId と任意の rootCause をエンコード */
export function encodeGateSourceContext(
  gateId: string,
  rootCause?: RootCause | null
): string {
  return rootCause ? `gateId:${gateId};rootCause:${rootCause}` : `gateId:${gateId}`;
}

/** Capture.sourceContext から gateId / rootCause を取り出す */
export function parseGateSourceContext(raw: string | null | undefined): {
  gateId: string | null;
  rootCause: RootCause | null;
} {
  if (!raw) return { gateId: null, rootCause: null };
  const gateMatch = raw.match(/(?:^|[;|])gateId:([^;|\s]+)/);
  const causeMatch = raw.match(/(?:^|[;|])rootCause:([^;|\s]+)/);
  const gateId = gateMatch?.[1]?.trim() || null;
  // 旧形式: "gateId:xxx" のみ (セミコロンなし)
  const legacyGateId =
    !gateId && raw.startsWith("gateId:")
      ? raw.slice("gateId:".length).split(/[;\s]/)[0]?.trim() || null
      : null;
  return {
    gateId: gateId ?? legacyGateId,
    rootCause: normalizeRootCause(causeMatch?.[1] ?? null),
  };
}

function normalizeRubricResult(raw: unknown): RubricScore[] | null {
  if (!Array.isArray(raw)) return null;
  const items: RubricScore[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const aspect = typeof r.aspect === "string" ? r.aspect.trim() : "";
    const score = r.score;
    if (!aspect || (score !== 0 && score !== 1 && score !== 2)) continue;
    const teach =
      typeof r.teach === "string" && r.teach.trim()
        ? r.teach.trim()
        : typeof r.teach_prompt === "string" && r.teach_prompt.trim()
          ? r.teach_prompt.trim()
          : undefined;
    const model =
      typeof r.model === "string" && r.model.trim()
        ? r.model.trim()
        : typeof r.model_answer === "string" && r.model_answer.trim()
          ? r.model_answer.trim()
          : undefined;
    items.push({
      aspect,
      score,
      note: typeof r.note === "string" ? r.note.trim() : "",
      ...(teach ? { teach } : {}),
      ...(model ? { model } : {}),
    });
  }
  return items.length > 0 ? items : null;
}

function resolveVerdict(result: GradeResult): boolean | null {
  if (result.verdict === "pass") return true;
  if (result.verdict === "fail") return false;
  if (typeof result.passed === "boolean") return result.passed;
  return null;
}

/**
 * B11-2: 同一 Q/A を2回採点し、verdict 一致を測る（DB 非破壊）。
 */
export async function spotCheckGradeConsistency(input: {
  question: string;
  answer: string;
  diff?: string | null;
  rubricCriteria?: string[] | null;
}): Promise<{
  a: boolean | null;
  b: boolean | null;
  agree: boolean;
}> {
  const goalsBlock = await activeGoalsPromptBlock();
  const criteria = input.rubricCriteria ?? null;
  const r1 = await callGradingLLM(
    input.diff ?? null,
    input.question,
    input.answer,
    criteria,
    goalsBlock,
  );
  const r2 = await callGradingLLM(
    input.diff ?? null,
    input.question,
    input.answer,
    criteria,
    goalsBlock,
  );
  const a = r1 ? resolveVerdict(r1) : null;
  const b = r2 ? resolveVerdict(r2) : null;
  return { a, b, agree: a !== null && b !== null && a === b };
}

function extractMisconceptions(result: GradeResult): string[] {
  if (Array.isArray(result.misconceptions)) {
    return result.misconceptions.filter((c): c is string => typeof c === "string");
  }
  if (typeof result.misconception === "string" && result.misconception.trim()) {
    return [result.misconception.trim()];
  }
  return [];
}

async function callGradingLLM(
  diff: string | null,
  question: string,
  answer: string,
  rubricCriteria: string[] | null,
  goalsBlock: string | null
): Promise<GradeResult | null> {
  const rubricBlock = rubricCriteria?.length
    ? `採点観点 (rubric): ${JSON.stringify(rubricCriteria)}\n各観点について score 0=欠落 / 1=部分的 / 2=押さえている で採点せよ。`
    : "rubric は空配列でよい。";
  const goalJson = goalsBlock
    ? ',"goal_suggestions":["goalId",...]'
    : "";
  const prompt = [
    "以下の git diff と、それについての問いへの回答を採点せよ。",
    "判定は「概念の本質を説明できているか」で行い、記憶の正確さではなく理解を見る。厳しすぎる部分点は不要。",
    "verdict は合否の最終判断。スコアから機械計算せず、あなたの判断をそのまま書け。",
    "不合格 (fail) のとき必須の3点を分けて書け:",
    "  feedback: 回答のどこがどうずれていたか（学習者向け。合否理由）。",
    "  correct_model: 実際の仕組み・正しいモデルの短い説明（2-4文。正解を暗記させるのではなく、頭の中のモデルを差し替える文）。",
    "  misconception: コードに依存しない抽象的な誤解の記述。なければ null。",
    "合格 (pass) では correct_model は null でよい。feedback は短い称賛と要点でよい。",
    "root_cause は misconception がある場合のみ必須。主因を1つだけ選べ:",
    '  knowledge=知識不足 / verification=確認不足(AI出力の鵜呑み) / premise=前提の誤認。',
    "分類不能なら null (推測で埋めない)。misconception が null なら root_cause も null。",
    "rubric の各要素:",
    "  aspect: 評価ラベル（内部用）",
    "  note: 欠落・部分点の評価者メモ（学習者の出題文には使わない）",
    "  score が 0 または 1 のとき必須:",
    "    teach: 学習者へのミニチェック問い（『どのXか』のような名前当てにせず、パターン／原因を問う）",
    "    model: 答え合わせ用の肯定文1-2文（『〜がない』ではなく『こう言えるとよい』）",
    "  score が 2 なら teach/model は省略可。",
    rubricBlock,
    goalsBlock ?? "",
    `JSON のみで出力: {"verdict":"pass"|"fail","feedback":"...","correct_model":"..."|null,"misconception":"..."|null,"root_cause":"knowledge"|"verification"|"premise"|null,"rubric":[{"aspect":"...","score":0|1|2,"note":"...","teach":"...","model":"..."}]${goalJson}}`,
    "",
    diff ? `<diff>\n${diff}\n</diff>` : "(diff なし。問いと回答のみで採点)",
    `<question>\n${question}\n</question>`,
    `<answer>\n${answer}\n</answer>`,
  ]
    .filter(Boolean)
    .join("\n");
  return parseLLMJson<GradeResult>(await runHeadlessLLM(prompt));
}

/**
 * 回答を採点する (非同期ジョブ。状態機械は ADR-0006 §5)。
 * 失敗モード: パース失敗は1回リトライ、CLI/認証エラーは grading_failed。
 */
export async function gradeGate(gateId: string): Promise<void> {
  const gate = await prisma.gate.findUnique({
    where: { id: gateId },
    include: { event: true },
  });
  if (!gate || !gate.answer || gate.status !== "answered") return;

  await prisma.gate.update({ where: { id: gateId }, data: { status: "grading" } });

  let diff: string | null = null;
  if (gate.event?.repoPath && gate.event?.ref) {
    diff = await getDiff(gate.event.repoPath, gate.event.ref);
  }

  let criteria: string[] | null = null;
  if (gate.rubricCriteria) {
    try {
      criteria = normalizeRubricCriteria(JSON.parse(gate.rubricCriteria));
    } catch {
      criteria = null;
    }
  }

  // active Goal があるときだけ採点 JSON に goal_suggestions を乗せる (ADR-0008)
  const goalsBlock = await activeGoalsPromptBlock();

  let result: GradeResult | null = null;
  try {
    result = await callGradingLLM(
      diff,
      gate.question,
      gate.answer,
      criteria,
      goalsBlock
    );
    if (!result || resolveVerdict(result) === null) {
      // パース失敗 or verdict 欠損: 1回だけリトライ
      result = await callGradingLLM(
        diff,
        gate.question,
        gate.answer,
        criteria,
        goalsBlock
      );
    }
  } catch (e) {
    const reason =
      e instanceof HeadlessLLMError
        ? e.kind === "auth"
          ? `${e.message} 認証を直してから再採点してください。`
          : e.kind === "quota"
            ? `${e.message} 枠が戻ってから再採点してください。`
            : e.message
        : "採点の呼び出しに失敗しました。";
    await prisma.gate.update({
      where: { id: gateId },
      data: { status: "grading_failed", gradeNote: reason },
    });
    return;
  }

  const passed = result ? resolveVerdict(result) : null;
  if (passed === null) {
    await prisma.gate.update({
      where: { id: gateId },
      data: {
        status: "grading_failed",
        gradeNote: "採点結果を読み取れませんでした。リトライしてください。",
      },
    });
    return;
  }

  // rubricResult 欠損時は合否のみ記録 (ADR-0007: 合否の信頼性優先)
  const rubric = result ? normalizeRubricResult(result.rubric) : null;
  const misconceptions = result ? extractMisconceptions(result) : [];
  const rootCause =
    !passed && misconceptions.length > 0
      ? normalizeRootCause(result?.root_cause ?? result?.rootCause)
      : null;
  const correctModel = (() => {
    const raw = result?.correct_model ?? result?.correctModel;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  })();
  const payload = {
    rubric: rubric ?? [],
    correctModel: passed ? null : correctModel,
    misconception: misconceptions[0] ?? null,
    rootCause,
  };
  const hasPayload =
    payload.rubric.length > 0 ||
    !!payload.correctModel ||
    !!payload.misconception ||
    !!payload.rootCause;
  const now = new Date();
  await prisma.gate.update({
    where: { id: gateId },
    data: {
      status: passed ? "passed" : "failed",
      gradeNote: result?.feedback?.trim() || null,
      // 配列互換の envelope。correct_model / misconception も同梱
      rubricResult: hasPayload ? serializeGradePayload(payload) : null,
      gradedAt: now,
    },
  });

  if (passed) {
    await onGatePassed(gate, now, result?.goal_suggestions, rubric);
    await refreshRequirementsForGate(gateId).catch((e) =>
      console.error("[requirement] refresh after pass failed:", e)
    );
  } else {
    await onGateFailed(gate, misconceptions, now, rootCause);
  }
}

/** ADR-0010: 全観点 score=2 なら次回間隔を 2 倍 (上限 14 日)。それ以外は従来間隔。
 *  既に上限以上の従来間隔なら延長対象外 (短くしない)。 */
function nextReviewIntervalDays(baseDays: number, perfect: boolean): number {
  if (!perfect) return baseDays;
  if (baseDays >= PERFECT_INTERVAL_CAP_DAYS) return baseDays;
  return Math.min(baseDays * 2, PERFECT_INTERVAL_CAP_DAYS);
}

function isPerfectRubric(rubric: RubricScore[] | null): boolean {
  return !!rubric && rubric.length > 0 && rubric.every((r) => r.score === 2);
}

async function onGatePassed(
  gate: {
    id: string;
    kind: string;
    misconceptionId: string | null;
    accessedResource: boolean;
    answerMode: string | null;
  },
  now: Date,
  goalSuggestions: unknown,
  rubric: RubricScore[] | null
) {
  // 調査力の記録のみ。NSM の解消判定には使わない (ADR-0007/0010/0015)
  // accessedResource があれば researched 優先。
  // MCP 経由は in_session、ターミナル経由は assisted、それ以外は self
  const answerMode = gate.accessedResource
    ? "researched"
    : gate.answerMode === "in_session" || gate.answerMode === "assisted"
      ? gate.answerMode
      : "self";
  await prisma.gate.update({
    where: { id: gate.id },
    data: { answerMode },
  });

  if (!gate.misconceptionId) return;
  const m = await prisma.misconception.findUnique({
    where: { id: gate.misconceptionId },
  });
  if (!m) return;

  const perfect = isPerfectRubric(rubric);

  if (gate.kind === "retry" || gate.kind === "module") {
    // 72h ルール: retry Gate の合格でのみ resolved (self_retry は対象外)
    // module: 正典モジュール起点でも合格で解消 (ADR-0016)
    const nextDays = nextReviewIntervalDays(SR_BASE_DAYS, perfect);
    await prisma.misconception.update({
      where: { id: m.id },
      data: {
        status: "resolved",
        resolvedAt: now,
        reviewCount: 0,
        nextReviewAt: new Date(now.getTime() + nextDays * 86400000),
      },
    });
    // 誤解解消時のみ Goal 紐付け提案を反映 (ADR-0008。active Goal 0 件なら no-op)
    await applyGoalSuggestionsFromGrade(goalSuggestions, {
      targetType: "misconception",
      targetId: m.id,
    }).catch((e) => console.error("[goal] apply suggestions failed:", e));
  } else if (gate.kind === "sr_review" && m.status === "resolved") {
    // 定着レビュー合格: 間隔を倍に伸ばす (上限あり)。全観点 score=2 ならさらに延長 (上限 14 日)
    const traditional = Math.min(
      SR_BASE_DAYS * 2 ** (m.reviewCount + 1),
      SR_MAX_DAYS
    );
    const nextDays = nextReviewIntervalDays(traditional, perfect);
    await prisma.misconception.update({
      where: { id: m.id },
      data: {
        reviewCount: m.reviewCount + 1,
        nextReviewAt: new Date(now.getTime() + nextDays * 86400000),
      },
    });
  } else if (gate.kind === "initial") {
    // G3/B5-5: 初回 CLEAR でも再出題を予約（予告日付が空にならない）
    await prisma.misconception.update({
      where: { id: m.id },
      data: {
        nextReviewAt: new Date(now.getTime() + RETRY_DELAY_MS),
      },
    });
  }
}

async function onGateFailed(
  gate: { id: string; kind: string; misconceptionId: string | null },
  misconceptions: string[],
  now: Date,
  rootCause: RootCause | null
) {
  if (gate.kind === "sr_review" && gate.misconceptionId) {
    // 定着レビューで再度誤解: regressed → open に戻し 72h 後に再出題
    await prisma.misconception.update({
      where: { id: gate.misconceptionId },
      data: {
        status: "regressed",
        nextReviewAt: new Date(now.getTime() + RETRY_DELAY_MS),
        // 再発時に新しい根因が取れたら上書き。なければ据え置き
        ...(rootCause ? { rootCause } : {}),
      },
    });
    return;
  }

  // 初回/再出題の不合格: 誤解概念を受信箱 (Capture) へ。
  // ユーザーが accept して初めて Misconception として確定する (プライバシー条件)
  for (const concept of misconceptions.map((c) => c.trim()).filter(Boolean).slice(0, 3)) {
    const dedupeKey = concept.toLowerCase().replace(/\s+/g, " ");
    const existing = await prisma.capture.findFirst({
      where: { dedupeKey, status: "pending" },
    });
    if (existing) continue;
    await prisma.capture.create({
      data: {
        title: concept,
        note: "理解度ゲートの採点で検出された誤解です。",
        sourceTool: "gate",
        sourceContext: encodeGateSourceContext(gate.id, rootCause),
        dedupeKey,
      },
    });
  }

  // 再出題 (retry) / 初回 (initial) に紐づく誤解は次回復習を予約（G3）
  if (
    (gate.kind === "retry" || gate.kind === "initial") &&
    gate.misconceptionId
  ) {
    await prisma.misconception.update({
      where: { id: gate.misconceptionId },
      data: {
        nextReviewAt: new Date(now.getTime() + RETRY_DELAY_MS),
        ...(rootCause ? { rootCause } : {}),
      },
    });
  }
}

/**
 * 受信箱で accept された gate 由来の概念を Misconception として確定する。
 * triageCapture (capture.ts) から呼ばれる。
 */
export async function confirmMisconception(
  concept: string,
  gateId: string | null,
  rootCause?: RootCause | null
): Promise<void> {
  const firstGate = gateId
    ? await prisma.gate.findUnique({ where: { id: gateId } })
    : null;
  await prisma.misconception.create({
    data: {
      concept,
      rootCause: rootCause ?? null,
      firstGateId: firstGate?.id ?? null,
      nextReviewAt: new Date(Date.now() + RETRY_DELAY_MS), // 72h 後に再出題
      gates: firstGate ? { connect: { id: firstGate.id } } : undefined,
    },
  });
}

/**
 * 出題予定 (nextReviewAt 経過) の誤解から retry / sr_review Gate を生成する。
 * 朝のブリーフィング時に呼ぶ (cron がないためブリーフィングを起点にする)。
 */
const STALE_REVIEW_MS = 7 * 86400000; // 滞留 pending の再出題を解放（G4）

export async function scheduleDueGates(): Promise<number> {
  const now = new Date();
  // 未回答のまま古い retry/sr_review が残ると新規再出題が永久停止するため片付ける
  const staleBefore = new Date(now.getTime() - STALE_REVIEW_MS);
  await prisma.gate.updateMany({
    where: {
      kind: { in: ["retry", "sr_review"] },
      status: "pending",
      createdAt: { lte: staleBefore },
    },
    data: { status: "dismissed", dismissReason: "stale_review" },
  });
  const due = await prisma.misconception.findMany({
    where: {
      nextReviewAt: { lte: now },
      gates: { none: { status: { in: ["pending", "answered", "grading"] } } },
    },
    take: 5,
  });
  for (const m of due) {
    const kind = m.status === "resolved" ? "sr_review" : "retry";
    const firstGate = m.firstGateId
      ? await prisma.gate.findUnique({
          where: { id: m.firstGateId },
          select: { domain: true, contextSummary: true },
        })
      : null;
    await prisma.gate.create({
      data: {
        misconceptionId: m.id,
        kind,
        question: `「${m.concept}」を、今取り組んでいるタスクや別の状況に適用するとしたら、どう判断・行動するか説明してください。`,
        targetConcept: m.concept,
        domain: firstGate?.domain ?? null,
        // 再出題は初回ゲートの文脈要約を継承 (ADR-0011)
        contextSummary: firstGate?.contextSummary ?? null,
      },
    });
    await prisma.misconception.update({
      where: { id: m.id },
      data: { nextReviewAt: null },
    });
  }
  return due.length;
}
