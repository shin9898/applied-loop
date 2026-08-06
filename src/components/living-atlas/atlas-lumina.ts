/**
 * ナビ姫「ルミナ」ドット絵（32×40・2フレーム）。
 *
 * 粒度の参考は DQ 古典 NPC 帯。デザインはオリジナル:
 * - 銀月の髪（オレンジではない）
 * - 紺冠＋星（額中央の青玉 circlet ではない）
 * - 紺ドレス＋クリーム前掛け（黄色ボリュームドレスではない）
 * Living Atlas トークン: navy / gold / cream。
 *
 * パレット:
 * 8 outline, 0 deep, f skin, s skin-shade, w cream, g gold, d gold-dark,
 * a dress, n dress-dark, b hair, h hair-shade, r blush, c star.
 */

export type LuminaDef = {
  name: string;
  width: number;
  height: number;
  frames: string[];
  palette: Record<string, string | null>;
};

function pack(rows: string[]): string {
  return rows.join("\n");
}

const W = 32;
const H = 40;

const PALETTE: Record<string, string | null> = {
  ".": null,
  "8": "#140c18",
  "0": "#3a2858",
  f: "#f2c8a4",
  s: "#d4a07c",
  w: "#f7f3d9",
  g: "#f0d25a",
  d: "#b88818",
  a: "#1838b0",
  n: "#000c4a",
  b: "#d8d0f0",
  h: "#7870a8",
  r: "#e87898",
  c: "#9ec0ff",
};

/**
 * 正面・目開き。
 * 上: 星つき三日月冠 → 銀髪＋顔 → 紺ドレス＋クリーム前掛け → 金靴
 */
const FRAME_A = [
  "................................", // 0
  "..............8c8...............", // 1 star tip
  ".............8gcg8..............", // 2
  "............8gdddg8.............", // 3 crescent
  "...........8gd...dg8............", // 4 open crescent
  "..........88bbbbbbb88...........", // 5 hair top
  "........88bbhhhhhhhbb88.........", // 6
  ".......8bbhhbbbbbbbhhbb8........", // 7
  "......8bbhbbfffffffbbhbb8.......", // 8 face
  ".....8bbhbfsssfffsssfbhbb8......", // 9
  ".....8bbhbff8ffff8fffbbhbb8.....", // 10 brows/eyes area
  ".....8bbhbff8wwff8wwffbhbb8.....", // 11 eyes open + highlight
  ".....8bbhbbfffffffffbbbhbb8.....", // 12
  "......8bbhbbfffrrfffbbhbb8......", // 13 mouth
  ".......8bbhbbsssssssbbhbb8......", // 14 chin shade
  "........88bbbbbsssbbbbb88.......", // 15 neck/hair
  ".........88bbbbbbbbbbb88........", // 16
  "........8wwaaaaaaaaaaaww8.......", // 17 cream collar / short gloves start
  ".......8wwaaannnnnnnaaaww8......", // 18 shoulders
  "......8wwaaaaaaaaaaaaaaaaww8....", // 19 sleeves cream
  ".....8aaaaaaaaaaaaaaaaaaaaaa8...", // 20
  "....8aaaaaaaawwwwwwwaaaaaaaa8...", // 21 cream apron
  "....8aaaaaaawwgggggwwaaaaaaa8...", // 22 gold clasp (not blue gem belt)
  "....8aaaaaaawwwwwwwwaaaaaaaa8...", // 23
  "....8aaaaaaaawwwwwwwaaaaaaaa8...", // 24
  "...8aaaaaaaaaaaaaaaaaaaaaaaa8...", // 25 skirt flare
  "...8aaaaannaaaaaaaaaannaaaaa8...", // 26 shade folds
  "...8aaaaaaaaaaaaaaaaaaaaaaaa8...", // 27
  "....8aaaaannnnnnnnnnnnaaaaa8....", // 28 hem shade
  ".....8aaaaaaaaaaaaaaaaaaaa8.....", // 29
  "......88888888888888888888......", // 30
  "........8dd8..........8dd8......", // 31 gold shoes
  "........8gg8..........8gg8......", // 32
  "........8888..........8888......", // 33
  "................................", // 34
  "................................", // 35
  "................................", // 36
  "................................", // 37
  "................................", // 38
  "................................", // 39
];

/** 瞬き */
const FRAME_B = [
  "................................",
  "..............8c8...............",
  ".............8gcg8..............",
  "............8gdddg8.............",
  "...........8gd...dg8............",
  "..........88bbbbbbb88...........",
  "........88bbhhhhhhhbb88.........",
  ".......8bbhhbbbbbbbhhbb8........",
  "......8bbhbbfffffffbbhbb8.......",
  ".....8bbhbfsssfffsssfbhbb8......",
  ".....8bbhbff8ffff8fffbbhbb8.....",
  ".....8bbhbff888ff888ffbhbb8.....", // eyes closed
  ".....8bbhbbfffffffffbbbhbb8.....",
  "......8bbhbbfffrrfffbbhbb8......",
  ".......8bbhbbsssssssbbhbb8......",
  "........88bbbbbsssbbbbb88.......",
  ".........88bbbbbbbbbbb88........",
  "........8wwaaaaaaaaaaaww8.......",
  ".......8wwaaannnnnnnaaaww8......",
  "......8wwaaaaaaaaaaaaaaaaww8....",
  ".....8aaaaaaaaaaaaaaaaaaaaaa8...",
  "....8aaaaaaaawwwwwwwaaaaaaaa8...",
  "....8aaaaaaawwgggggwwaaaaaaa8...",
  "....8aaaaaaawwwwwwwwaaaaaaaa8...",
  "....8aaaaaaaawwwwwwwaaaaaaaa8...",
  "...8aaaaaaaaaaaaaaaaaaaaaaaa8...",
  "...8aaaaannaaaaaaaaaannaaaaa8...",
  "...8aaaaaaaaaaaaaaaaaaaaaaaa8...",
  "....8aaaaannnnnnnnnnnnaaaaa8....",
  ".....8aaaaaaaaaaaaaaaaaaaa8.....",
  "......88888888888888888888......",
  "........8dd8..........8dd8......",
  "........8gg8..........8gg8......",
  "........8888..........8888......",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];

function assertFrame(rows: string[], label: string) {
  if (rows.length !== H) {
    throw new Error(`Lumina ${label}: expected ${H} rows, got ${rows.length}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.length !== W) {
      throw new Error(
        `Lumina ${label} row ${i}: expected ${W} cols, got ${rows[i]!.length}`,
      );
    }
  }
}

assertFrame(FRAME_A, "A");
assertFrame(FRAME_B, "B");

export const LUMINA: LuminaDef = {
  name: "ルミナ",
  width: W,
  height: H,
  palette: PALETTE,
  frames: [pack(FRAME_A), pack(FRAME_B)],
};

export function paintLuminaFrame(
  ctx: CanvasRenderingContext2D,
  def: LuminaDef = LUMINA,
  frameIndex: number,
  scale = 4,
) {
  const rows = def.frames[frameIndex % def.frames.length].split("\n");
  const pw = def.width * scale;
  const ph = def.height * scale;
  ctx.clearRect(0, 0, pw, ph);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const col = def.palette[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
