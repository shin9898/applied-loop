/**
 * ホーム用 Lv / EXP。既存の撃破数から算出する装飾指標。
 * 合否・SR とは切り離す（量産ゲーにしない）。
 */

export type AdventurerLevel = {
  level: number;
  /** 現在Lv内の経験 */
  expInLevel: number;
  /** 次Lvまでに必要な経験 */
  expToNext: number;
  /** 0〜1 */
  expRatio: number;
  title: string;
};

const TITLES = [
  "見習い",
  "しれん使い",
  "つまずき狩人",
  "領の案内人",
  "ハーネスの守り手",
  "ぼうけんしゃ",
  "賢者見習い",
  "伝説のしれん使い",
];

/** Lv n に達するのに必要な累計撃破（三角数） */
function cumulativeForLevel(level: number): number {
  // Lv1 = 0, Lv2 = 1, Lv3 = 1+2, … Lv n = n(n-1)/2
  return (level * (level - 1)) / 2;
}

export function adventurerLevelFromResolved(resolvedTotal: number): AdventurerLevel {
  const n = Math.max(0, Math.floor(resolvedTotal));
  let level = 1;
  while (cumulativeForLevel(level + 1) <= n && level < 99) {
    level += 1;
  }
  const floor = cumulativeForLevel(level);
  const ceil = cumulativeForLevel(level + 1);
  const expToNext = Math.max(1, ceil - floor);
  const expInLevel = Math.min(expToNext, Math.max(0, n - floor));
  const title = TITLES[Math.min(level - 1, TITLES.length - 1)] ?? TITLES[TITLES.length - 1]!;
  return {
    level,
    expInLevel,
    expToNext,
    expRatio: expInLevel / expToNext,
    title,
  };
}

export type SystemStar = {
  key: string;
  label: string;
  stars: number; // 0–5
  count: number;
};

/** クリア件数 → ★ 0–5（装飾。厳密な能力値ではない） */
export function starsFromCount(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  if (count <= 12) return 4;
  return 5;
}

export function formatStars(stars: number): string {
  const s = Math.max(0, Math.min(5, stars));
  return "★".repeat(s) + "☆".repeat(5 - s);
}
