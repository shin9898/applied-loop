import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { weekKeyJST, weekRangeJST, weekStartJST } from "@/lib/date";
import { runHeadlessLLM } from "@/lib/headless-llm";
import { computeQuadrantFlows } from "@/lib/quadrant";
import {
  listActiveGoals,
  weeklyEvidenceCounts,
} from "@/lib/goal";

const DAY_MS = 86400000;

function digestDir(): string {
  const env = process.env.OBSIDIAN_DIGEST_DIR?.trim();
  if (env) {
    if (env.startsWith("~/")) {
      return join(process.env.HOME ?? "", env.slice(2));
    }
    return env;
  }
  return join(process.cwd(), "docs", "digest");
}

function weeklyDir(): string {
  return join(digestDir(), "weekly");
}

function narrationPath(weekKey: string): string {
  return join(weeklyDir(), `${weekKey}-narration.md`);
}

async function narrationExists(weekKey: string): Promise<boolean> {
  try {
    await access(narrationPath(weekKey));
    return true;
  } catch {
    return false;
  }
}

type WeeklyAgg = {
  weekKey: string;
  resolvedMisconceptions: { concept: string; rootCause: string | null }[];
  newMisconceptions: { concept: string; rootCause: string | null }[];
  quadrant: Awaited<ReturnType<typeof computeQuadrantFlows>>;
  acceptedLearnings: string[];
  goalEvidence: { title: string; comment: string | null; counts: string }[];
  nextFocus: { concept: string; nextReviewAt: Date | null }[];
};

/** 先週 (JST) の集約データ。月曜 briefing 時点では「終わった週」。 */
async function aggregateLastWeek(now: Date): Promise<WeeklyAgg> {
  const lastWeekAnchor = new Date(weekStartJST(now).getTime() - 7 * DAY_MS);
  const { start, end, weekKey } = weekRangeJST(lastWeekAnchor);

  const [
    resolvedMisconceptions,
    newMisconceptions,
    quadrant,
    acceptedCaptures,
    goals,
    openDue,
    reviews,
  ] = await Promise.all([
    prisma.misconception.findMany({
      where: {
        status: "resolved",
        resolvedAt: { gte: start, lt: end },
      },
      select: { concept: true, rootCause: true },
    }),
    prisma.misconception.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ["open", "regressed"] },
      },
      select: { concept: true, rootCause: true },
    }),
    computeQuadrantFlows(lastWeekAnchor),
    prisma.capture.findMany({
      where: {
        status: "accepted",
        reviewedAt: { gte: start, lt: end },
      },
      select: { title: true },
    }),
    listActiveGoals(),
    prisma.misconception.findMany({
      where: {
        status: { in: ["open", "regressed"] },
      },
      select: { concept: true, nextReviewAt: true },
      orderBy: { nextReviewAt: "asc" },
      take: 8,
    }),
    prisma.goalReview.findMany({
      where: { weekKey },
      select: { goalId: true, comment: true },
    }),
  ]);

  const reviewByGoal = new Map(reviews.map((r) => [r.goalId, r.comment]));
  const goalEvidence: WeeklyAgg["goalEvidence"] = [];
  for (const g of goals) {
    const c = await weeklyEvidenceCounts(g.id, lastWeekAnchor);
    const total = c.entries + c.applications + c.resolvedMisconceptions;
    goalEvidence.push({
      title: g.title,
      comment: reviewByGoal.get(g.id) ?? null,
      counts: `学び ${c.entries} / 実務使用 ${c.applications} / つまずき解消 ${c.resolvedMisconceptions} (計 ${total})`,
    });
  }

  return {
    weekKey,
    resolvedMisconceptions,
    newMisconceptions,
    quadrant,
    acceptedLearnings: acceptedCaptures.map((c) => c.title),
    goalEvidence,
    nextFocus: openDue,
  };
}

function buildFactsBlock(agg: WeeklyAgg): string {
  const lines: string[] = [
    `週: ${agg.weekKey}`,
    "",
    "## 解消したつまずき",
    ...(agg.resolvedMisconceptions.length === 0
      ? ["- (なし)"]
      : agg.resolvedMisconceptions.map(
          (m) =>
            `- ${m.concept}${m.rootCause ? ` (根因: ${m.rootCause})` : ""}`
        )),
    "",
    "## 新規の誤解と根因",
    ...(agg.newMisconceptions.length === 0
      ? ["- (なし)"]
      : agg.newMisconceptions.map(
          (m) =>
            `- ${m.concept}${m.rootCause ? ` (根因: ${m.rootCause})` : ""}`
        )),
    "",
    "## 象限の流れ",
    `- 未知の未知の発見: ${agg.quadrant.unknownUnknownDiscovery}`,
    `- 知の未知 → 知の知: ${agg.quadrant.knownUnknownToKnownKnown}`,
    `- 未知の知 → 知の知: ${agg.quadrant.unknownKnownToKnownKnown}`,
    `- 知の知の維持: ${agg.quadrant.knownKnownMaintenance}`,
    "",
    "## accept された学び",
    ...(agg.acceptedLearnings.length === 0
      ? ["- (なし)"]
      : agg.acceptedLearnings.map((t) => `- ${t}`)),
    "",
    "## 目標の証跡と週次評価",
    ...(agg.goalEvidence.length === 0
      ? ["- (アクティブな目標なし)"]
      : agg.goalEvidence.map(
          (g) =>
            `- ${g.title}: ${g.counts}` +
            (g.comment ? ` / 評価: ${g.comment}` : "")
        )),
    "",
    "## 来週の焦点 (open 誤解の再出題予定)",
    ...(agg.nextFocus.length === 0
      ? ["- (なし)"]
      : agg.nextFocus.map((m) => {
          const when = m.nextReviewAt
            ? m.nextReviewAt.toISOString().slice(0, 10)
            : "未定";
          return `- ${m.concept} (予定: ${when})`;
        })),
  ];
  return lines.join("\n");
}

async function generateNarrationText(agg: WeeklyAgg): Promise<string> {
  const facts = buildFactsBlock(agg);
  const prompt = [
    "あなたはナビキャラ「さやか」。明るく親しみやすい口調で、週次の学びダイジェストをナレーション原稿にする。",
    "聞き流せる長さ: 全体でおおよそ 2400 字以内、セリフ形式の段落を 4 つ前後。",
    "各段落は「さやか: 」で始める。コード・回答全文・個人情報は書かない。数値は事実ブロックの範囲内で。",
    "構成の目安:",
    "1) 週のあいさつと全体の雰囲気",
    "2) 解消したつまずき・新しく見つかったつまずき",
    "3) 象限の流れと accept された学び・目標の証跡",
    "4) 来週の焦点への励まし",
    "事実にないことを捏造しない。事実が少ない週は短くてもよい。",
    "Markdown の見出しや箇条書きは使わず、セリフ段落だけを出力せよ。",
    "",
    "<facts>",
    facts,
    "</facts>",
  ].join("\n");

  const raw = (await runHeadlessLLM(prompt)).trim();
  // 万一 JSON やコードフェンスで包まれたら中身を取り出す
  const unfenced = raw
    .replace(/^```(?:markdown|text)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  return unfenced;
}

/**
 * 先週分の週次ナレーション原稿を生成する (ADR-0014 §1)。
 * 既にファイルがあればスキップ。戻り値は出力パス (スキップ時は null)。
 */
export async function generateWeeklyNarration(
  now: Date = new Date()
): Promise<string | null> {
  const lastWeekAnchor = new Date(weekStartJST(now).getTime() - 7 * DAY_MS);
  const weekKey = weekKeyJST(lastWeekAnchor);

  if (await narrationExists(weekKey)) {
    return null;
  }

  const agg = await aggregateLastWeek(now);
  let body: string;
  try {
    body = await generateNarrationText(agg);
  } catch (e) {
    console.error("[audio-digest] LLM failed:", e);
    // LLM 失敗時も事実ベースのフォールバック原稿を残す
    body = [
      `さやか: ${agg.weekKey} の学びダイジェストです。自動原稿の生成に失敗したので、事実だけお伝えします。`,
      "",
      `さやか: 解消したつまずきは ${agg.resolvedMisconceptions.length} 件、新しいつまずきは ${agg.newMisconceptions.length} 件でした。`,
      "",
      `さやか: 象限の流れは、未知の未知 ${agg.quadrant.unknownUnknownDiscovery}、知の未知から知の知へ ${agg.quadrant.knownUnknownToKnownKnown}、未知の知から知の知へ ${agg.quadrant.unknownKnownToKnownKnown}、知の知の維持 ${agg.quadrant.knownKnownMaintenance} です。`,
      "",
      `さやか: 来週の焦点は open の誤解 ${agg.nextFocus.length} 件。無理せず、ひとつずつ確認していきましょう。`,
    ].join("\n");
  }

  const md = [
    `# Applied Loop 週次ダイジェスト — ${weekKey}`,
    "",
    `> ナレーション原稿 (音声化前)。生成: ${now.toISOString()}`,
    "",
    body,
    "",
  ].join("\n");

  const dir = weeklyDir();
  await mkdir(dir, { recursive: true });
  const path = narrationPath(weekKey);
  await writeFile(path, md, "utf8");
  return path;
}
