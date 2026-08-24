import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeDismissRecoveryNextReviewAt } from "@/lib/gate-dismiss-recovery";
import {
  encodeGateSourceContext,
  normalizeRootCause,
  type RootCause,
} from "@/lib/gate-source-context";
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
import {
  TEXTBOOK_CHECK_GATE_KIND,
  type StoredTextbookCheckGateOriginV1,
  type TextbookCheckGateReferenceV1,
  validateTextbookCheckGateOriginV1,
} from "@/lib/textbook-check-gate-origin";
import {
  appendTextbookCheckGateStateEvent,
  linkTextbookCheckGateFailureCapture,
  transitionGateStatusWithTextbookHistory,
} from "@/lib/textbook-check-gate-history";
import { readTutorialState } from "@/lib/tutorial-state";

// 発火抑制ルール (ADR-0006 §2)。チューニングはここを変えるだけでよい
export const GATE_THROTTLE_HOURS = 4;
export const GATE_DAILY_CAP = 3;
/**
 * 未回答しれん件数の上限。超えると **即時しれん生成だけ** を skip（skipReason=backlog）。
 * DevEvent（材料）自体は常に保存する — ADR-0020 / P4 C1-1。
 * 日次教科書は backlog 分も含めて材料化する。
 */
export { GATE_BACKLOG_CAP } from "@/lib/gate-limits";
import { GATE_BACKLOG_CAP } from "@/lib/gate-limits";
/** request_gate / generateGate が LLM に渡す diff 上限（超分は切り捨て。DB には保存しない） */
export const DIFF_MAX_CHARS = 8000;

const RETRY_DELAY_MS = 72 * 3600 * 1000; // 72h ルール
const SR_BASE_DAYS = 7;
const SR_MAX_DAYS = 60;
const PERFECT_INTERVAL_CAP_DAYS = 14; // ADR-0010: 全観点 score=2 時の延長上限
const RESOURCE_KINDS = new Set(["doc", "file", "commit", "adr"]);
const execFileAsync = promisify(execFile);

export { encodeGateSourceContext, parseGateSourceContext, type RootCause } from "@/lib/gate-source-context";

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
  /** hook がコミット時点で添付する base64 済み diff（worktree 削除後も生成できるように） */
  diffB64?: string;
};

export type RecordEventResult =
  | { outcome: "fired"; eventId: string }
  | { outcome: "skipped"; eventId: string; reason: string }
  | { outcome: "duplicate" };

/**
 * イベントを記録し発火判定する (ADR-0006 §2 / ADR-0020)。
 * - 材料 (DevEvent) は throttle/backlog でも常に作成する（C1-1）。
 * - fired の場合のみ、呼び出し元は generateGate を非同期で実行すること。
 * - skipped は「即時しれんを作らない」だけで、日次 Textbook の材料には残る。
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
      diffSnapshot: decodeDiffBase64(input.diffB64),
      fired: !skip,
      skipReason: skip ?? null,
    },
  });
  // materialAccepted: DevEvent 行が作られた時点で true（outcome に関わらず）
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

/** hook が添付した base64 diff を復号して切り詰める。不正な入力は null（イベント自体は受理） */
export function decodeDiffBase64(diffB64: string | undefined): string | null {
  if (!diffB64?.trim()) return null;
  try {
    const decoded = Buffer.from(diffB64, "base64").toString("utf8");
    const trimmed = truncateDiffForGate(decoded);
    return trimmed || null;
  } catch {
    return null;
  }
}

/** diff 本文を切り詰め（DB には diffSnapshot としてローカル専用保存, ADR-0006 追記 2026-08-16） */
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

export type GateGradingSource =
  | Readonly<{
      ok: true;
      rubricCriteria: readonly string[] | null;
      textbookReference: TextbookCheckGateReferenceV1 | null;
    }>
  | Readonly<{ ok: false; code: "invalid_textbook_origin" }>;

/**
 * Resolves the only prompt source a Gate may use. A textbook Gate has no
 * mutable fallback: a missing or changed origin becomes `grading_failed`
 * before any LLM call.
 */
export function resolveGateGradingSource(input: Readonly<{
  kind: string;
  question: string;
  rubricCriteria: string | null;
  textbookCheckOrigin: StoredTextbookCheckGateOriginV1 | null;
}>): GateGradingSource {
  let criteria: string[] | null = null;
  if (input.rubricCriteria) {
    try {
      criteria = normalizeRubricCriteria(JSON.parse(input.rubricCriteria));
    } catch {
      criteria = null;
    }
  }

  if (input.kind !== TEXTBOOK_CHECK_GATE_KIND) {
    return input.textbookCheckOrigin === null
      ? Object.freeze({ ok: true as const, rubricCriteria: criteria, textbookReference: null })
      : Object.freeze({ ok: false as const, code: "invalid_textbook_origin" as const });
  }
  if (input.textbookCheckOrigin === null) {
    return Object.freeze({ ok: false as const, code: "invalid_textbook_origin" as const });
  }
  const validated = validateTextbookCheckGateOriginV1({
    question: input.question,
    stored: input.textbookCheckOrigin,
  });
  if (
    !validated.ok ||
    criteria === null ||
    criteria.length !== validated.origin.rubricCriteria.length ||
    !criteria.every((criterion, index) => criterion === validated.origin.rubricCriteria[index])
  ) {
    return Object.freeze({ ok: false as const, code: "invalid_textbook_origin" as const });
  }
  return Object.freeze({
    ok: true as const,
    rubricCriteria: validated.origin.rubricCriteria,
    textbookReference: validated.origin.reference,
  });
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

/** 出題保存前: rubric と resources の両方が必須（空リソース潰し） */
export function hasRequiredGateArtifacts(input: {
  rubric: string[] | null;
  resources: GateResource[] | null;
}): boolean {
  return !!(input.rubric?.length && input.resources?.length);
}

function mapParsedQuestion(parsed: GeneratedQuestion): QuestionBuildOk | null {
  if (!parsed?.question?.trim()) return null;

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

async function callQuestionLLM(
  diff: string,
  opts?: { repairNote?: string | null },
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
    "rubric は合否を分ける概念の本質の観点を 1〜3 つ。【必須・空配列禁止】",
    "resources は回答時に参照できる一次情報を 1 件以上。【必須・空配列禁止】",
    "resources.kind は doc(URL) / file(リポジトリ内パス) / commit(sha) / adr(docs/adr 内参照) のみ。",
    "resources.ref は参照のみ (ファイル本文・正解文・解説は含めない)。存在しそうな URL/パスを推定してよい。",
    "resources に答えやモデル解答を書くな。調査の入口だけを出せ。",
    'domain は大分類の短いラベル (例: "TypeScript / MCP", "PdM / 設計", "DB / Prisma")。',
    "context_summary は「このコミットでやったこと」の 2-3 行要約。回答のヒントや正解を書かない。前提の思い出し用。",
    "principle は第1段階で抽出した一般原則。target_concept にも同じ原則を入れてよい。",
    reqBlock ?? "",
    opts?.repairNote?.trim() ? `\n${opts.repairNote.trim()}\n` : "",
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
  const mapped = parsed ? mapParsedQuestion(parsed) : null;
  if (!mapped) {
    return { ok: false, reason: "gen_failed_parse" };
  }
  return mapped;
}

async function buildQuestionFromDiff(
  diff: string,
): Promise<QuestionBuildOk | QuestionBuildFail> {
  const first = await callQuestionLLM(diff);
  if (!first.ok) return first;
  if (hasRequiredGateArtifacts(first)) return first;

  const repairNote = [
    "【再生成・必須】",
    "前回の応答は rubric または resources が空で不合格。",
    `前回 question: ${first.question}`,
    `前回 rubric: ${JSON.stringify(first.rubric ?? [])}`,
    `前回 resources: ${JSON.stringify(first.resources ?? [])}`,
    "同じ原則・問いの方向性を保ちつつ、rubric を1〜3件、resources を1件以上埋めた JSON のみ返せ。",
    "resources に正解や解説を書くな。",
  ].join("\n");

  const second = await callQuestionLLM(diff, { repairNote });
  if (!second.ok) return second;
  if (!hasRequiredGateArtifacts(second)) {
    return { ok: false, reason: "gen_failed_parse" };
  }
  return second;
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

  // snapshot 優先（worktree 削除後や auth 復旧後の再試行でも生成できる）。
  // git から取れた場合は後の再採点・再試行用に backfill する。
  let diff = event.diffSnapshot;
  if (!diff && event.repoPath) {
    diff = await getDiff(event.repoPath, event.ref);
    if (diff) {
      await prisma.devEvent.update({
        where: { id: eventId },
        data: { diffSnapshot: diff },
      });
    }
  }
  if (!diff) return fail(event.repoPath ? "gen_failed_diff" : "gen_failed");

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
  rubricCriteria: readonly string[] | null,
  goalsBlock: string | null,
  textbookReference: TextbookCheckGateReferenceV1 | null = null,
): Promise<GradeResult | null> {
  return parseLLMJson<GradeResult>(await runHeadlessLLM(buildGradingPrompt({
    diff,
    textbookReference,
    question,
    answer,
    rubricCriteria,
    goalsBlock,
  })));
}

/**
 * Pure prompt assembly. `gradeGate` only supplies `textbookReference` after
 * immutable origin/hash verification; normal diff gates keep their old shape.
 */
export function buildGradingPrompt(input: Readonly<{
  diff: string | null;
  textbookReference: TextbookCheckGateReferenceV1 | null;
  question: string;
  answer: string;
  rubricCriteria: readonly string[] | null;
  goalsBlock: string | null;
}>): string {
  const rubricBlock = input.rubricCriteria?.length
    ? `採点観点 (rubric): ${JSON.stringify(input.rubricCriteria)}\n各観点について score 0=欠落 / 1=部分的 / 2=押さえている で採点せよ。`
    : "rubric は空配列でよい。";
  const goalJson = input.goalsBlock
    ? ',"goal_suggestions":["goalId",...]'
    : "";
  return [
    input.textbookReference
      ? "以下の教材参照と、それについての問いへの回答を採点せよ。"
      : "以下の git diff と、それについての問いへの回答を採点せよ。",
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
    input.goalsBlock ?? "",
    `JSON のみで出力: {"verdict":"pass"|"fail","feedback":"...","correct_model":"..."|null,"misconception":"..."|null,"root_cause":"knowledge"|"verification"|"premise"|null,"rubric":[{"aspect":"...","score":0|1|2,"note":"...","teach":"...","model":"..."}]${goalJson}}`,
    "",
    input.textbookReference
      ? `<textbook_reference>\n${JSON.stringify(input.textbookReference)}\n</textbook_reference>`
      : input.diff
        ? `<diff>\n${input.diff}\n</diff>`
        : "(diff なし。問いと回答のみで採点)",
    `<question>\n${input.question}\n</question>`,
    `<answer>\n${input.answer}\n</answer>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 回答を採点する (非同期ジョブ。状態機械は ADR-0006 §5)。
 * 失敗モード: パース失敗は1回リトライ、CLI/認証エラーは grading_failed。
 */
export async function gradeGate(gateId: string): Promise<void> {
  const gate = await prisma.gate.findUnique({
    where: { id: gateId },
    include: { event: true, textbookCheckOrigin: true },
  });
  if (!gate || !gate.answer || gate.status !== "answered") return;

  const gradingStarted = await transitionGateStatusWithTextbookHistory(prisma, {
    gateId,
    from: "answered",
    status: "grading",
  });
  if (!gradingStarted.updated) return;

  let diff: string | null = gate.event?.diffSnapshot ?? null;
  if (!diff && gate.event?.repoPath && gate.event?.ref) {
    diff = await getDiff(gate.event.repoPath, gate.event.ref);
  }

  const gradingSource = resolveGateGradingSource({
    kind: gate.kind,
    question: gate.question,
    rubricCriteria: gate.rubricCriteria,
    textbookCheckOrigin: gate.textbookCheckOrigin,
  });
  if (!gradingSource.ok) {
    await transitionGateStatusWithTextbookHistory(prisma, {
      gateId,
      from: "grading",
      status: "grading_failed",
      data: {
        gradeNote: "教材由来を検証できませんでした。元のしょから作り直してください。",
      },
    });
    return;
  }

  // active Goal があるときだけ採点 JSON に goal_suggestions を乗せる (ADR-0008)
  const goalsBlock = await activeGoalsPromptBlock();

  let result: GradeResult | null = null;
  try {
    result = await callGradingLLM(
      diff,
      gate.question,
      gate.answer,
      gradingSource.rubricCriteria,
      goalsBlock,
      gradingSource.textbookReference,
    );
    if (!result || resolveVerdict(result) === null) {
      // パース失敗 or verdict 欠損: 1回だけリトライ
      result = await callGradingLLM(
        diff,
        gate.question,
        gate.answer,
        gradingSource.rubricCriteria,
        goalsBlock,
        gradingSource.textbookReference,
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
    await transitionGateStatusWithTextbookHistory(prisma, {
      gateId,
      from: "grading",
      status: "grading_failed",
      data: { gradeNote: reason },
    });
    return;
  }

  const passed = result ? resolveVerdict(result) : null;
  if (passed === null) {
    await transitionGateStatusWithTextbookHistory(prisma, {
      gateId,
      from: "grading",
      status: "grading_failed",
      data: {
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
  const gradeData = {
    gradeNote: result?.feedback?.trim() || null,
    // 配列互換の envelope。correct_model / misconception も同梱
    rubricResult: hasPayload ? serializeGradePayload(payload) : null,
    gradedAt: now,
  };
  const graded = passed
    ? await transitionGateStatusWithTextbookHistory(prisma, {
      gateId,
      from: "grading",
      status: "passed",
      recordedAt: now,
      data: gradeData,
    })
    : await prisma.$transaction(async (tx) => {
      const updated = await tx.gate.updateMany({
        where: { id: gateId, status: "grading" },
        data: { ...gradeData, status: "failed" },
      });
      if (updated.count === 0) return { updated: false, stateEventId: null } as const;
      const failedEvent = await appendTextbookCheckGateStateEvent(tx, {
        gateId,
        status: "failed",
        recordedAt: now,
      });
      await onGateFailed(tx, gate, misconceptions, now, rootCause, failedEvent?.id ?? null);
      return { updated: true, stateEventId: failedEvent?.id ?? null } as const;
    });
  if (!graded.updated) return;

  if (passed) {
    await onGatePassed(gate, now, result?.goal_suggestions, rubric);
    await refreshRequirementsForGate(gateId).catch((e) =>
      console.error("[requirement] refresh after pass failed:", e)
    );
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
  client: Prisma.TransactionClient,
  gate: { id: string; kind: string; misconceptionId: string | null },
  misconceptions: string[],
  now: Date,
  rootCause: RootCause | null,
  failedStateEventId: string | null,
) {
  if (gate.kind === "sr_review" && gate.misconceptionId) {
    // 定着レビューで再度誤解: regressed → open に戻し 72h 後に再出題
    await client.misconception.update({
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
    // pending だけでなく accepted も見る（harness-patterns.ts:285 と同じ判定）。
    // pending のみだと、一度 accept 済み（Misconception 確定済み）の概念が
    // 再度失敗検出されたときに重複 Capture を作ってしまう
    const existing = await client.capture.findFirst({
      where: { dedupeKey, status: { in: ["pending", "accepted"] } },
    });
    if (existing) continue;
    const capture = await client.capture.create({
      data: {
        title: concept,
        note: "理解度ゲートの採点で検出された誤解です。",
        sourceTool: "gate",
        sourceContext: encodeGateSourceContext(gate.id, rootCause),
        dedupeKey,
        // failed StateEvent と同じserver時刻を使い、SQLiteのCURRENT_TIMESTAMP秒丸めで
        // 「Captureがfailureより前」に見えることを防ぐ。
        capturedAt: now,
      },
    });
    if (failedStateEventId !== null) {
      await linkTextbookCheckGateFailureCapture(client, {
        failedStateEventId,
        captureId: capture.id,
      });
    }
  }

  // 再出題 (retry) / 初回 (initial) に紐づく誤解は次回復習を予約（G3）
  if (
    (gate.kind === "retry" || gate.kind === "initial") &&
    gate.misconceptionId
  ) {
    await client.misconception.update({
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
  rootCause?: RootCause | null,
  client: PrismaClient | Prisma.TransactionClient = prisma,
  now = new Date(),
): Promise<{ id: string; nextReviewAt: Date }> {
  const firstGate = gateId
    ? await client.gate.findUnique({ where: { id: gateId } })
    : null;
  const nextReviewAt = new Date(now.getTime() + RETRY_DELAY_MS);
  const created = await client.misconception.create({
    data: {
      concept,
      rootCause: rootCause ?? null,
      firstGateId: firstGate?.id ?? null,
      nextReviewAt, // 72h 後に再出題
      gates: firstGate ? { connect: { id: firstGate.id } } : undefined,
    },
  });
  return { id: created.id, nextReviewAt };
}

/**
 * 出題予定 (nextReviewAt 経過) の誤解から retry / sr_review Gate を生成する。
 * 朝のブリーフィング時に呼ぶ (cron がないためブリーフィングを起点にする)。
 */
const STALE_REVIEW_MS = 7 * 86400000; // 滞留 pending の再出題を解放（G4）

/**
 * dismiss された gate の対象 Misconception の nextReviewAt が null に
 * 取り残されていないか確認して復旧する。scheduleDueGates は gate 生成時に
 * nextReviewAt を null にリセットするため (採点結果で再設定される前提)、
 * stale sweep のように採点フローを経ない終端では再設定が起きない。
 */
async function recoverStuckMisconceptionReviews(
  gates: { misconceptionId: string | null }[],
  now: Date,
): Promise<void> {
  const ids = [
    ...new Set(
      gates
        .map((g) => g.misconceptionId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (ids.length === 0) return;
  const misconceptions = await prisma.misconception.findMany({
    where: { id: { in: ids } },
    select: { id: true, nextReviewAt: true },
  });
  for (const m of misconceptions) {
    // stale sweep（未回答放置）は取りこぼしからの復旧なので、明示的な
    // 見送り・悪問スキップ（actions.ts の DISMISS_RECOVERY_DELAY_MS=14日）
    // より短い既存の RETRY_DELAY_MS（72h）を使う（koki判断、2026-08-18）
    const recovered = computeDismissRecoveryNextReviewAt(
      m.nextReviewAt,
      now,
      RETRY_DELAY_MS,
    );
    if (!recovered) continue;
    await prisma.misconception.update({
      where: { id: m.id },
      data: { nextReviewAt: recovered },
    });
  }
}

export async function scheduleDueGates(): Promise<number> {
  const now = new Date();
  // 未回答のまま古い retry/sr_review が残ると新規再出題が永久停止するため片付ける
  const staleBefore = new Date(now.getTime() - STALE_REVIEW_MS);
  const staleGates = await prisma.gate.findMany({
    where: {
      kind: { in: ["retry", "sr_review"] },
      status: "pending",
      createdAt: { lte: staleBefore },
    },
    select: { id: true, misconceptionId: true },
  });
  if (staleGates.length > 0) {
    // findMany と updateMany の間に koki が当該 gate へ回答する窓がある
    // ため、status: "pending" を書き込み側にも残す（無いと提出済みの
    // 回答ごと dismissed で上書きしてしまう。opus 2周目レビュー指摘）
    await prisma.gate.updateMany({
      where: {
        id: { in: staleGates.map((g) => g.id) },
        status: "pending",
      },
      data: { status: "dismissed", dismissReason: "stale_review" },
    });
    // stale sweep は採点フローを経ないため nextReviewAt が null のまま
    // 取り残されうる (G4 休眠バグ、2026-08-18)。復旧は本筋でない後処理
    // なので best-effort にする。ここで throw すると scheduleDueGates
    // 全体が落ち、以降の due gate 生成が一切走らなくなる (opusレビュー指摘)
    await recoverStuckMisconceptionReviews(staleGates, now).catch((e) =>
      console.error("[gate] recover stale-swept nextReviewAt failed:", e),
    );
  }
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
