import { prisma } from "@/lib/db";
import { weekKeyJST, weekRangeJST } from "@/lib/date";
import { runHeadlessLLM, parseLLMJson } from "@/lib/headless-llm";

export type GoalTargetType = "entry" | "gate" | "application" | "misconception";

export type WeeklyEvidenceCounts = {
  entries: number;
  applications: number;
  resolvedMisconceptions: number;
};

export type EvidenceItem = {
  targetType: GoalTargetType;
  targetId: string;
  title: string;
  date: Date;
};

type ActiveGoal = {
  id: string;
  title: string;
  kdi: string | null;
  period: string;
  focusDomains: string | null;
};

/** active な Goal 一覧。0 件なら呼び出し側は no-op にできる。 */
export async function listActiveGoals(): Promise<ActiveGoal[]> {
  return prisma.goal.findMany({
    where: { status: "active" },
    select: { id: true, title: true, kdi: true, period: true, focusDomains: true },
    orderBy: { createdAt: "asc" },
  });
}

function formatFocusDomains(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "";
    const domains = parsed
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim())
      .filter(Boolean);
    return domains.length > 0 ? domains.join(", ") : "";
  } catch {
    return "";
  }
}

/**
 * 今週 (JST) の証跡 3 種カウント。
 * - 学び: 紐付いた Entry のうち createdAt が今週
 * - 適用: 紐付いた Application のうち createdAt が今週
 * - 誤解解消: 紐付いた Misconception のうち resolvedAt が今週かつ status=resolved
 */
export async function weeklyEvidenceCounts(
  goalId: string,
  now: Date = new Date()
): Promise<WeeklyEvidenceCounts> {
  const { start, end } = weekRangeJST(now);
  const links = await prisma.goalLink.findMany({
    where: {
      goalId,
      confidence: { in: ["manual", "llm_auto"] },
      targetType: { in: ["entry", "application", "misconception"] },
    },
    select: { targetType: true, targetId: true },
  });

  const entryIds = links.filter((l) => l.targetType === "entry").map((l) => l.targetId);
  const appIds = links.filter((l) => l.targetType === "application").map((l) => l.targetId);
  const miscIds = links
    .filter((l) => l.targetType === "misconception")
    .map((l) => l.targetId);

  const [entries, applications, resolvedMisconceptions] = await Promise.all([
    entryIds.length === 0
      ? Promise.resolve(0)
      : prisma.entry.count({
          where: { id: { in: entryIds }, createdAt: { gte: start, lt: end } },
        }),
    appIds.length === 0
      ? Promise.resolve(0)
      : prisma.application.count({
          where: { id: { in: appIds }, createdAt: { gte: start, lt: end } },
        }),
    miscIds.length === 0
      ? Promise.resolve(0)
      : prisma.misconception.count({
          where: {
            id: { in: miscIds },
            status: "resolved",
            resolvedAt: { gte: start, lt: end },
          },
        }),
  ]);

  return { entries, applications, resolvedMisconceptions };
}

/** 紐付き証跡のタイムライン (直近)。llm_suggested は未承認なので除外。 */
export async function evidenceTimeline(
  goalId: string,
  limit = 20
): Promise<EvidenceItem[]> {
  const links = await prisma.goalLink.findMany({
    where: {
      goalId,
      confidence: { in: ["manual", "llm_auto"] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const items: EvidenceItem[] = [];
  for (const link of links) {
    const resolved = await resolveTarget(link.targetType, link.targetId);
    if (!resolved) continue;
    items.push({
      targetType: link.targetType as GoalTargetType,
      targetId: link.targetId,
      title: resolved.title,
      date: resolved.date,
    });
  }
  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  return items.slice(0, limit);
}

async function resolveTarget(
  targetType: string,
  targetId: string
): Promise<{ title: string; date: Date } | null> {
  switch (targetType) {
    case "entry": {
      const e = await prisma.entry.findUnique({ where: { id: targetId } });
      return e ? { title: e.title, date: e.createdAt } : null;
    }
    case "application": {
      const a = await prisma.application.findUnique({
        where: { id: targetId },
        include: { entry: { select: { title: true } } },
      });
      return a
        ? { title: a.entry.title + " — " + a.appliedTo, date: a.createdAt }
        : null;
    }
    case "misconception": {
      const m = await prisma.misconception.findUnique({ where: { id: targetId } });
      return m
        ? { title: m.concept, date: m.resolvedAt ?? m.createdAt }
        : null;
    }
    case "gate": {
      const g = await prisma.gate.findUnique({ where: { id: targetId } });
      return g ? { title: g.question, date: g.createdAt } : null;
    }
    default:
      return null;
  }
}

/**
 * active な Goal ごとに今週の証跡を集め、週次定性コメントを GoalReview に upsert。
 * 証跡 0 件は LLM を呼ばず「証跡なし」。既に同 weekKey がある Goal はスキップ。
 */
export async function generateWeeklyReviews(now: Date = new Date()): Promise<number> {
  const weekKey = weekKeyJST(now);
  const { start, end } = weekRangeJST(now);
  const goals = await listActiveGoals();
  if (goals.length === 0) return 0;

  let written = 0;
  for (const goal of goals) {
    const existing = await prisma.goalReview.findUnique({
      where: { goalId_weekKey: { goalId: goal.id, weekKey } },
    });
    if (existing) continue;

    const evidence = await evidenceInRange(goal.id, start, end);
    let comment: string;
    if (evidence.length === 0) {
      comment = "証跡なし";
    } else {
      comment = await reviewCommentForGoal(goal, evidence, weekKey);
    }

    await prisma.goalReview.create({
      data: { goalId: goal.id, weekKey, comment },
    });
    written += 1;
  }
  return written;
}

async function evidenceInRange(
  goalId: string,
  start: Date,
  end: Date
): Promise<EvidenceItem[]> {
  const all = await evidenceTimeline(goalId, 100);
  return all.filter((e) => e.date >= start && e.date < end);
}

async function reviewCommentForGoal(
  goal: ActiveGoal,
  evidence: EvidenceItem[],
  weekKey: string
): Promise<string> {
  const lines = evidence.map(
    (e) => `- [${e.targetType}] ${e.title} (${e.date.toISOString().slice(0, 10)})`
  );
  const prompt = [
    "あなたは学習目標の週次レビューを書くアシスタントです。",
    "以下の目標と、今週紐付いた証跡リストだけを根拠に、定性コメントを日本語で書いてください。",
    "重要な制約:",
    "- 進捗率・パーセント・数値スコアは絶対に出さない",
    "- 「この目標は進んでいるか」を証跡の種類と内容から根拠つきで述べる",
    "- 2〜4 文程度。JSON のみで出力: {\"comment\":\"...\"}",
    "",
    `目標: ${goal.title}`,
    `期間: ${goal.period}`,
    goal.kdi ? `KDI: ${goal.kdi}` : "",
    `週: ${weekKey}`,
    "証跡:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const parsed = parseLLMJson<{ comment?: string }>(await runHeadlessLLM(prompt));
    const comment = parsed?.comment?.trim();
    if (comment) return comment;
  } catch (e) {
    console.error("[goal] weekly review LLM failed:", e);
  }
  return `今週の証跡 ${evidence.length} 件を確認。自動評価の生成に失敗したため、手動で振り返ってください。`;
}

export type GoalSuggestion = {
  goalId: string;
  targetType: GoalTargetType;
  targetId: string;
};

/**
 * LLM 提案の GoalLink (llm_suggested) を作成。重複は無視。
 * active Goal が 0 件なら no-op。
 */
export async function createSuggestedLinks(
  suggestions: GoalSuggestion[]
): Promise<number> {
  if (suggestions.length === 0) return 0;
  const activeIds = new Set((await listActiveGoals()).map((g) => g.id));
  if (activeIds.size === 0) return 0;

  let created = 0;
  for (const s of suggestions) {
    if (!activeIds.has(s.goalId)) continue;
    if (!["entry", "gate", "application", "misconception"].includes(s.targetType)) {
      continue;
    }
    try {
      await prisma.goalLink.create({
        data: {
          goalId: s.goalId,
          targetType: s.targetType,
          targetId: s.targetId,
          confidence: "llm_suggested",
        },
      });
      created += 1;
    } catch {
      // unique 制約違反など: 既にあるならスキップ
    }
  }
  return created;
}

/**
 * キャプチャ accept 後など、タイトルだけ渡して紐付け提案を得る (コード本文は送らない)。
 * active Goal が 0 件、または LLM 失敗時は 0。
 * Entry の場合は同レスポンスで domain も推定して保存する。
 */
export async function suggestLinksForTarget(input: {
  targetType: GoalTargetType;
  targetId: string;
  title: string;
}): Promise<number> {
  const goals = await listActiveGoals();
  if (goals.length === 0) return 0;

  const goalLines = goals.map((g) => {
    const focus = formatFocusDomains(g.focusDomains);
    return [
      `- id:${g.id} title:${g.title}`,
      g.kdi ? `kdi:${g.kdi}` : "",
      focus ? `focusDomains:[${focus}]` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
  const domainHint =
    input.targetType === "entry"
      ? ' domain は大分類の短いラベル (例: "TypeScript / MCP", "PdM / 設計", "DB / Prisma")。不明なら null。'
      : "";
  const jsonShape =
    input.targetType === "entry"
      ? '{"suggestions":[{"goalId":"..."}],"domain":"..."|null}'
      : '{"suggestions":[{"goalId":"..."}]}';
  const prompt = [
    "以下のアイテムを、関連しそうな学習目標へ紐付ける提案をしてください。",
    "関連が薄い場合は空配列でよい。最大3件。",
    "コードや回答全文は渡していない。タイトルのみで判断すること。",
    "各目標の focusDomains は注力領域のヒント。タイトルとドメインの一致を優先して提案精度を上げよ。",
    domainHint,
    `JSON のみ: ${jsonShape}`,
    "",
    `アイテム種別: ${input.targetType}`,
    `タイトル: ${input.title}`,
    "目標一覧:",
    ...goalLines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const parsed = parseLLMJson<{
      suggestions?: { goalId?: string }[];
      domain?: string | null;
    }>(await runHeadlessLLM(prompt));
    const suggestions = (parsed?.suggestions ?? [])
      .filter((s): s is { goalId: string } => typeof s?.goalId === "string")
      .map((s) => ({
        goalId: s.goalId,
        targetType: input.targetType,
        targetId: input.targetId,
      }));
    const created = await createSuggestedLinks(suggestions);

    if (
      input.targetType === "entry" &&
      typeof parsed?.domain === "string" &&
      parsed.domain.trim()
    ) {
      await prisma.entry.update({
        where: { id: input.targetId },
        data: { domain: parsed.domain.trim().slice(0, 80) },
      });
    }

    return created;
  } catch (e) {
    console.error("[goal] suggestLinksForTarget failed:", e);
    return 0;
  }
}

/** 採点プロンプトに載せる active Goal の要約行。0 件なら null。 */
export async function activeGoalsPromptBlock(): Promise<string | null> {
  const goals = await listActiveGoals();
  if (goals.length === 0) return null;
  const lines = goals.map((g) => {
    const focus = formatFocusDomains(g.focusDomains);
    return `- id:${g.id} 「${g.title}」${g.kdi ? ` (KDI: ${g.kdi})` : ""}${focus ? ` [focus: ${focus}]` : ""}`;
  });
  return [
    "関連しそうな学習目標があれば goal_suggestions に goalId の配列で提案せよ (最大3、無ければ [])。",
    "focusDomains は注力領域のヒントとして使え。",
    "目標一覧:",
    ...lines,
  ].join("\n");
}

/** 採点 JSON の goal_suggestions を GoalLink に反映。 */
export async function applyGoalSuggestionsFromGrade(
  goalIds: unknown,
  target: { targetType: GoalTargetType; targetId: string }
): Promise<void> {
  if (!Array.isArray(goalIds) || goalIds.length === 0) return;
  const suggestions = goalIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 3)
    .map((goalId) => ({
      goalId,
      targetType: target.targetType,
      targetId: target.targetId,
    }));
  await createSuggestedLinks(suggestions);
}

export function targetTypeLabel(t: string): string {
  switch (t) {
    case "entry":
      return "学び";
    case "application":
      return "実務で使用";
    case "misconception":
      return "つまずき解消";
    case "gate":
      return "理解チェック";
    default:
      return t;
  }
}
