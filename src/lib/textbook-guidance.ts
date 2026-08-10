/**
 * Textbook 翌日導線の DB 読込 (server-only)。
 */

import "server-only";

import { dateKeyJST } from "@/lib/date";
import { prisma } from "@/lib/db";
import { isMasteryState } from "@/lib/daily-textbook-shared";
import {
  formatMasteryBriefingLine,
  resolveTextbookGuidance,
  yesterdayKeyFrom,
  type CheckMasteryRow,
  type TextbookGuidance,
} from "@/lib/textbook-guidance-shared";

export * from "@/lib/textbook-guidance-shared";

function toCheckRows(
  checks: Array<{ mastery: string | null }>,
): CheckMasteryRow[] {
  return checks.map((c) => ({
    mastery: c.mastery && isMasteryState(c.mastery) ? c.mastery : null,
  }));
}

/** ホーム / briefing 用に今日基準の Textbook 導線を読む */
export async function loadTextbookGuidanceForToday(
  todayKey: string = dateKeyJST(),
): Promise<{
  guidance: TextbookGuidance | null;
  yesterdayBriefingLine: string | null;
}> {
  const yKey = yesterdayKeyFrom(todayKey);
  const [y, t] = await Promise.all([
    prisma.dailyTextbook.findUnique({
      where: { dateKey: yKey },
      select: {
        dateKey: true,
        checks: { select: { mastery: true } },
      },
    }),
    prisma.dailyTextbook.findUnique({
      where: { dateKey: todayKey },
      select: {
        dateKey: true,
        chapterCount: true,
        checks: { select: { mastery: true } },
      },
    }),
  ]);
  const yChecks = y ? toCheckRows(y.checks) : [];
  const guidance = resolveTextbookGuidance({
    todayKey,
    yesterday: y ? { dateKey: y.dateKey, checks: yChecks } : null,
    today: t
      ? {
          dateKey: t.dateKey,
          chapterCount: t.chapterCount,
          checks: toCheckRows(t.checks),
        }
      : null,
  });
  return {
    guidance,
    yesterdayBriefingLine: y
      ? formatMasteryBriefingLine(y.dateKey, yChecks)
      : null,
  };
}
