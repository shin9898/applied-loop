/**
 * うけばこ（ぼうけんしゃギルド 受付所）のドット絵。
 *
 * 既存の `atlas-surface-icons` は単色 16 グリッドだが、受付所の小物は
 * 多色でないと「ふみ／まきもの／すなどけい」の区別がつかない。そこで
 * 「文字グリッド + パレット」を採り、色は 1 文字 1 色で持つ。
 * 絵文字・外部画像は持ち込まない（ADR-0018）。
 */

export type UkeSpriteName =
  | "fumi"
  | "fumi-open"
  | "maki"
  | "suna"
  | "ink"
  | "tomo"
  | "tomo-blink";

type SpriteDef = {
  /** 上から順の行。1 文字 = 1 ドット。"." は透明 */
  rows: readonly string[];
  /** 文字 → 色。currentColor も指定できる（ふみの封蝋が期限で色を変える） */
  palette: Readonly<Record<string, string>>;
};

/** ふみ（未開封の封書）。封蝋 d は currentColor で緊張度を出す */
const SP_FUMI: SpriteDef = {
  palette: { a: "#140c18", b: "#cbbc88", c: "#efe6c0", d: "currentColor" },
  rows: [
    "aaaaaaaaaaaaaaaa",
    "abccccccccccccba",
    "acbccccccccccbca",
    "accbccccccccbcca",
    "acccbccccccbccca",
    "accccbccccbcccca",
    "acccccbddbccccca",
    "acccccddddccccca",
    "acccccddddccccca",
    "accccccddcccccca",
    "acccccccccccccca",
    "aaaaaaaaaaaaaaaa",
  ],
};

/** ひらいた ふみ */
const SP_FUMI_OPEN: SpriteDef = {
  palette: { a: "#140c18", b: "#efe6c0", c: "#cbbc88", d: "#d8c890" },
  rows: [
    "..aaaaaaaaaaaa..",
    "..abbbbbbbbbba..",
    "..abccccccccba..",
    "..abbbbbbbbbba..",
    "..abccccccccba..",
    "..abbbbbbbbbba..",
    "aaaaaaaaaaaaaaaa",
    "acddddddddddddca",
    "adcddddddddddcda",
    "addcddddddddcdda",
    "adddddddddddddda",
    "aaaaaaaaaaaaaaaa",
  ],
};

/** まきもの（くらに おさまった まなび = Entry） */
const SP_MAKI: SpriteDef = {
  palette: {
    a: "#140c18",
    b: "#f0d25a",
    c: "#8a5a28",
    d: "#4a2c10",
    e: "#efe6c0",
    f: "#cbbc88",
  },
  rows: [
    "................",
    "................",
    ".aaa........aaa.",
    ".abbaaaaaaaabba.",
    ".acdeeeeeeeedca.",
    ".acdeeeeeeeedca.",
    ".acdeffffffedca.",
    ".acdeeeeeeeedca.",
    ".acdeffffffedca.",
    ".acdeeeeeeeedca.",
    ".acdeffffffedca.",
    ".acdeeeeeeeedca.",
    ".abbaaaaaaaabba.",
    ".aaa........aaa.",
    "................",
    "................",
  ],
};

/** すなどけい（たいりゅうの しるし） */
const SP_SUNA: SpriteDef = {
  palette: { a: "#140c18", b: "#f0d25a", c: "#0b2a7a" },
  rows: [
    "aaaaaaaa",
    "abbbbbba",
    ".abbbba.",
    "..abba..",
    "...aa...",
    "..acca..",
    ".acbbca.",
    "acbbbbca",
    "abbbbbba",
    "aaaaaaaa",
  ],
};

/** インクつぼと 羽ペン（受付の小物） */
const SP_INK: SpriteDef = {
  palette: {
    a: "#140c18",
    b: "#efe6c0",
    c: "#c9c3a0",
    d: "#1838b0",
    e: "#0a1a44",
  },
  rows: [
    "..........aa..",
    ".........abba.",
    "........abba..",
    ".......abba...",
    "......abca....",
    ".....abba.....",
    "....abca......",
    "...aaba.......",
    "..aaaaaaaa....",
    "..adddddda....",
    "..addeddda....",
    "..aeeeeeea....",
    "..aaaaaaaa....",
  ],
};

const TOMO_PALETTE = {
  a: "#140c18",
  b: "#b88818",
  c: "#f0d25a",
  d: "#d9a83a",
  e: "#fff6d0",
  f: "#ffe08a",
} as const;

/** ともしび（人型でない ランタンの ようれい）。受付に ういている */
const SP_TOMO: SpriteDef = {
  palette: TOMO_PALETTE,
  rows: [
    ".....aaaaaa.....",
    "....aabbbbaa....",
    "....ab....ba....",
    "...aabbbbbbaa...",
    "...abbccccbba...",
    "...abbbbbbbba...",
    "..aaddddddddaa..",
    "..adefffffffda..",
    "..adfaaffaafda..",
    "..adfaaffaafda..",
    "..adffffffffda..",
    "..adfaffffafda..",
    "..adffaaaaffda..",
    "..aaddddddddaa..",
    "...abbbbbbbba...",
    "...abbccccbba...",
    "...aabbbbbbaa...",
    ".....aaaaaa.....",
  ],
};

/** ともしび・まばたき（1 フレームだけ ひかりが とじる） */
const SP_TOMO_BLINK: SpriteDef = {
  palette: TOMO_PALETTE,
  rows: [
    ".....aaaaaa.....",
    "....aabbbbaa....",
    "....ab....ba....",
    "...aabbbbbbaa...",
    "...abbccccbba...",
    "...abbbbbbbba...",
    "..aaddddddddaa..",
    "..adefffffffda..",
    "..adffffffffda..",
    "..adfaaffaafda..",
    "..adffffffffda..",
    "..adfaffffafda..",
    "..adffaaaaffda..",
    "..aaddddddddaa..",
    "...abbbbbbbba...",
    "...abbccccbba...",
    "...aabbbbbbaa...",
    ".....aaaaaa.....",
  ],
};

const SPRITES: Record<UkeSpriteName, SpriteDef> = {
  fumi: SP_FUMI,
  "fumi-open": SP_FUMI_OPEN,
  maki: SP_MAKI,
  suna: SP_SUNA,
  ink: SP_INK,
  tomo: SP_TOMO,
  "tomo-blink": SP_TOMO_BLINK,
};

type Run = { x: number; y: number; w: number; fill: string };

/** 同色の横並びを 1 本の rect にまとめる（DOM ノードを 1/4 以下にする） */
function runsOf(def: SpriteDef): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < def.rows.length; y++) {
    const row = def.rows[y] ?? "";
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (ch === ".") {
        x += 1;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w += 1;
      runs.push({ x, y, w, fill: def.palette[ch] ?? "currentColor" });
      x += w;
    }
  }
  return runs;
}

const RUN_CACHE = new Map<UkeSpriteName, Run[]>();

function cachedRuns(name: UkeSpriteName): Run[] {
  const hit = RUN_CACHE.get(name);
  if (hit) return hit;
  const runs = runsOf(SPRITES[name]);
  RUN_CACHE.set(name, runs);
  return runs;
}

/**
 * ドット絵 1 枚。`width` はドット幅の整数倍にすること（半端だと にじむ）。
 * 高さは元グリッドの比率で決まる。
 */
export function UkeSprite({
  name,
  width,
  className = "",
  label,
}: {
  name: UkeSpriteName;
  /** 表示幅 px。元グリッド幅の整数倍を渡す */
  width: number;
  className?: string;
  /** 読み上げ用。省略で装飾扱い */
  label?: string;
}) {
  const def = SPRITES[name];
  const gw = def.rows[0]?.length ?? 16;
  const gh = def.rows.length;
  const height = Math.round((width * gh) / gw);
  return (
    <svg
      className={`uke-ico ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${gw} ${gh}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cachedRuns(name).map((r) => (
        <rect
          key={`${r.x}-${r.y}-${r.w}`}
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
