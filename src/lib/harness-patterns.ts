import { prisma } from "@/lib/db";
import { weekKeyJST, weekRangeJST, weekStartJST } from "@/lib/date";

/** cache read 率が前週比でこの割合以上低下したら検出 */
const CACHE_READ_DECLINE_RATIO = 0.15;
/** 比較に必要な週次合計 input 相当トークン下限 */
const CACHE_READ_MIN_WEEKLY_TOKENS = 50_000;
/** repo 単位検出の下限 (全体より低くして小規模プロジェクトも拾う) */
const CACHE_READ_MIN_WEEKLY_TOKENS_PER_REPO = 20_000;
/** 同一セッションの異常 turns 閾値 */
const ABNORMAL_TURNS_THRESHOLD = 40;
/** 異常 turns 検出の対象: 今週開始以降に更新されたセッション */
const ABNORMAL_TURNS_LOOKBACK_WEEKS = 1;
/** output/turn が高すぎる (依頼設計の見直し候補) */
const OUTPUT_PER_TURN_THRESHOLD = 4_000;
const OUTPUT_PER_TURN_MIN_TURNS = 8;
const OUTPUT_PER_TURN_MIN_OUT = 30_000;

export type HarnessPattern = {
  key: string;
  title: string;
  note: string;
};

function cacheReadRate(cacheRead: number, tokensIn: number, cacheCreate: number): number {
  const denom = cacheRead + tokensIn + cacheCreate;
  if (denom <= 0) return 0;
  return cacheRead / denom;
}

type AggSums = {
  cacheRead: number;
  tokensIn: number;
  cacheCreate: number;
};

function rateFromAgg(a: AggSums): number {
  return cacheReadRate(a.cacheRead, a.tokensIn, a.cacheCreate);
}

function totalTokens(a: AggSums): number {
  return a.cacheRead + a.tokensIn + a.cacheCreate;
}

async function detectCacheReadDeclineGlobal(now: Date): Promise<HarnessPattern | null> {
  const thisWeek = weekRangeJST(now);
  const lastWeekStart = new Date(thisWeek.start.getTime() - 7 * 86400000);
  const lastWeekEnd = thisWeek.start;

  const [thisAgg, lastAgg] = await Promise.all([
    prisma.harnessRun.aggregate({
      where: { startedAt: { gte: thisWeek.start, lt: thisWeek.end } },
      _sum: { cacheRead: true, tokensIn: true, cacheCreate: true },
    }),
    prisma.harnessRun.aggregate({
      where: { startedAt: { gte: lastWeekStart, lt: lastWeekEnd } },
      _sum: { cacheRead: true, tokensIn: true, cacheCreate: true },
    }),
  ]);

  const thisSums: AggSums = {
    cacheRead: thisAgg._sum.cacheRead ?? 0,
    tokensIn: thisAgg._sum.tokensIn ?? 0,
    cacheCreate: thisAgg._sum.cacheCreate ?? 0,
  };
  const lastSums: AggSums = {
    cacheRead: lastAgg._sum.cacheRead ?? 0,
    tokensIn: lastAgg._sum.tokensIn ?? 0,
    cacheCreate: lastAgg._sum.cacheCreate ?? 0,
  };

  if (
    totalTokens(thisSums) < CACHE_READ_MIN_WEEKLY_TOKENS ||
    totalTokens(lastSums) < CACHE_READ_MIN_WEEKLY_TOKENS
  ) {
    return null;
  }

  const thisRate = rateFromAgg(thisSums);
  const lastRate = rateFromAgg(lastSums);
  if (lastRate <= 0) return null;
  const decline = (lastRate - thisRate) / lastRate;
  if (decline < CACHE_READ_DECLINE_RATIO) return null;

  return {
    key: `cache-decline:${weekKeyJST(now)}`,
    title: "コンテキストの再利用率が先週より下がっている",
    note: [
      `今週の cache read 率 ${(thisRate * 100).toFixed(1)}% は、先週 ${(lastRate * 100).toFixed(1)}% から相対 ${Math.round(decline * 100)}% 低下（全プロジェクト合算）。`,
      "コンテキスト設計 (CLAUDE.md / ルール肥大 / 無関係ファイルの読み込み) を見直す候補。",
      "原理: /harness/concepts/prompt-cache",
      "一次情報: Anthropic prompt caching ドキュメント。",
      "観測ページ: /harness",
    ].join("\n"),
  };
}

/**
 * repo 単位の cache-decline (ADR-0016)。
 * 全体合算では希釈される「特定プロジェクトだけの破壊」を拾う。
 */
async function detectCacheReadDeclineByRepo(now: Date): Promise<HarnessPattern[]> {
  const thisWeek = weekRangeJST(now);
  const lastWeekStart = new Date(thisWeek.start.getTime() - 7 * 86400000);
  const lastWeekEnd = thisWeek.start;
  const weekKey = weekKeyJST(now);

  const runs = await prisma.harnessRun.findMany({
    where: {
      startedAt: { gte: lastWeekStart, lt: thisWeek.end },
      repo: { not: null },
    },
    select: {
      repo: true,
      startedAt: true,
      cacheRead: true,
      tokensIn: true,
      cacheCreate: true,
    },
  });

  type Bucket = { this: AggSums; last: AggSums };
  const byRepo = new Map<string, Bucket>();

  for (const r of runs) {
    const repo = r.repo?.trim();
    if (!repo) continue;
    let b = byRepo.get(repo);
    if (!b) {
      b = {
        this: { cacheRead: 0, tokensIn: 0, cacheCreate: 0 },
        last: { cacheRead: 0, tokensIn: 0, cacheCreate: 0 },
      };
      byRepo.set(repo, b);
    }
    const target =
      r.startedAt >= thisWeek.start && r.startedAt < thisWeek.end
        ? b.this
        : r.startedAt >= lastWeekStart && r.startedAt < lastWeekEnd
          ? b.last
          : null;
    if (!target) continue;
    target.cacheRead += r.cacheRead;
    target.tokensIn += r.tokensIn;
    target.cacheCreate += r.cacheCreate;
  }

  const out: HarnessPattern[] = [];
  for (const [repo, b] of byRepo) {
    if (
      totalTokens(b.this) < CACHE_READ_MIN_WEEKLY_TOKENS_PER_REPO ||
      totalTokens(b.last) < CACHE_READ_MIN_WEEKLY_TOKENS_PER_REPO
    ) {
      continue;
    }
    const thisRate = rateFromAgg(b.this);
    const lastRate = rateFromAgg(b.last);
    if (lastRate <= 0) continue;
    const decline = (lastRate - thisRate) / lastRate;
    if (decline < CACHE_READ_DECLINE_RATIO) continue;

    out.push({
      key: `cache-decline-repo:${repo}:${weekKey}`,
      title: `「${repo}」のコンテキスト再利用率が先週より下がっている`,
      note: [
        `repo=${repo}: 今週 ${(thisRate * 100).toFixed(1)}% ← 先週 ${(lastRate * 100).toFixed(1)}% (相対 ${Math.round(decline * 100)}% 低下)。`,
        "このリポジトリの rules / CLAUDE.md / ツール定義の位置を見直す候補。",
        "適用するときは appliedTo に対象 repo を明記すること (ADR-0016)。",
        "原理: /harness/concepts/prompt-cache",
        "観測ページ: /harness",
      ].join("\n"),
    });
  }

  // 悪化が大きい順
  return out.sort((a, b) => {
    const ra = Number(a.note.match(/相対 (\d+)%/)?.[1] ?? 0);
    const rb = Number(b.note.match(/相対 (\d+)%/)?.[1] ?? 0);
    return rb - ra;
  });
}

async function detectAbnormalTurns(now: Date): Promise<HarnessPattern | null> {
  const since = weekStartJST(
    new Date(now.getTime() - (ABNORMAL_TURNS_LOOKBACK_WEEKS - 1) * 7 * 86400000)
  );
  const outliers = await prisma.harnessRun.findMany({
    where: {
      startedAt: { gte: since },
      turns: { gte: ABNORMAL_TURNS_THRESHOLD },
    },
    orderBy: { turns: "desc" },
    take: 5,
    select: { harness: true, sessionId: true, turns: true, repo: true, model: true },
  });
  if (outliers.length === 0) return null;

  const lines = outliers.map(
    (r) =>
      `- ${r.harness} / ${r.repo ?? "repo不明"}: ${r.turns} turns (model: ${r.model ?? "?"})`
  );
  return {
    key: `abnormal-turns:${weekKeyJST(now)}`,
    title: "同じセッションでやり取りが異常に長い",
    note: [
      `turns ≥ ${ABNORMAL_TURNS_THRESHOLD} のセッションが ${outliers.length} 件。類似指示の繰り返しや、LLM に誤解を与えている兆候の候補。`,
      ...lines,
      "一次情報: 依頼の分割 (メテオフォール) と成功条件の明示。Claude Code / Codex のセッション設計ドキュメント。",
      "観測ページ: /harness",
    ].join("\n"),
  };
}

async function detectOutputPerTurnWaste(now: Date): Promise<HarnessPattern | null> {
  const { start, end } = weekRangeJST(now);
  const runs = await prisma.harnessRun.findMany({
    where: {
      startedAt: { gte: start, lt: end },
      turns: { gte: OUTPUT_PER_TURN_MIN_TURNS },
      tokensOut: { gte: OUTPUT_PER_TURN_MIN_OUT },
    },
    select: {
      harness: true,
      sessionId: true,
      turns: true,
      tokensOut: true,
      repo: true,
    },
  });

  const bad = runs
    .map((r) => ({
      ...r,
      perTurn: r.turns > 0 ? r.tokensOut / r.turns : 0,
    }))
    .filter((r) => r.perTurn >= OUTPUT_PER_TURN_THRESHOLD)
    .sort((a, b) => b.perTurn - a.perTurn)
    .slice(0, 5);

  if (bad.length === 0) return null;

  const lines = bad.map(
    (r) =>
      `- ${r.harness} / ${r.repo ?? "repo不明"}: 出力 ${r.tokensOut} / ${r.turns} turns (≈${Math.round(r.perTurn)}/turn)`
  );
  return {
    key: `output-per-turn:${weekKeyJST(now)}`,
    title: "出力トークンに対して進捗が見えにくいセッションがある",
    note: [
      `今週、出力/turn が ${OUTPUT_PER_TURN_THRESHOLD} 以上のセッションが ${bad.length} 件。依頼設計の見直し候補。`,
      ...lines,
      "一次情報: タスク分解と完了条件の書き方 (エージェント向けプロンプト設計)。",
      "観測ページ: /harness",
    ].join("\n"),
  };
}

/**
 * 週次パターン検出 → Inbox (Capture) へ流す (ADR-0009 §4 / ADR-0016)。
 * morning_briefing の月曜 after() から呼ぶ。
 */
export async function detectAndCaptureHarnessPatterns(
  now: Date = new Date()
): Promise<{ created: number; patterns: string[] }> {
  const [globalDecline, repoDeclines, abnormal, outputWaste] = await Promise.all([
    detectCacheReadDeclineGlobal(now),
    detectCacheReadDeclineByRepo(now),
    detectAbnormalTurns(now),
    detectOutputPerTurnWaste(now),
  ]);

  const detected = [
    globalDecline,
    ...repoDeclines.slice(0, 5), // 悪化上位最大5 repo
    abnormal,
    outputWaste,
  ].filter((p): p is HarnessPattern => p != null);

  let created = 0;
  const patterns: string[] = [];

  for (const p of detected) {
    patterns.push(p.key);
    const dedupeKey = `harness:${p.key}`.toLowerCase();
    const existing = await prisma.capture.findFirst({
      where: { dedupeKey, status: { in: ["pending", "accepted"] } },
    });
    if (existing) continue;

    await prisma.capture.create({
      data: {
        title: p.title,
        note: p.note,
        sourceTool: "harness",
        sourceContext: p.key,
        dedupeKey,
      },
    });
    created += 1;
  }

  return { created, patterns };
}

/** ダッシュボード /harness 用: 直近の検出 Capture を返す */
export async function listRecentHarnessPatternCaptures(take = 20) {
  return prisma.capture.findMany({
    where: { sourceTool: "harness" },
    orderBy: { capturedAt: "desc" },
    take,
  });
}
