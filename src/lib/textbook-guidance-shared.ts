/**
 * Textbook 翌日導線の純関数・型 (クライアント可)。DB は textbook-guidance.ts。
 */

import { dateKeyJST } from "@/lib/date";
import type { MasteryState } from "@/lib/daily-textbook-shared";

export type MasteryCounts = {
  clear: number;
  partial: number;
  stuck: number;
  parked: number;
  unanswered: number;
  total: number;
};

export type TextbookGuidanceKind =
  | "stuck"
  | "partial"
  | "unanswered"
  | "today_ready"
  | "none";

export type TextbookGuidance = {
  kind: TextbookGuidanceKind;
  href: string;
  label: string;
  title: string;
  body: string;
  /** briefing 用の1行 */
  briefingLine: string;
  dateKey: string;
  counts: MasteryCounts;
};

export type CheckMasteryRow = {
  mastery: MasteryState | null;
};

export function countMastery(checks: CheckMasteryRow[]): MasteryCounts {
  const counts: MasteryCounts = {
    clear: 0,
    partial: 0,
    stuck: 0,
    parked: 0,
    unanswered: 0,
    total: checks.length,
  };
  for (const c of checks) {
    if (!c.mastery) counts.unanswered += 1;
    else counts[c.mastery] += 1;
  }
  return counts;
}

function prevDateKey(dateKey: string): string {
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  const prev = new Date(start.getTime() - 86400000);
  return dateKeyJST(prev);
}

/**
 * 昨日の教科書 Mastery と、今日の未確認教科書から翌日導線を決める。
 * 優先: stuck > unanswered(昨日) > partial > today unanswered/ready > none
 */
export function resolveTextbookGuidance(input: {
  todayKey: string;
  yesterday: null | { dateKey: string; checks: CheckMasteryRow[] };
  today: null | { dateKey: string; checks: CheckMasteryRow[]; chapterCount: number };
}): TextbookGuidance | null {
  const y = input.yesterday;
  if (y && y.checks.length > 0) {
    const counts = countMastery(y.checks);
    if (counts.stuck > 0) {
      return {
        kind: "stuck",
        href: "/zukan",
        label: "ずかんへ",
        title: "昨日のつまずきをずかんで追う",
        body: `昨日のきょうのしょで stuck ${counts.stuck} 件。ずかんで根拠を押さえ、説明できるまで残すのじゃ。`,
        briefingLine: `昨日のきょうのしょ: stuck ${counts.stuck} → /zukan でつまずきを追う (dateKey: ${y.dateKey})`,
        dateKey: y.dateKey,
        counts,
      };
    }
    if (counts.unanswered > 0) {
      return {
        kind: "unanswered",
        href: `/retro/${y.dateKey}`,
        label: "確認する",
        title: "昨日のきょうのしょの確認が残っている",
        body: `未振り分け ${counts.unanswered} 問。確認モードで Mastery を付けて翌日導線を確定せよ。`,
        briefingLine: `昨日のきょうのしょ: 未確認 ${counts.unanswered} → /retro/${y.dateKey} で Mastery を付ける`,
        dateKey: y.dateKey,
        counts,
      };
    }
    if (counts.partial > 0) {
      return {
        kind: "partial",
        href: `/retro/${y.dateKey}`,
        label: "きょうのしょへ",
        title: "昨日の穴を教科書で埋め直す",
        body: `partial ${counts.partial} 件。該当章を読み直し、自分の言葉でもう一度説明せよ。`,
        briefingLine: `昨日のきょうのしょ: partial ${counts.partial} → /retro/${y.dateKey} で再問`,
        dateKey: y.dateKey,
        counts,
      };
    }
    // clear / parked のみ → 今日のしょへ進める余地
    if (input.today && input.today.chapterCount > 0) {
      const tCounts = countMastery(input.today.checks);
      if (tCounts.unanswered > 0 || tCounts.total === 0) {
        return {
          kind: "today_ready",
          href: `/retro/${input.today.dateKey}`,
          label: "きょうのしょへ",
          title: "きょうのぼうけんのしょを開く",
          body:
            tCounts.total === 0
              ? "章はある。読んでから確認問いを生成・振り分けよ。"
              : `確認の未振り分け ${tCounts.unanswered} 問が残っておる。`,
          briefingLine: `きょうのしょ: /retro/${input.today.dateKey}（未確認 ${tCounts.unanswered}）`,
          dateKey: input.today.dateKey,
          counts: tCounts,
        };
      }
    }
    return null;
  }

  if (input.today && input.today.chapterCount > 0) {
    const tCounts = countMastery(input.today.checks);
    if (tCounts.unanswered > 0 || tCounts.total === 0) {
      return {
        kind: "today_ready",
        href: `/retro/${input.today.dateKey}`,
        label: "きょうのしょへ",
        title: "きょうのぼうけんのしょを開く",
        body:
          tCounts.total === 0
            ? "今日の章が立っておる。読んで確認へ進むのじゃ。"
            : `確認の未振り分け ${tCounts.unanswered} 問。夜の振り返りを閉じよ。`,
        briefingLine: `きょうのしょ: /retro/${input.today.dateKey}（未確認 ${tCounts.unanswered}）`,
        dateKey: input.today.dateKey,
        counts: tCounts,
      };
    }
  }

  return null;
}

export function yesterdayKeyFrom(todayKey: string = dateKeyJST()): string {
  return prevDateKey(todayKey);
}

/** briefing に載せる要約行（教科書が無い日は null） */
export function formatMasteryBriefingLine(
  dateKey: string,
  checks: CheckMasteryRow[],
): string | null {
  if (checks.length === 0) return null;
  const c = countMastery(checks);
  return `昨日のきょうのしょ (${dateKey}): CLEAR ${c.clear} / partial ${c.partial} / stuck ${c.stuck} / parked ${c.parked} / 未確認 ${c.unanswered}`;
}

