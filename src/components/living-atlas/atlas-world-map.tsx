"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { TerritoryKey, TerritoryStage } from "@/lib/atlas-territory";

export type MapMarker = {
  id: string;
  kind: "you";
  label: string;
  left: string;
  top: string;
};

export type TerritoryState = {
  stage: TerritoryStage;
  /** 静かなチップに出す残数。0またはundefinedならチップを出さない */
  queue?: number;
  queueLabel?: string;
  /** どうぐのみ: trueで炉が赤く燻る */
  danger?: boolean;
  dangerLabel?: string;
};

export type Boat = { id: string; label: string; href: string; left: string; top: string };

type AtlasWorldMapProps = {
  markers?: MapMarker[];
  territories: Record<TerritoryKey, TerritoryState>;
  /** 「！」を立てる領土。resolveHomeCtaの指す先と必ず一致させる（ルール2） */
  activeCtaTerritory: TerritoryKey | null;
  boats?: Boat[];
};

/** 領土＝ページ。クリックでその面の一覧へ入場する（ルール5） */
const TERRITORY: Record<
  TerritoryKey,
  { name: string; href: string; labelPos: { left: string; top: string }; clickZone: { left: string; top: string; width: string; height: string } }
> = {
  nikki: {
    name: "にっき",
    href: "/retro",
    labelPos: { left: "20%", top: "13%" },
    clickZone: { left: "2%", top: "6%", width: "36%", height: "38%" },
  },
  shiren: {
    name: "しれん",
    href: "/gates",
    labelPos: { left: "50%", top: "10%" },
    clickZone: { left: "31%", top: "2%", width: "34%", height: "40%" },
  },
  mokuhyou: {
    name: "もくひょう",
    href: "/goals",
    labelPos: { left: "80%", top: "13%" },
    clickZone: { left: "66%", top: "9%", width: "30%", height: "34%" },
  },
  junbi: {
    name: "じゅんび",
    href: "/setup",
    labelPos: { left: "22%", top: "93%" },
    clickZone: { left: "5%", top: "50%", width: "34%", height: "41%" },
  },
  ukebako: {
    name: "うけばこ",
    href: "/entries",
    labelPos: { left: "55%", top: "93%" },
    clickZone: { left: "36%", top: "50%", width: "38%", height: "41%" },
  },
  dougu: {
    name: "どうぐ",
    href: "/harness",
    labelPos: { left: "82%", top: "93%" },
    clickZone: { left: "69%", top: "56%", width: "27%", height: "30%" },
  },
};

const DEFAULT_MARKERS: MapMarker[] = [
  { id: "you", kind: "you", label: "あなた", left: "22%", top: "64%" },
];

const TILE_REGION: Record<number, TerritoryKey> = {
  1: "nikki",
  2: "shiren",
  3: "mokuhyou",
  4: "junbi",
  5: "ukebako",
  6: "dougu",
};

const BASE: Record<number, string> = {
  0: "#0d2f70",
  7: "#1a4fa8",
  1: "#2a3a5a",
  2: "#1f6b32",
  3: "#8b8f9a",
  4: "#3caa4a",
  5: "#d2b15a",
  6: "#7a4a2a",
};
const SHADE: Record<number, string> = {
  0: "#0a2458",
  7: "#144090",
  1: "#1a2838",
  2: "#145024",
  3: "#6a6e78",
  4: "#2a7a34",
  5: "#b8943e",
  6: "#57331c",
};
/** 段階(0-3) → 彩度・明度。領内の時系列比較専用（領同士は比較不可） */
const VIVID = [0.5, 0.72, 0.88, 1];
/** もくひょうは旗数(0-3)で緩やかに彩る */
const FLAGV = [0.72, 0.82, 0.92, 1];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 彩度・明度をわずかに落として「まだ拓けていない」を作る */
function sat(hex: string, t: number): string {
  const [r, g0, b] = hexToRgb(hex);
  const gray = 0.3 * r + 0.59 * g0 + 0.11 * b;
  const k = 0.82 + 0.18 * t;
  const ch = (v: number) => Math.round((gray + (v - gray) * t) * k);
  return `rgb(${ch(r)},${ch(g0)},${ch(b)})`;
}

type SpriteSet = ReturnType<typeof makeSprites>;

function makeSprites(g: CanvasRenderingContext2D) {
  function R(x: number, y: number, w: number, h: number, c: string) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }
  function spineWindow(x: number, y: number) {
    R(x, y, 4, 4, "#223046");
    R(x, y + 1, 1, 3, "#e84848");
    R(x + 1, y + 1, 1, 3, "#3ecf5a");
    R(x + 2, y + 1, 1, 3, "#f0d25a");
    R(x + 3, y + 1, 1, 3, "#9ec0ff");
  }
  function smoke(sx: number, sy: number, bad: boolean) {
    if (bad) {
      R(sx, sy, 2, 2, "#e84848");
      R(sx + 2, sy - 3, 2, 2, "#a83030");
    } else {
      R(sx, sy, 2, 2, "#cfd6e6");
      R(sx - 2, sy - 2, 2, 2, "#9aa4b8");
      R(sx + 1, sy - 4, 2, 2, "#7a8498");
    }
  }

  return {
    tree(x: number, y: number) {
      R(x + 3, y + 6, 2, 1, "#0a2a10");
      R(x + 2, y + 2, 4, 3, "#4cff6a");
      R(x + 3, y + 1, 2, 1, "#4cff6a");
      R(x + 3, y + 5, 2, 1, "#4cff6a");
    },
    hero(x: number, y: number) {
      R(x + 2, y, 3, 3, "#f7d7b0");
      R(x + 1, y + 3, 5, 3, "#3ecf5a");
      R(x + 1, y + 6, 2, 2, "#223046");
      R(x + 4, y + 6, 2, 2, "#223046");
    },
    /** しれん: かかし → 木の闘技場 → 石の闘技場 → 大コロシアム(金縁) */
    arena(x: number, y: number, s: TerritoryStage) {
      if (s <= 0) {
        R(x + 3, y - 10, 2, 10, "#8a5a20");
        R(x, y - 7, 8, 1, "#8a5a20");
        R(x + 2, y - 13, 4, 3, "#ffe9a0");
        R(x + 1, y - 9, 6, 2, "#d2b15a");
        return;
      }
      if (s === 1) {
        R(x + 1, y - 13, 1, 6, "#8a5a20");
        R(x + 2, y - 13, 4, 3, "#e84848");
        R(x, y - 7, 16, 7, "#8a5a20");
        R(x + 2, y - 5, 12, 4, "#5a3010");
        R(x + 7, y - 3, 3, 3, "#223046");
        return;
      }
      if (s === 2) {
        R(x + 2, y - 17, 1, 8, "#7a808c");
        R(x + 3, y - 17, 5, 3, "#e84848");
        R(x + 19, y - 17, 1, 8, "#7a808c");
        R(x + 14, y - 17, 5, 3, "#e84848");
        for (let i = 0; i < 6; i++) R(x + i * 4, y - 11, 2, 2, "#8b8f9a");
        R(x, y - 9, 22, 9, "#8b8f9a");
        R(x + 2, y - 7, 18, 5, "#555a66");
        R(x + 9, y - 4, 4, 4, "#223046");
        return;
      }
      const poles = [1, 9, 18, 26];
      for (let j = 0; j < 4; j++) {
        R(x + poles[j], y - 24, 1, 8, "#7a808c");
        R(x + poles[j] + 1, y - 24, 5, 3, j % 2 ? "#f0d25a" : "#e84848");
      }
      R(x + 3, y - 17, 22, 1, "#f0d25a");
      R(x + 3, y - 16, 22, 4, "#8b8f9a");
      R(x, y - 12, 28, 12, "#b8bcc8");
      for (let k = 0; k < 6; k++) R(x + 3 + k * 4, y - 8, 2, 5, "#555a66");
      R(x + 12, y - 5, 4, 5, "#223046");
      R(x - 1, y - 14, 2, 2, "#f0d25a");
      R(x + 27, y - 14, 2, 2, "#f0d25a");
    },
    /** にっき: 白紙の机 → 書斎 → 書庫(小塔) → 大図書館(金の頂) */
    library(x: number, y: number, s: TerritoryStage) {
      if (s <= 0) {
        R(x, y - 5, 10, 2, "#8a5a20");
        R(x, y - 3, 1, 3, "#8a5a20");
        R(x + 9, y - 3, 1, 3, "#8a5a20");
        R(x + 3, y - 8, 4, 3, "#f7f3d9");
        return;
      }
      if (s === 1) {
        R(x - 1, y - 9, 14, 2, "#4a7fd4");
        R(x, y - 7, 12, 7, "#e8e2c8");
        R(x + 5, y - 3, 2, 3, "#5a3010");
        spineWindow(x + 1, y - 6);
        return;
      }
      if (s === 2) {
        R(x + 6, y - 19, 6, 2, "#4a7fd4");
        R(x + 7, y - 17, 4, 6, "#e8e2c8");
        R(x - 1, y - 11, 20, 2, "#4a7fd4");
        R(x, y - 9, 18, 9, "#e8e2c8");
        R(x + 8, y - 4, 2, 4, "#5a3010");
        spineWindow(x + 2, y - 7);
        spineWindow(x + 13, y - 7);
        return;
      }
      R(x + 10, y - 29, 7, 3, "#f0d25a");
      R(x + 11, y - 26, 5, 14, "#e8e2c8");
      R(x + 12, y - 22, 3, 3, "#223046");
      R(x + 13, y - 21, 1, 1, "#ffe9a0");
      R(x - 4, y - 8, 4, 1, "#4a7fd4");
      R(x + 26, y - 8, 4, 1, "#4a7fd4");
      R(x - 3, y - 7, 3, 7, "#e8e2c8");
      R(x + 26, y - 7, 3, 7, "#e8e2c8");
      R(x - 1, y - 12, 28, 2, "#4a7fd4");
      R(x, y - 10, 26, 10, "#e8e2c8");
      R(x + 11, y - 5, 3, 5, "#5a3010");
      R(x + 9, y - 5, 1, 2, "#f0d25a");
      R(x + 15, y - 5, 1, 2, "#f0d25a");
      spineWindow(x + 2, y - 8);
      spineWindow(x + 19, y - 8);
    },
    /** もくひょう: 城本体は常設。旗3本、3/3で祝祭 */
    castle(x: number, y: number, flags: TerritoryStage, festive: boolean) {
      R(x, y - 9, 26, 9, "#b8bcc8");
      R(x, y - 15, 5, 7, "#b8bcc8");
      R(x + 21, y - 15, 5, 7, "#b8bcc8");
      R(x + 9, y - 18, 8, 10, "#a8acb8");
      R(x + 11, y - 5, 4, 5, "#223046");
      R(x + 3, y - 7, 2, 2, "#223046");
      R(x + 21, y - 7, 2, 2, "#223046");
      const poles: [number, number, number][] = [
        [x + 2, y - 23, 8],
        [x + 12, y - 26, 8],
        [x + 23, y - 23, 8],
      ];
      for (let i = 0; i < 3; i++) {
        const [px, py, ph] = poles[i];
        R(px, py, 1, ph, "#7a808c");
        if (i < flags) R(px + 1, py, 6, 4, "#f0d25a");
        else R(px + 1, py + 5, 5, 2, "#39406b");
      }
      if (festive) {
        for (let j = 0; j < 13; j++) R(x + j * 2, y - 10 + (j % 2), 1, 1, "#f0d25a");
        R(x - 3, y - 20, 2, 2, "#e84848");
        R(x + 27, y - 22, 2, 2, "#3ecf5a");
        R(x - 4, y - 13, 2, 2, "#9ec0ff");
        R(x + 28, y - 15, 2, 2, "#f0d25a");
        R(x + 10, y - 6, 6, 1, "#f0d25a");
      }
    },
    /** じゅんび: やぐら → 家1 → 家2 → 三軒・畑・街灯の村 */
    village(x: number, y: number, s: TerritoryStage) {
      function houseAt(hx: number, hy: number, w: number) {
        R(hx - 1, hy - 6, w + 2, 2, "#e84848");
        R(hx, hy - 4, w, 3, "#ffe9a0");
        R(hx, hy - 1, w, 1, "#5a3010");
        R(hx + Math.floor(w / 2) - 1, hy - 3, 2, 2, "#5a3010");
      }
      if (s <= 0) {
        R(x, y - 8, 1, 8, "#8a6a3a");
        R(x + 8, y - 8, 1, 8, "#8a6a3a");
        R(x, y - 8, 9, 1, "#8a6a3a");
        R(x, y - 4, 9, 1, "#8a6a3a");
        R(x + 11, y - 2, 7, 2, "#8a5a20");
        return;
      }
      houseAt(x, y, 8);
      if (s === 1) {
        R(x + 12, y - 2, 6, 2, "#8a5a20");
        return;
      }
      houseAt(x + 12, y, 8);
      if (s === 2) {
        R(x + 8, y - 1, 4, 1, "#d2b15a");
        return;
      }
      houseAt(x + 24, y - 2, 6);
      R(x - 4, y - 9, 1, 9, "#8a8a8a");
      R(x - 5, y - 11, 3, 2, "#ffe9a0");
      R(x + 32, y - 9, 1, 9, "#8a8a8a");
      R(x + 31, y - 11, 3, 2, "#ffe9a0");
      R(x, y + 2, 14, 1, "#2a7a34");
      R(x, y + 4, 14, 1, "#2a7a34");
      R(x, y + 6, 14, 1, "#2a7a34");
      R(x + 3, y - 9, 1, 3, "#f0d25a");
    },
    /** うけばこ: 桟橋 → 番小屋 → 倉庫クレーン → 交易港(灯台+帆船)。crates は独立レイヤ */
    port(x: number, y: number, s: TerritoryStage, crates: number) {
      R(x, y, 4, 14, "#5a3010");
      R(x - 2, y + 4, 8, 1, "#3a2008");
      R(x - 2, y + 9, 8, 1, "#3a2008");
      if (s >= 1) {
        R(x - 12, y - 8, 10, 2, "#5a3010");
        R(x - 11, y - 6, 8, 6, "#8a5a20");
        R(x - 8, y - 3, 2, 3, "#223046");
      }
      if (s >= 2) {
        R(x + 6, y - 10, 14, 2, "#5a3010");
        R(x + 7, y - 8, 12, 8, "#a88a4a");
        R(x + 11, y - 3, 3, 3, "#223046");
        R(x + 21, y - 16, 1, 16, "#8a8a8a");
        R(x + 15, y - 16, 7, 1, "#8a8a8a");
        R(x + 15, y - 15, 1, 4, "#d2b15a");
      }
      if (s >= 3) {
        R(x + 24, y - 20, 5, 4, "#e84848");
        R(x + 24, y - 16, 5, 4, "#f7f3d9");
        R(x + 24, y - 12, 5, 4, "#e84848");
        R(x + 24, y - 8, 5, 8, "#f7f3d9");
        R(x + 23, y - 23, 7, 3, "#f0d25a");
        R(x + 30, y - 22, 3, 1, "#ffe9a0");
        R(x + 30, y - 20, 3, 1, "#ffe9a0");
        R(x + 10, y + 2, 4, 10, "#5a3010");
        R(x - 9, y + 6, 8, 3, "#8a5a20");
        R(x - 6, y + 1, 1, 5, "#5a3010");
        R(x - 5, y + 1, 4, 4, "#f7f3d9");
      }
      const spots: [number, number][] = [
        [-8, -13],
        [-2, -13],
        [-8, -19],
        [-2, -19],
        [-5, -24],
      ];
      const n = Math.min(crates, 5);
      for (let i = 0; i < n; i++) {
        const [dx, dy] = spots[i];
        const cx = x + dx;
        const cy = y + dy;
        R(cx, cy, 5, 5, "#8a5a20");
        R(cx + 1, cy + 1, 3, 3, "#d2a35a");
      }
    },
    /** どうぐ: 作業台 → 鍛冶小屋 → 工房(2煙突) → 大工房(3煙突+金の金床) */
    forge(x: number, y: number, s: TerritoryStage, bad: boolean) {
      if (s <= 0) {
        R(x + 1, y - 5, 10, 2, "#8a5a20");
        R(x + 1, y - 3, 1, 3, "#8a5a20");
        R(x + 10, y - 3, 1, 3, "#8a5a20");
        R(x + 4, y - 8, 5, 2, "#555a66");
        R(x + 5, y - 6, 3, 1, "#555a66");
        return;
      }
      if (s === 1) {
        R(x + 9, y - 13, 3, 5, "#555a66");
        R(x - 1, y - 9, 15, 2, "#3a2a1a");
        R(x, y - 7, 13, 7, "#6a4a2a");
        R(x + 2, y - 4, 3, 4, "#223046");
        if (bad) R(x + 7, y - 4, 4, 3, "#e84848");
        smoke(x + 9, y - 16, bad);
        return;
      }
      if (s === 2) {
        R(x + 3, y - 17, 3, 6, "#555a66");
        R(x + 13, y - 15, 3, 4, "#555a66");
        R(x - 1, y - 11, 20, 2, "#3a2a1a");
        R(x, y - 9, 18, 9, "#6a4a2a");
        R(x + 2, y - 5, 3, 5, "#223046");
        R(x + 12, y - 4, 4, 2, "#223046");
        R(x + 8, y - 7, 3, 3, "#8b8f9a");
        if (bad) R(x + 12, y - 8, 4, 3, "#e84848");
        smoke(x + 3, y - 20, bad);
        smoke(x + 13, y - 18, bad);
        return;
      }
      R(x + 3, y - 21, 3, 9, "#555a66");
      R(x + 11, y - 23, 3, 11, "#555a66");
      R(x + 20, y - 19, 3, 7, "#555a66");
      R(x - 1, y - 13, 28, 2, "#3a2a1a");
      R(x, y - 11, 26, 11, "#6a4a2a");
      R(x + 3, y - 6, 4, 6, "#223046");
      R(x + 18, y - 5, 4, 2, "#223046");
      R(x + 10, y - 8, 6, 3, "#f0d25a");
      if (bad) R(x + 18, y - 9, 5, 3, "#e84848");
      smoke(x + 3, y - 24, bad);
      smoke(x + 11, y - 26, bad);
      smoke(x + 20, y - 22, bad);
    },
  };
}

/** 最終段階の領土に散らす活気の粒（花・あかり）。タイルのXY座標(40x27系) */
const SPRINKLES: Record<TerritoryKey, [number, number][]> = {
  nikki: [[3, 4], [12, 10], [4, 10]],
  shiren: [[14, 2], [25, 9], [13, 8]],
  mokuhyou: [[28, 4], [36, 8]],
  junbi: [[3, 22], [14, 16]],
  ukebako: [[17, 23], [27, 16]],
  dougu: [[29, 22], [36, 17]],
};

export function AtlasWorldMap({
  markers = DEFAULT_MARKERS,
  territories,
  activeCtaTerritory,
  boats,
}: AtlasWorldMapProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 40;
    const H = 27;
    const TW = canvas.width / W;
    const TH = canvas.height / H;

    // (fillBlob呼び出し・map構築・浅瀬判定は現行のまま。tile番号の意味だけ
    //  TILE_REGIONに従って1:にっき 2:しれん 3:もくひょう 4:じゅんび 5:うけばこ 6:どうぐ に変わる)
    const map = Array.from({ length: H }, () => Array(W).fill(0));
    function fillBlob(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      tile: number,
      jitter = 0.35,
    ) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          const n =
            Math.sin(x * 1.7 + y * 2.3) * jitter +
            Math.cos(x * 0.9 - y * 1.1) * jitter * 0.6;
          if (nx * nx + ny * ny < 1 + n) map[y][x] = tile;
        }
      }
    }
    fillBlob(8, 7, 7, 5, 1, 0.45);
    fillBlob(20, 6, 8, 5.5, 2, 0.4);
    fillBlob(32, 7, 6, 4.5, 3, 0.35);
    fillBlob(9, 19, 7, 5.5, 4, 0.4);
    fillBlob(22, 19, 8, 5.5, 5, 0.5);
    fillBlob(33, 19, 5.5, 4, 6, 0.55);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (map[y][x] !== 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            ny >= 0 &&
            ny < H &&
            nx >= 0 &&
            nx < W &&
            map[ny][nx] > 0 &&
            map[ny][nx] !== 6
          ) {
            map[y][x] = 7; // 浅瀬（旧実装ではtile 6を浅瀬に使っていたが、6=どうぐと衝突するため7に変更）
            break;
          }
        }
      }
    }

    const tileToTerritory = (t: number): TerritoryKey | null => TILE_REGION[t] ?? null;
    const stageFor = (t: number): number => {
      const key = tileToTerritory(t);
      if (!key) return 3;
      return territories[key]?.stage ?? 0;
    };
    const vividFor = (t: number): number =>
      t === 3 ? FLAGV[stageFor(t)] : VIVID[stageFor(t)];

    const C: Record<number, string> = {};
    const S: Record<number, string> = {};
    for (const key of Object.keys(BASE)) {
      const t = Number(key);
      const v = t === 0 || t === 7 ? 1 : vividFor(t);
      C[t] = v >= 1 ? BASE[t] : sat(BASE[t], v);
      S[t] = v >= 1 ? SHADE[t] : sat(SHADE[t], v);
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = map[y][x];
        ctx.fillStyle = C[t];
        ctx.fillRect(x * TW, y * TH, TW, TH);
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = S[t];
          ctx.fillRect(x * TW, y * TH, TW / 2, TH / 2);
        }
        if ((t === 0 || t === 7) && (x + Math.floor(y / 2)) % 4 === 0) {
          ctx.fillStyle = "#2f74d6";
          ctx.fillRect(x * TW + 1, y * TH + TH * 0.55, TW - 2, 1);
        }
      }
    }

    const sp = makeSprites(ctx);
    const T = (tx: number, ty: number): [number, number] => [tx * TW, ty * TH];

    ([[4, 6], [11, 9], [16, 4], [23, 8], [18, 8], [5, 16], [13, 22], [27, 5]] as const).forEach(
      ([tx, ty]) => {
        const [px, py] = T(tx, ty);
        sp.tree(px, py);
      },
    );

    const nikkiStage = territories.nikki?.stage ?? 0;
    const shirenStage = territories.shiren?.stage ?? 0;
    const mokuhyouFlags = territories.mokuhyou?.stage ?? 0;
    const junbiStage = territories.junbi?.stage ?? 0;
    const ukebakoStage = territories.ukebako?.stage ?? 0;
    const douguStage = territories.dougu?.stage ?? 0;
    const ukebakoQueue = territories.ukebako?.queue ?? 0;
    const douguDanger = territories.dougu?.danger ?? false;

    let p = T(7, 9);
    sp.library(p[0], p[1], nikkiStage);
    p = T(18.2, 7.6);
    sp.arena(p[0], p[1], shirenStage);
    p = T(29, 8.1);
    sp.castle(p[0], p[1], mokuhyouFlags, mokuhyouFlags >= 3);
    p = T(5.2, 19.9);
    sp.village(p[0], p[1], junbiStage);
    p = T(20.7, 21.1);
    sp.port(p[0], p[1], ukebakoStage, Math.min(ukebakoQueue, 5));
    p = T(31, 19.9);
    sp.forge(p[0], p[1], douguStage, douguDanger);

    const maxed: Record<TerritoryKey, boolean> = {
      nikki: nikkiStage >= 3,
      shiren: shirenStage >= 3,
      mokuhyou: mokuhyouFlags >= 3,
      junbi: junbiStage >= 3,
      ukebako: ukebakoStage >= 3,
      dougu: douguStage >= 3,
    };
    for (const key of Object.keys(SPRINKLES) as TerritoryKey[]) {
      if (!maxed[key]) continue;
      SPRINKLES[key].forEach(([sx, sy], i) => {
        ctx.fillStyle = i % 2 ? "#ffe9a0" : "#f0d25a";
        ctx.fillRect(sx * TW + 3, sy * TH + 3, 2, 2);
      });
    }
  }, [territories]);

  return (
    <div className="relative w-full overflow-hidden border-4 border-black aspect-[16/11] bg-[#0d2f70] shadow-[inset_0_0_0_3px_#4a7fd4]">
      <canvas
        ref={ref}
        width={320}
        height={220}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
        aria-hidden
      />
      {(Object.keys(TERRITORY) as TerritoryKey[]).map((key) => {
        const t = TERRITORY[key];
        return (
          <Link
            key={key}
            href={t.href}
            className="atlas-territory-zone absolute z-[4]"
            style={{
              left: t.clickZone.left,
              top: t.clickZone.top,
              width: t.clickZone.width,
              height: t.clickZone.height,
            }}
            aria-label={`${t.name}へ入場`}
          />
        );
      })}
      {(Object.keys(TERRITORY) as TerritoryKey[]).map((key) => (
        <span
          key={key}
          className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 border border-[#ffffff55] bg-[#000c4ae6] px-2 py-1 font-[family-name:var(--font-pixel)] text-[12px] leading-none tracking-wide text-[#c9d6ff] drop-shadow-[2px_2px_0_#000]"
          style={{ left: TERRITORY[key].labelPos.left, top: TERRITORY[key].labelPos.top }}
        >
          {TERRITORY[key].name}
        </span>
      ))}
      {/* 静かなチップ（残数）。z-6でクリックゾーンより上、ただしpointer-events自体は
          有効のままにして良い（同じ領土リンク先へ飛ぶだけなので二重反応にならない） */}
      {(Object.keys(TERRITORY) as TerritoryKey[])
        .filter((key) => territories[key]?.queue)
        .map((key) => (
          <span
            key={key}
            className="pointer-events-none absolute z-[6] -translate-x-1/2 -translate-y-1/2 border-2 border-[#5a6a8a] bg-[#0d2f70] px-1.5 py-1 font-[family-name:var(--font-pixel)] text-[8px] leading-none text-[#9ec0ff] whitespace-nowrap"
            style={{
              left: TERRITORY[key].clickZone.left,
              top: `calc(${TERRITORY[key].clickZone.top} + ${TERRITORY[key].clickZone.height} / 4)`,
            }}
          >
            {territories[key]?.queueLabel ?? `のこり ${territories[key]?.queue}`}
          </span>
        ))}
      {activeCtaTerritory ? (
        <span
          className="pointer-events-none absolute z-[7] -translate-x-1/2 -translate-y-full text-center"
          style={{
            left: TERRITORY[activeCtaTerritory].labelPos.left,
            top: `calc(${TERRITORY[activeCtaTerritory].labelPos.top} + 8%)`,
          }}
        >
          <span
            className="inline-block animate-[dq-bob_0.9s_steps(2)_infinite] whitespace-nowrap border-[3px] border-white bg-[#f0d25a] px-1.5 py-1 font-[family-name:var(--font-pixel)] text-[11px] leading-none text-[#1a1000] shadow-[3px_3px_0_#000]"
          >
            ！
          </span>
          <span className="mx-auto block h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />
        </span>
      ) : null}
      {markers.map((m) => (
        <span
          key={m.id}
          className="pointer-events-none absolute z-[6] -translate-x-1/2 flex flex-col items-center gap-0.5"
          style={{ left: m.left, top: m.top }}
        >
          <span className="atlas-self-avatar" aria-hidden>
            <span className="atlas-self-avatar__frame atlas-self-avatar__frame--1" />
            <span className="atlas-self-avatar__frame atlas-self-avatar__frame--2" />
          </span>
          <span className="inline-block whitespace-nowrap border-[3px] border-white bg-[#001a8c] px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[9px] leading-none text-[#9ec0ff] shadow-[2px_2px_0_#000]">
            {m.label}
          </span>
        </span>
      ))}
      {(boats ?? []).map((b) => (
        <Link
          key={b.id}
          href={b.href}
          className="absolute z-[6] -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1 whitespace-nowrap border-[2px] border-[#5a6a8a] bg-[#0d2f70] px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[9px] leading-none text-[#9ec0ff] no-underline"
          style={{ left: b.left, top: b.top }}
        >
          <span aria-hidden>⛵</span>
          <span>{b.label}</span>
        </Link>
      ))}
    </div>
  );
}
