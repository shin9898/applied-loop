/**
 * しれん＝ダンジョンの ドット絵（サーバで描ける版）。
 *
 * バトル画面の敵は canvas（`paintEnemyFrame`）だが、一覧・道のりでは
 * 何体も並ぶので canvas を人数分持つと client component だらけになる。
 * ここでは `atlas-enemies.ts` の EnemyDef をそのまま SVG に焼く。
 * 同色の横並びは 1 本の <rect> にまとめ、空白の行・列はトリムする
 * （32x26 のうち実際に絵があるのは半分ほど）。
 *
 * 新しい敵は作らない。ここにあるのは たいまつ・墓・どくろ・カーソルだけ。
 */
import type { EnemyDef } from "./atlas-enemies";

type Run = { x: number; y: number; w: number; fill: string };
type Baked = { runs: Run[]; vx: number; vy: number; vw: number; vh: number };

function bake(
  rows: readonly string[],
  palette: Readonly<Record<string, string | null>>,
): Baked {
  const runs: Run[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      const fill = palette[ch];
      if (!fill) {
        x += 1;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w += 1;
      runs.push({ x, y, w, fill });
      if (x < minX) minX = x;
      if (x + w - 1 > maxX) maxX = x + w - 1;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      x += w;
    }
  }
  if (maxX < 0) {
    return { runs, vx: 0, vy: 0, vw: rows[0]?.length || 1, vh: rows.length || 1 };
  }
  return {
    runs,
    vx: minX,
    vy: minY,
    vw: maxX - minX + 1,
    vh: maxY - minY + 1,
  };
}

const ENEMY_CACHE = new Map<string, Baked>();

function bakedEnemy(def: EnemyDef, frame: number): Baked {
  const idx = frame % def.frames.length;
  const key = `${def.id}:${idx}`;
  const hit = ENEMY_CACHE.get(key);
  if (hit) return hit;
  const baked = bake((def.frames[idx] ?? "").split("\n"), def.palette);
  ENEMY_CACHE.set(key, baked);
  return baked;
}

/** 影だけのまもの（まだ見ぬ階） */
const SILHOUETTE_FILL = "#00105e";

/**
 * まもの 1 体。`width` はドット幅の整数倍にすると にじまない。
 * `silhouette` で「? ? ?」用の 影に落とす。
 */
export function AtlasEnemySprite({
  def,
  frame = 0,
  width,
  silhouette = false,
  className = "",
  label,
}: {
  def: EnemyDef;
  frame?: number;
  width: number;
  silhouette?: boolean;
  className?: string;
  label?: string;
}) {
  const baked = bakedEnemy(def, frame);
  const height = Math.max(1, Math.round((width * baked.vh) / baked.vw));
  return (
    <svg
      className={`shr-px ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`${baked.vx} ${baked.vy} ${baked.vw} ${baked.vh}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {baked.runs.map((r) => (
        <rect
          key={`${r.y}-${r.x}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={silhouette ? SILHOUETTE_FILL : r.fill}
        />
      ))}
    </svg>
  );
}

/* ---------- ダンジョンの小物（まもの以外） ---------- */

type IconDef = {
  rows: readonly string[];
  palette: Readonly<Record<string, string | null>>;
};

/** たいまつ 1 枚目（炎は 2 枚を パタパタさせる） */
const IC_TORCH_A: IconDef = {
  palette: { O: "#000000", y: "#ffe97a", a: "#f0a020", b: "#6a4a10", ".": null },
  rows: [
    "..O...",
    ".OyO..",
    ".OyaO.",
    "OyaaaO",
    "OyaaaO",
    ".OaaO.",
    "..OO..",
    "..bb..",
    "..bb..",
  ],
};

const IC_TORCH_B: IconDef = {
  palette: { O: "#000000", y: "#ffe97a", a: "#f0a020", b: "#6a4a10", ".": null },
  rows: [
    "...O..",
    "..OyO.",
    ".OayO.",
    "OaayaO",
    ".OayO.",
    "..OO..",
    "..OO..",
    "..bb..",
    "..bb..",
  ],
};

/** 墓（たおした階の 足あと） */
const IC_GRAVE: IconDef = {
  palette: { O: "#000000", s: "#5a657f", d: "#2c3348", h: "#78849e", ".": null },
  rows: [
    "...OOOOOO...",
    "..OhhhhhhO..",
    ".OhsssssshO.",
    ".OhsOOOOshO.",
    ".OhsOssOshO.",
    ".OhsOOOOshO.",
    ".OhsOssOshO.",
    ".OhssssssshO",
    ".OhssssssshO",
    "OddddddddddO",
    "OddddddddddO",
    ".OOOOOOOOOO.",
  ],
};

/** どくろ（ぬし＝再出題の しるし） */
const IC_SKULL: IconDef = {
  palette: { O: "#000000", w: "#ffb3b3", ".": null },
  rows: [
    "..OOOO..",
    ".OwwwwO.",
    "OwOwwOwO",
    "OwOwwOwO",
    "OwwwwwwO",
    "Ow.ww.wO",
    ".OwOOwO.",
    "..O..O..",
  ],
};

/** DQ の ▶ カーソル（濃い字の上に置く用と 金の 2 色） */
const TRI_R = [
  "f.....",
  "ff....",
  "fff...",
  "ffff..",
  "fffff.",
  "ffff..",
  "fff...",
  "ff....",
  "f.....",
];

const IC_ARROW_DARK: IconDef = { palette: { f: "#1a1000", ".": null }, rows: TRI_R };
const IC_ARROW_GOLD: IconDef = { palette: { f: "#f0d25a", ".": null }, rows: TRI_R };

const ICONS = {
  "torch-a": IC_TORCH_A,
  "torch-b": IC_TORCH_B,
  grave: IC_GRAVE,
  skull: IC_SKULL,
  "arrow-dark": IC_ARROW_DARK,
  "arrow-gold": IC_ARROW_GOLD,
} satisfies Record<string, IconDef>;

export type DungeonIconName = keyof typeof ICONS;

const ICON_CACHE = new Map<DungeonIconName, Baked>();

function bakedIcon(name: DungeonIconName): Baked {
  const hit = ICON_CACHE.get(name);
  if (hit) return hit;
  const def = ICONS[name];
  const baked = bake(def.rows, def.palette);
  ICON_CACHE.set(name, baked);
  return baked;
}

export function AtlasDungeonIcon({
  name,
  width,
  className = "",
}: {
  name: DungeonIconName;
  width: number;
  className?: string;
}) {
  const baked = bakedIcon(name);
  const height = Math.max(1, Math.round((width * baked.vh) / baked.vw));
  return (
    <svg
      className={`shr-px ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`${baked.vx} ${baked.vy} ${baked.vw} ${baked.vh}`}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {baked.runs.map((r) => (
        <rect
          key={`${r.y}-${r.x}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={r.fill}
        />
      ))}
    </svg>
  );
}

/** 入口わきの たいまつ（炎 2 枚 ＋ CSS の 灯り） */
export function AtlasTorch({ side }: { side: "l" | "r" }) {
  return (
    <span className={`shr-torch shr-torch--${side}`} aria-hidden>
      <AtlasDungeonIcon name="torch-a" width={18} className="shr-torch__f1" />
      <AtlasDungeonIcon name="torch-b" width={18} className="shr-torch__f2" />
    </span>
  );
}
