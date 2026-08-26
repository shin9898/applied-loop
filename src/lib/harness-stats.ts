import { prisma } from "@/lib/db";
import { weekKeyJST, weekRangeJST, weekStartJST } from "@/lib/date";
import { readSupportedStoredHarnessUsage } from "./harness-usage-evidence";

export type WeeklyTokenBreakdown = {
  weekKey: string;
  cacheRead: number;
  cacheCreate: number;
  tokensIn: number;
  tokensOut: number;
  thinking: number;
};

export type ShareSlice = {
  label: string;
  value: number;
};

export type RepoCacheReadRate = {
  repo: string;
  thisWeekRate: number;
  lastWeekRate: number;
  thisWeekTokens: number;
  lastWeekTokens: number;
  /** 前週比の相対低下 (正 = 悪化)。改善は負。観測不足時は 0 */
  declineRatio: number;
  /** 今週の有効トークンが薄く、悪化判定できない */
  insufficientThisWeek: boolean;
};

export type RepoCacheUsageRow = Readonly<{
  repo: string | null;
  startedAt: Date;
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageSemanticsVersion: string | null;
  usageNormalizationStatus: string | null;
}>;

function normalizedCacheReadRate(cacheRead: number, totalInput: number): number {
  if (totalInput <= 0) return 0;
  return cacheRead / totalInput;
}

/** 直近 n 週の token 内訳 (セッション開始週で集計) */
export async function weeklyTokenBreakdowns(
  now: Date = new Date(),
  weeks = 8
): Promise<WeeklyTokenBreakdown[]> {
  const start = weekStartJST(
    new Date(now.getTime() - (weeks - 1) * 7 * 86400000)
  );
  const runs = await prisma.harnessRun.findMany({
    where: { startedAt: { gte: start } },
    select: {
      startedAt: true,
      cacheRead: true,
      cacheCreate: true,
      tokensIn: true,
      tokensOut: true,
      thinking: true,
    },
  });

  const map = new Map<string, WeeklyTokenBreakdown>();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000);
    const key = weekKeyJST(d);
    map.set(key, {
      weekKey: key,
      cacheRead: 0,
      cacheCreate: 0,
      tokensIn: 0,
      tokensOut: 0,
      thinking: 0,
    });
  }

  for (const r of runs) {
    const key = weekKeyJST(r.startedAt);
    const row = map.get(key);
    if (!row) continue;
    row.cacheRead += r.cacheRead;
    row.cacheCreate += r.cacheCreate;
    row.tokensIn += r.tokensIn;
    row.tokensOut += r.tokensOut;
    row.thinking += r.thinking;
  }

  return [...map.values()];
}

export async function harnessModelShares(
  now: Date = new Date(),
  weeks = 4
): Promise<{ byHarness: ShareSlice[]; byModel: ShareSlice[] }> {
  const start = weekStartJST(
    new Date(now.getTime() - (weeks - 1) * 7 * 86400000)
  );
  const runs = await prisma.harnessRun.findMany({
    where: { startedAt: { gte: start } },
    select: { harness: true, model: true, tokensIn: true, tokensOut: true, cacheRead: true },
  });

  const harnessMap = new Map<string, number>();
  const modelMap = new Map<string, number>();
  for (const r of runs) {
    const weight = r.tokensIn + r.tokensOut + r.cacheRead;
    harnessMap.set(r.harness, (harnessMap.get(r.harness) ?? 0) + weight);
    const model = r.model ?? "(不明)";
    modelMap.set(model, (modelMap.get(model) ?? 0) + weight);
  }

  const toSlices = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

  return { byHarness: toSlices(harnessMap), byModel: toSlices(modelMap) };
}

/**
 * repo 別の今週/先週 cache read 率 (ADR-0016)。
 * module ゲート差し込みと /harness 内訳で共用する canonical projection。
 *
 * Raw counters are deliberately not used here: Claude と Codex では
 * `tokensIn` の意味が異なり、Codex の cached input を再加算すると率を
 * 半分近くまで誤って下げる。legacy/null evidence は観測不足として除外し、
 * 0 や raw fallback に丸めない。
 */
export async function repoCacheReadRates(
  now: Date = new Date(),
  opts: { minTokens?: number; take?: number } = {}
): Promise<RepoCacheReadRate[]> {
  const thisWeek = weekRangeJST(now);
  const lastWeekStart = new Date(thisWeek.start.getTime() - 7 * 86400000);
  const runs = await prisma.harnessRun.findMany({
    where: {
      startedAt: { gte: lastWeekStart, lt: thisWeek.end },
      repo: { not: null },
    },
    select: {
      repo: true,
      startedAt: true,
      inputTotalTokens: true,
      inputUncachedTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      usageSemanticsVersion: true,
      usageNormalizationStatus: true,
    },
  });
  return aggregateRepoCacheReadRates(runs, now, opts);
}

/**
 * Pure projection used by the database adapter and its deterministic tests.
 * Keeping the window/rate calculation separate makes it impossible for a
 * query change to silently reintroduce the provider-ambiguous raw formula.
 */
export function aggregateRepoCacheReadRates(
  runs: readonly RepoCacheUsageRow[],
  now: Date = new Date(),
  opts: { minTokens?: number; take?: number } = {},
): RepoCacheReadRate[] {
  const minTokens = opts.minTokens ?? 10_000;
  const take = opts.take ?? 12;
  const thisWeek = weekRangeJST(now);
  const lastWeekStart = new Date(thisWeek.start.getTime() - 7 * 86400000);
  const lastWeekEnd = thisWeek.start;

  type Acc = {
    this: { cacheRead: number; totalInput: number };
    last: { cacheRead: number; totalInput: number };
  };
  const map = new Map<string, Acc>();

  for (const r of runs) {
    const repo = r.repo?.trim();
    if (!repo) continue;
    let a = map.get(repo);
    if (!a) {
      a = {
        this: { cacheRead: 0, totalInput: 0 },
        last: { cacheRead: 0, totalInput: 0 },
      };
      map.set(repo, a);
    }
    const bucket =
      r.startedAt >= thisWeek.start && r.startedAt < thisWeek.end
        ? a.this
        : r.startedAt >= lastWeekStart && r.startedAt < lastWeekEnd
          ? a.last
          : null;
    if (!bucket) continue;
    const usage = readSupportedStoredHarnessUsage(r);
    if (usage === null) continue;
    // synthetic / 空ランは再利用率を壊すので集計から除外
    if (usage.inputTotalTokens <= 0) continue;
    bucket.cacheRead += usage.cacheReadTokens;
    bucket.totalInput += usage.inputTotalTokens;
  }

  const rows: RepoCacheReadRate[] = [];
  for (const [repo, a] of map) {
    const thisTokens = a.this.totalInput;
    const lastTokens = a.last.totalInput;
    if (thisTokens < minTokens && lastTokens < minTokens) continue;
    const lastWeekRate = normalizedCacheReadRate(a.last.cacheRead, a.last.totalInput);
    const insufficientThisWeek = thisTokens < minTokens;
    const thisWeekRate = insufficientThisWeek
      ? lastWeekRate
      : normalizedCacheReadRate(a.this.cacheRead, a.this.totalInput);
    // 今週薄いのに 0% とみなして「全repo悪化」にしない
    const declineRatio =
      insufficientThisWeek || lastWeekRate <= 0
        ? 0
        : (lastWeekRate - thisWeekRate) / lastWeekRate;
    rows.push({
      repo,
      thisWeekRate,
      lastWeekRate,
      thisWeekTokens: thisTokens,
      lastWeekTokens: lastTokens,
      declineRatio,
      insufficientThisWeek,
    });
  }

  return rows
    .sort(
      (a, b) =>
        Number(a.insufficientThisWeek) - Number(b.insufficientThisWeek) ||
        b.declineRatio - a.declineRatio ||
        b.thisWeekTokens - a.thisWeekTokens,
    )
    .slice(0, take);
}

/** module ゲート用: 悪化上位の repo レートを短文ブロックにする */
export function formatRepoRatesForPrompt(rows: RepoCacheReadRate[]): string {
  if (rows.length === 0) {
    return "(repo 別の十分な観測がまだありません)";
  }
  return rows
    .map((r) => {
      if (r.insufficientThisWeek) {
        return `- ${r.repo}: 今週は観測不足（先週 ${(r.lastWeekRate * 100).toFixed(1)}%）— 悪化判定しない`;
      }
      const delta =
        r.lastWeekRate > 0
          ? ` 前週比 ${r.declineRatio >= 0 ? "低下" : "改善"} ${Math.abs(Math.round(r.declineRatio * 100))}%`
          : "";
      return `- ${r.repo}: 今週 ${(r.thisWeekRate * 100).toFixed(1)}% / 先週 ${(r.lastWeekRate * 100).toFixed(1)}%${delta}`;
    })
    .join("\n");
}
