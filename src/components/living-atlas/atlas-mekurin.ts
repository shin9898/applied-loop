/**
 * めくりん（魔導書の使い魔）ドット絵（20×16・2フレーム）。
 * AI回答待ち演出「案2」専用キャラ。ルミナ（atlas-lumina.ts）とは別役割。
 *
 * パレット: 8 outline, w ページ(cream), m インク線(cream-dim),
 * a 表紙(navy系), g しおり(gold), d しおり先端(gold-dark),
 * e 目のハイライト(white), c 星屑(star)
 */

export type MekurinDef = {
  name: string;
  width: number;
  height: number;
  frames: string[];
  palette: Record<string, string | null>;
};

function pack(rows: string[]): string {
  return rows.join("\n");
}

const W = 20;
const H = 16;

const PALETTE: Record<string, string | null> = {
  ".": null,
  "8": "#140c18",
  w: "#f7f3d9",
  m: "#c9c3a0",
  a: "#1838b0",
  g: "#f0d25a",
  d: "#b88818",
  e: "#ffffff",
  c: "#9ec0ff",
};

/** A: 目開き・右ページ最後の行はまだ空白 */
const FRAME_A = [
  "................c...",
  "..c.................",
  ".88..............88.",
  ".8w88..........88w8.",
  ".8www88......88www8.",
  ".8wwwww88..88wwwww8.",
  ".8wwww8ew88w8ewwww8.",
  ".8wwww88w88w88wwww8.",
  ".8wmmmwwwmmwwwmmmw8.",
  ".8wmmwmmwmmwmmwwww8.", // 右ページ最後の行はまだ空白
  ".88wwwwwwmmwwwwww88.",
  "..8aaaaaaaaaaaaaa8..",
  "...8aaaa8gg8aaaa8...",
  "........8gg8........",
  "........8dd8........",
  "....................",
];

/** B: 瞬き + 右ページに新しい1行が書かれる + しおりが1pxスウェイ + 星屑入れ替え */
const FRAME_B = [
  "...c................",
  ".................c..",
  ".88..............88.",
  ".8w88..........88w8.",
  ".8www88......88www8.",
  ".8wwwww88..88wwwww8.",
  ".8wwwwwww88wwwwwww8.", // 目を閉じる
  ".8wwww88w88w88wwww8.",
  ".8wmmmwwwmmwwwmmmw8.",
  ".8wmmwmmwmmwmmwmmw8.", // ← 空白だった行にインク線が現れる
  ".88wwwwwwmmwwwwww88.",
  "..8aaaaaaaaaaaaaa8..",
  "...8aaaa8gg8aaaa8...",
  ".........8gg8.......", // しおりスウェイ
  ".........8dd8.......",
  "....................",
];

function assertFrame(rows: string[], label: string) {
  if (rows.length !== H) {
    throw new Error(`Mekurin ${label}: expected ${H} rows, got ${rows.length}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.length !== W) {
      throw new Error(
        `Mekurin ${label} row ${i}: expected ${W} cols, got ${rows[i]!.length}`,
      );
    }
  }
}

assertFrame(FRAME_A, "A");
assertFrame(FRAME_B, "B");

export const MEKURIN: MekurinDef = {
  name: "めくりん",
  width: W,
  height: H,
  palette: PALETTE,
  frames: [pack(FRAME_A), pack(FRAME_B)],
};

export function paintMekurinFrame(
  ctx: CanvasRenderingContext2D,
  def: MekurinDef = MEKURIN,
  frameIndex: number,
  scale = 4,
) {
  const rows = def.frames[frameIndex % def.frames.length]!.split("\n");
  const pw = def.width * scale;
  const ph = def.height * scale;
  ctx.clearRect(0, 0, pw, ph);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const col = def.palette[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
