/**
 * ぼうけんのしょ — 面ごとのピクセルアイコン（DQ / Atlas 調）。
 * メニュー・ページタイトルで共有。
 */

export type AtlasSurfaceId =
  | "map"
  | "gates"
  | "zukan"
  | "setup"
  | "entries"
  | "goals"
  | "harness"
  | "requirements"
  | "retro";

const HREF_TO_SURFACE: { prefix: string; id: AtlasSurfaceId }[] = [
  { prefix: "/gates", id: "gates" },
  { prefix: "/zukan", id: "zukan" },
  { prefix: "/setup", id: "setup" },
  { prefix: "/entries", id: "entries" },
  { prefix: "/inbox", id: "entries" },
  { prefix: "/goals", id: "goals" },
  { prefix: "/harness", id: "harness" },
  { prefix: "/requirements", id: "requirements" },
  { prefix: "/retro", id: "retro" },
  { prefix: "/digest", id: "entries" },
  { prefix: "/experiments", id: "entries" },
];

export function surfaceIdFromHref(href: string): AtlasSurfaceId {
  if (href === "/") return "map";
  for (const row of HREF_TO_SURFACE) {
    if (href === row.prefix || href.startsWith(`${row.prefix}/`)) {
      return row.id;
    }
  }
  return "map";
}

export function surfaceIdFromPathname(pathname: string): AtlasSurfaceId {
  return surfaceIdFromHref(pathname);
}

/** 面ごとのアクセント色（メニュー・表札で共有） */
export const SURFACE_COLORS: Record<AtlasSurfaceId, string> = {
  map: "#6eb5ff",
  gates: "#e84848",
  zukan: "#3ecf5a",
  setup: "#f0d25a",
  entries: "#e8d4a0",
  goals: "#ff9f43",
  harness: "#7ec8c8",
  requirements: "#9ec0ff",
  retro: "#f0d25a",
};

export function surfaceColor(surface: AtlasSurfaceId): string {
  return SURFACE_COLORS[surface];
}

type PixelIconProps = {
  size?: number;
  className?: string;
  /** 線・塗り。未指定は currentColor */
  color?: string;
};

/** 16 グリッドのピクセルを SVG にする */
function PixelIcon({
  pixels,
  size = 16,
  className,
  color = "currentColor",
}: PixelIconProps & { pixels: readonly string[] }) {
  const rects: { x: number; y: number }[] = [];
  for (let y = 0; y < pixels.length; y++) {
    const row = pixels[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#") rects.push({ x, y });
    }
  }
  const grid = 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {rects.map((r) => (
        <rect
          key={`${r.x}-${r.y}`}
          x={r.x}
          y={r.y}
          width={1}
          height={1}
          fill={color}
        />
      ))}
    </svg>
  );
}

/** ちず — 地図の巻物 */
const PIX_MAP = [
  "................",
  "..##############",
  "..#............#",
  ".##..##..##..###",
  ".#.............#",
  ".#..########...#",
  ".#..#......#...#",
  ".#..#..##..#...#",
  ".#..#......#...#",
  ".#..########...#",
  ".#.............#",
  ".##..##..##..###",
  "..#............#",
  "..##############",
  "................",
  "................",
] as const;

/** しれん — 剣 */
const PIX_GATES = [
  "................",
  ".......##.......",
  "......####......",
  "......####......",
  "......####......",
  "......####......",
  "......####......",
  "....########....",
  "......####......",
  "......####......",
  ".......##.......",
  ".......##.......",
  "......####......",
  ".....######.....",
  "......####......",
  "................",
] as const;

/** ずかん — 図鑑の本＋目玉 */
const PIX_ZUKAN = [
  "................",
  "..############..",
  "..#....##....#..",
  "..#....##....#..",
  "..#.####.####.#.",
  "..#.#..##..#.#..",
  "..#.#.####.#.#..",
  "..#.#..##..#.#..",
  "..#.####.####.#.",
  "..#....##....#..",
  "..#....##....#..",
  "..#....##....#..",
  "..############..",
  "................",
  "................",
  "................",
] as const;

/** じゅんび — 宝箱 */
const PIX_SETUP = [
  "................",
  "................",
  "...##########...",
  "..############..",
  "..#####..#####..",
  "..####.##.####..",
  "..##############",
  "..#............#",
  "..#..########..#",
  "..#..#......#..#",
  "..#..########..#",
  "..#............#",
  "..##############",
  "................",
  "................",
  "................",
] as const;

/** にっき — 羽ペンと紙 */
const PIX_ENTRIES = [
  "................",
  "............##..",
  "...........###..",
  "..........##.#..",
  ".........##..#..",
  "..##########.#..",
  "..#........##...",
  "..#.###.........",
  "..#.............",
  "..#.###.........",
  "..#.............",
  "..#.###.........",
  "..#.............",
  "..##############",
  "................",
  "................",
] as const;

/** もくひょう — 旗 */
const PIX_GOALS = [
  "................",
  "...##...........",
  "...##########...",
  "...##......##...",
  "...##########...",
  "...##...........",
  "...##...........",
  "...##...........",
  "...##...........",
  "...##...........",
  "...##...........",
  "..####..........",
  ".######.........",
  "................",
  "................",
  "................",
] as const;

/** どうぐ — スパナ */
const PIX_HARNESS = [
  "................",
  "....####........",
  "...##..##.......",
  "...##..##.......",
  "....####.##.....",
  ".........###....",
  "..........###...",
  "...........###..",
  "......##....##..",
  ".....##.##.###..",
  "....##...####...",
  "...##.....##....",
  "...##....##.....",
  "....####........",
  "................",
  "................",
] as const;

/** ようけん — チェックリスト */
const PIX_REQ = [
  "................",
  "..##############",
  "..#............#",
  "..#.##....####.#",
  "..#..##........#",
  "..#.##....####.#",
  "..#............#",
  "..#.##....####.#",
  "..#..##........#",
  "..#.##....####.#",
  "..#............#",
  "..#.......####.#",
  "..#............#",
  "..##############",
  "................",
  "................",
] as const;

/** きょうのしょ — 開き本＋太陽 */
const PIX_RETRO = [
  ".......##.......",
  "......####......",
  "...##.####.##...",
  "....##########..",
  "..###..##..###..",
  "..#....##....#..",
  "..#.##.##.##.#..",
  "..#....##....#..",
  "..#.##.##.##.#..",
  "..#....##....#..",
  "..###..##..###..",
  "....##########..",
  "................",
  "................",
  "................",
  "................",
] as const;

const SURFACE_PIXELS: Record<AtlasSurfaceId, readonly string[]> = {
  map: PIX_MAP,
  gates: PIX_GATES,
  zukan: PIX_ZUKAN,
  setup: PIX_SETUP,
  entries: PIX_ENTRIES,
  goals: PIX_GOALS,
  harness: PIX_HARNESS,
  requirements: PIX_REQ,
  retro: PIX_RETRO,
};

export function AtlasSurfaceIcon({
  surface,
  size = 16,
  className,
  color,
}: {
  surface: AtlasSurfaceId;
  size?: number;
  className?: string;
  /** 省略時は面ごとのアクセント色 */
  color?: string;
}) {
  return (
    <PixelIcon
      pixels={SURFACE_PIXELS[surface]}
      size={size}
      className={className}
      color={color ?? SURFACE_COLORS[surface]}
    />
  );
}
