import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";

/**
 * 活動ストリーク用の日付キー集合。
 * ゲート回答 (answeredAt) または Entry 作成があった日 (JST)。
 */
async function activityDayKeys(): Promise<Set<string>> {
  const [gates, entries] = await Promise.all([
    prisma.gate.findMany({
      where: { answeredAt: { not: null } },
      select: { answeredAt: true },
    }),
    prisma.entry.findMany({ select: { createdAt: true } }),
  ]);
  const keys = new Set<string>();
  for (const g of gates) {
    if (g.answeredAt) keys.add(dateKeyJST(g.answeredAt));
  }
  for (const e of entries) keys.add(dateKeyJST(e.createdAt));
  return keys;
}

/**
 * 活動ストリーク: 今日 (JST) から遡って連続して
 * ゲート回答 or Entry 作成がある日数。
 * 今日まだ活動がなければ昨日起点で数える。
 */
export async function activityStreak(now: Date = new Date()): Promise<number> {
  const keys = await activityDayKeys();
  if (keys.size === 0) return 0;

  const dayMs = 86400000;
  let cursor = new Date(`${dateKeyJST(now)}T00:00:00+09:00`).getTime();
  if (!keys.has(dateKeyJST(new Date(cursor)))) {
    cursor -= dayMs;
  }
  let streak = 0;
  while (keys.has(dateKeyJST(new Date(cursor)))) {
    streak += 1;
    cursor -= dayMs;
  }
  return streak;
}
