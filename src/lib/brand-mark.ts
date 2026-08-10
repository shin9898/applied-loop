/**
 * Applied Loop / ぼうけんのしょ ブランドマーク（DQ・Atlas 調ピクセル）。
 * 開いた冒険の書 + 学びのループ。favicon / LP / apple-touch で共有。
 */

export const BRAND_GRID = 32;

/** パレット記号 → 色。`.` は透明（favicon では navy 下地の上に載せる） */
export const BRAND_COLORS: Record<string, string> = {
  ".": "transparent",
  "#": "#0a0830",
  N: "#000c4a",
  E: "#002070",
  B: "#001a8c",
  G: "#f0d25a",
  D: "#b8922e",
  C: "#f7f3d9",
  L: "#fff8e0",
  A: "#9ec0ff",
  S: "#3ecf5a",
};

/**
 * 32×32。行は左→右。
 * モチーフ: 開き本（左右ページ＋金の背）と、右上を巡る学習ループ。
 */
export const BRAND_ROWS: readonly string[] = [
  // 0-5: ループ上部
  "................................",
  ".................GGGGG..........",
  "...............GG#####GG........",
  "..............G##.....##G.......",
  ".............G#.........G#......",
  "............G#..........G#......",
  // 6-8: ループが本の天に接続 + ページ天
  "....##################G#..G.....",
  "...#LLLLLLLL##CCCCCCCC#G..G.....",
  "...#LLLLLLLL##CCCCCCCC##G#G.....",
  // 9-18: 本の胴（左ページ / 背 / 右ページ）
  "...#LLLLLLLL##CCCCCCCCC##G......",
  "...#LLAAAAAA##CCAAAAAAC#........",
  "...#LLLLLLLL##CCCCCCCCC#........",
  "...#LLAAAAAA##CCAAAAAAC#........",
  "...#LLLLLLLL##CCCCCCCCC#........",
  "...#LLAAAAAA##CCAAAAAAC#........",
  "...#LLLLLLLL##CCCCCCCCC#........",
  "...#LLAAAAAA##CCAAAAAAC#........",
  "...#LLLLLLLL##CCCCCCCCC#........",
  "...#LLLLLLLL##CCCCCCCCC#........",
  // 19-22: 本の地 + しおり
  "...#####################........",
  "..........#DDD#.................",
  "..........#GGG#.................",
  "..........#GGG#.................",
  "...........###..................",
  // 24-31: 余白（favicon で中央に寄せる）
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];

export function brandColorAt(x: number, y: number): string | null {
  const row = BRAND_ROWS[y];
  if (!row || x < 0 || x >= BRAND_GRID || y < 0 || y >= BRAND_GRID) return null;
  const ch = row[x] ?? ".";
  if (ch === ".") return null;
  return BRAND_COLORS[ch] ?? null;
}

/** crispEdges のピクセル SVG（viewBox はグリッド単位） */
export function renderBrandMarkSvg(opts?: {
  /** favicon 用に navy 下地を敷く */
  withBackground?: boolean;
  /** 出力サイズ属性 */
  size?: number;
}): string {
  const size = opts?.size ?? 32;
  const withBackground = opts?.withBackground ?? true;
  const rects: string[] = [];
  if (withBackground) {
    rects.push(
      `<rect width="${BRAND_GRID}" height="${BRAND_GRID}" fill="${BRAND_COLORS.N}"/>`,
    );
  }
  for (let y = 0; y < BRAND_GRID; y++) {
    for (let x = 0; x < BRAND_GRID; x++) {
      const fill = brandColorAt(x, y);
      if (!fill) continue;
      rects.push(
        `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`,
      );
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_GRID} ${BRAND_GRID}" shape-rendering="crispEdges">`,
    ...rects,
    `</svg>`,
    ``,
  ].join("\n");
}
