/**
 * 週のしょの純関数・型 (クライアント可)。DB は weekly-textbook.ts。
 */

import { weekRangeJST, weekStartJST } from "@/lib/date";

const DAY_MS = 86400000;

export type WeekRange = { start: Date; end: Date; weekKey: string };

/** 直前に完了した週（今週の1つ前、JST月曜始まり）のレンジ */
export function lastCompletedWeekRangeJST(now: Date = new Date()): WeekRange {
  const thisMonday = weekStartJST(now);
  const lastWeekAnyDay = new Date(thisMonday.getTime() - DAY_MS);
  return weekRangeJST(lastWeekAnyDay);
}

/**
 * 直近 `count` 週ぶん（今週を除く、直前の週が先頭）のレンジ。
 * cron が落ちていた・サーバーが起動していなかった期間の取りこぼしを
 * lazy フォールバックでまとめて埋めるために使う。
 */
export function recentCompletedWeekRanges(
  now: Date = new Date(),
  count = 8,
): WeekRange[] {
  const thisMonday = weekStartJST(now);
  const ranges: WeekRange[] = [];
  for (let i = 1; i <= count; i++) {
    const anyDay = new Date(thisMonday.getTime() - i * 7 * DAY_MS);
    ranges.push(weekRangeJST(anyDay));
  }
  return ranges;
}

export function buildWeeklyTitle(weekKey: string): string {
  return `週のしょ — ${weekKey}`;
}

export function buildWeeklyLead(
  materialCount: number,
  keptCount: number,
  chapterCount: number,
): string {
  if (materialCount === 0) {
    return "その週、まだ拾えていない材料はなかった。";
  }
  return `その週にまだ拾えていなかった材料 ${materialCount} 件のうち、${keptCount} 件を ${chapterCount} 章にまとめた。`;
}
