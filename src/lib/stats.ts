import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";

/** 記録アクション (学び登録 or 適用記録) があった日の JST 日付キー集合を返す */
async function recordedDayKeys(): Promise<Set<string>> {
  const [entries, applications, checkIns] = await Promise.all([
    prisma.entry.findMany({ select: { createdAt: true } }),
    prisma.application.findMany({ select: { createdAt: true } }),
    prisma.checkIn.findMany({ select: { createdAt: true } }),
  ]);
  const keys = new Set<string>();
  for (const e of entries) keys.add(dateKeyJST(e.createdAt));
  for (const a of applications) keys.add(dateKeyJST(a.createdAt));
  for (const c of checkIns) keys.add(dateKeyJST(c.createdAt));
  return keys;
}

/**
 * 記録ストリーク: 今日 (JST) から遡って連続して記録がある日数。
 * 今日まだ記録がなければ昨日起点で数える (朝の状態で 0 に見せないため)。
 */
export async function recordStreak(now: Date = new Date()): Promise<number> {
  const keys = await recordedDayKeys();
  if (keys.size === 0) return 0;

  const dayMs = 86400000;
  // JST の日付境界で遡るため、基準日を JST 日付キー→ dayStart に変換して使う
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

/** 直近7日間 (JST 基準、今日を含む) に記録アクションがあったか。ストリークドット用 */
export async function weeklyRecordedFlags(
  now: Date = new Date()
): Promise<boolean[]> {
  const keys = await recordedDayKeys();
  const dayMs = 86400000;
  const todayStart = new Date(`${dateKeyJST(now)}T00:00:00+09:00`).getTime();
  return Array.from({ length: 7 }, (_, i) =>
    keys.has(dateKeyJST(new Date(todayStart - (6 - i) * dayMs)))
  );
}

/** 直近7日間 (JST 基準、今日を含む) の日別適用記録数。バーチャート用 */
export async function weeklyApplicationCounts(
  now: Date = new Date()
): Promise<number[]> {
  const dayMs = 86400000;
  const todayStart = new Date(`${dateKeyJST(now)}T00:00:00+09:00`);
  const weekAgo = new Date(todayStart.getTime() - 6 * dayMs);
  const applications = await prisma.application.findMany({
    where: { createdAt: { gte: weekAgo } },
    select: { createdAt: true },
  });
  const counts = new Map<string, number>();
  for (const a of applications) {
    const key = dateKeyJST(a.createdAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const key = dateKeyJST(new Date(todayStart.getTime() - (6 - i) * dayMs));
    return counts.get(key) ?? 0;
  });
}
