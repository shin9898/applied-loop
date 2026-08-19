/**
 * ちずの6領土（しれん/にっき/もくひょう/じゅんび/うけばこ/どうぐ）の
 * ステージ（格）判定。格は積み上げた成果のみで決まり、下がらない。
 * しきい値はすべて仮置きの初期値（koki実機FB、2026-08-19）。
 */
import type { HomeCtaKind } from "./home-cta";

export type TerritoryKey =
  | "nikki"
  | "shiren"
  | "mokuhyou"
  | "junbi"
  | "ukebako"
  | "dougu";

export type TerritoryStage = 0 | 1 | 2 | 3;

export function stageForShiren(resolvedTotal: number): TerritoryStage {
  if (resolvedTotal <= 0) return 0;
  if (resolvedTotal < 10) return 1;
  if (resolvedTotal < 30) return 2;
  return 3;
}

export function stageForNikki(bookCount: number): TerritoryStage {
  if (bookCount <= 0) return 0;
  if (bookCount < 7) return 1;
  if (bookCount < 30) return 2;
  return 3;
}

export function stageForUkebako(sortedTotal: number): TerritoryStage {
  if (sortedTotal <= 0) return 0;
  if (sortedTotal < 10) return 1;
  if (sortedTotal < 40) return 2;
  return 3;
}

export function stageForDougu(watchedRepoCount: number): TerritoryStage {
  if (watchedRepoCount <= 0) return 0;
  if (watchedRepoCount < 2) return 1;
  if (watchedRepoCount <= 3) return 2;
  return 3;
}

/**
 * じゅんびは達成の質が違う3段（家一軒→必須完了→全完了）なので、
 * 単純な件数しきい値ではなく意味的なマイルストーンで判定する。
 */
export function stageForJunbi(input: {
  anyOk: boolean;
  essentialsReady: boolean;
  allOk: boolean;
}): TerritoryStage {
  if (input.allOk) return 3;
  if (input.essentialsReady) return 2;
  if (input.anyOk) return 1;
  return 0;
}

/**
 * もくひょうの「x/3」は週次証跡3種のうち何種類に実績があるかで数える
 * （合計値だと3を超えてしまい「3本の旗」の比喩と合わなくなるため）。
 */
export function flagsRaisedFromEvidence(counts: {
  entries: number;
  applications: number;
  resolvedMisconceptions: number;
}): TerritoryStage {
  const raised = [
    counts.entries,
    counts.applications,
    counts.resolvedMisconceptions,
  ].filter((n) => n > 0).length;
  return raised as TerritoryStage;
}

/**
 * どうぐの炉が赤く燻るか。データ不足時は誤検知を避けるためfalseにする。
 */
export function doguIsBad(
  worst: { thisWeekRate: number; insufficientThisWeek: boolean } | undefined,
): boolean {
  if (!worst) return false;
  if (worst.insufficientThisWeek) return false;
  return worst.thisWeekRate < 0.3;
}

/**
 * 「！」ピンは常に1つ以下、必ずresolveHomeCtaが指す先の領土に立つ（ルール2）。
 */
export const CTA_KIND_TO_TERRITORY: Record<HomeCtaKind, TerritoryKey> = {
  setup: "junbi",
  textbook: "nikki",
  fight: "shiren",
  hook: "dougu",
  wait: "nikki",
};
