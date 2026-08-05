/**
 * Pixel enemy sprite for understanding-gate battles.
 * Phase 1: single enemy only. Add kinds after all pages ship.
 */
export type EnemyDef = {
  name: string;
  frames: string[];
  palette: Record<string, string | null>;
};

/** つまずきまもの（暫定1体）— 全ページ後に種類を足して1体ずつ確認 */
export const DEFAULT_ENEMY: EnemyDef = {
  name: "つまずき：いみキャッシュまぼろし",
  palette: {
    "8": "#1a1000",
    "0": "#6a1018",
    f: "#e84848",
    w: "#f7f3d9",
    g: "#f0d25a",
    ".": null,
  },
  frames: [
    [
      "................................",
      "................................",
      "............88888888............",
      "..........880000000088..........",
      "........8800ffffffff0088........",
      ".......800ffffffffffff008.......",
      "......80ff00ffffffff00ff08......",
      ".....80fff00ffffffff00fff08.....",
      ".....80ffffffffffffffffff08.....",
      "....80ffff88ffffffff88ffff08....",
      "....80fff8ww8ffffff8ww8fff08....",
      "....80fff8ww8ffffff8ww8fff08....",
      "....80ffff88fff88fff88ffff08....",
      ".....80fffffffff88fffffff08.....",
      ".....80ffffffff8888ffffff08.....",
      "......80ffffff888888ffff08......",
      ".......80ffff88888888ff08.......",
      "........80ff888gg8888f08........",
      ".........80888gggg88808.........",
      "..........8088gggg8808..........",
      "...........8088888808...........",
      "..........80f808808f08..........",
      ".........80ff08..80ff08.........",
      "........80fff8....8fff08........",
      ".......80ffff8....8ffff08.......",
      "......88888888....88888888......",
      "................................",
      "................................",
      "................................",
      "................................",
      "................................",
      "................................",
    ].join("\n"),
    [
      "................................",
      "................................",
      "............88888888............",
      "..........880000000088..........",
      "........8800ffffffff0088........",
      ".......800ffffffffffff008.......",
      "......80ff00ffffffff00ff08......",
      ".....80fff00ffffffff00fff08.....",
      ".....80ffffffffffffffffff08.....",
      "....80ffff88ffffffff88ffff08....",
      "....80fff8ww8ffffff8ww8fff08....",
      "....80fff8ww8ffffff8ww8fff08....",
      "....80ffff88ffffffff88ffff08....",
      ".....80fffffffff88fffffff08.....",
      ".....80ffffffff8888ffffff08.....",
      "......80ffffff888888ffff08......",
      ".......80ffff88888888ff08.......",
      "........80ff888gg8888f08........",
      ".........80888gggg88808.........",
      "..........8088gggg8808..........",
      "...........8088888808...........",
      "............80880808............",
      "...........80f8..8f08...........",
      "..........80ff8..8ff08..........",
      ".........80fff8..8fff08.........",
      "........8888888..8888888........",
      "................................",
      "................................",
      "................................",
      "................................",
      "................................",
      "................................",
    ].join("\n"),
  ],
};

export function paintEnemyFrame(
  ctx: CanvasRenderingContext2D,
  def: EnemyDef = DEFAULT_ENEMY,
  frameIndex: number,
  scale = 2,
) {
  const rows = def.frames[frameIndex % def.frames.length].split("\n");
  ctx.clearRect(0, 0, 32 * scale, 32 * scale);
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
