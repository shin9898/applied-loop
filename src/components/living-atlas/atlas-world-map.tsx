"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export type MapMarker = {
  id: string;
  kind: "quest" | "clear" | "you";
  label: string;
  left: string;
  top: string;
  /** 指定時はクリックで直行（onSelect より優先） */
  href?: string;
};

type AtlasWorldMapProps = {
  markers?: MapMarker[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** 領（knowledge/harness/cache/design/fog）ごとの明度 0–1。未指定領は満点扱い */
  regionBrightness?: Partial<Record<"knowledge" | "harness" | "cache" | "design" | "fog", number>>;
};

/** タイルの地形カラーを領の明度でnavyへ寄せる。未踏破でも真っ暗にしない下限を持つ */
const BRIGHTNESS_FLOOR = 0.4;
const DIM_BASE: [number, number, number] = [13, 47, 112]; // #0d2f70（水面と同系）

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixToDim(hex: string, brightness: number): string {
  const t = BRIGHTNESS_FLOOR + (1 - BRIGHTNESS_FLOOR) * Math.max(0, Math.min(1, brightness));
  const [r, g, b] = hexToRgb(hex);
  const mr = Math.round(DIM_BASE[0] + (r - DIM_BASE[0]) * t);
  const mg = Math.round(DIM_BASE[1] + (g - DIM_BASE[1]) * t);
  const mb = Math.round(DIM_BASE[2] + (b - DIM_BASE[2]) * t);
  return `rgb(${mr},${mg},${mb})`;
}

const TILE_REGION: Record<number, "knowledge" | "harness" | "cache" | "design" | "fog"> = {
  1: "knowledge",
  2: "harness",
  3: "cache",
  4: "design",
  5: "fog",
};

const DEFAULT_MARKERS: MapMarker[] = [
  { id: "you", kind: "you", label: "あなた", left: "22%", top: "64%" },
];

/** キャンバス上の地形ブロブと対応する領名（ステータスの系統と揃える） */
const REGION_LABELS: {
  id: string;
  name: string;
  left: string;
  top: string;
}[] = [
  { id: "knowledge", name: "知識", left: "20%", top: "34%" },
  { id: "harness", name: "ハーネス", left: "50%", top: "32%" },
  { id: "cache", name: "キャッシュ", left: "80%", top: "34%" },
  { id: "design", name: "設計", left: "22%", top: "78%" },
  { id: "fog", name: "霧帯", left: "62%", top: "78%" },
];

/** system キー → 地図上の領座標。未対応 system は霧帯へフォールバック */
export const SYSTEM_REGION_POS: Record<string, { left: string; top: string }> = {
  knowledge: { left: "20%", top: "40%" },
  harness: { left: "50%", top: "38%" },
  cache: { left: "80%", top: "40%" },
  design: { left: "22%", top: "70%" },
  verification: { left: "62%", top: "70%" },
  premise: { left: "62%", top: "70%" },
};
export const FOG_REGION_POS = { left: "62%", top: "70%" };

export const REGION_LEGEND = [
  { name: "知識", swatch: "#3caa4a" },
  { name: "ハーネス", swatch: "#1f6b32" },
  { name: "キャッシュ", swatch: "#d2b15a" },
  { name: "設計", swatch: "#8b8f9a" },
  { name: "霧帯", swatch: "#2a3a5a" },
] as const;

/** ドットタイルのワールドマップ（知識密度＝まち／き） */
export function AtlasWorldMap({
  markers = DEFAULT_MARKERS,
  activeId,
  onSelect,
  regionBrightness,
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
    const brightnessFor = (tile: number) => {
      const region = TILE_REGION[tile];
      if (!region) return 1;
      return regionBrightness?.[region] ?? 1;
    };
    const C: Record<number, string> = {
      0: "#0d2f70",
      6: "#1a4fa8",
      1: mixToDim("#3caa4a", brightnessFor(1)),
      2: mixToDim("#1f6b32", brightnessFor(2)),
      3: mixToDim("#d2b15a", brightnessFor(3)),
      4: mixToDim("#8b8f9a", brightnessFor(4)),
      5: mixToDim("#2a3a5a", brightnessFor(5)),
    };
    const shade: Record<number, string> = {
      1: mixToDim("#2a7a34", brightnessFor(1)),
      2: mixToDim("#145024", brightnessFor(2)),
      3: mixToDim("#b8943e", brightnessFor(3)),
      4: mixToDim("#6a6e78", brightnessFor(4)),
      5: mixToDim("#1a2838", brightnessFor(5)),
      0: "#0a2458",
      6: "#144090",
    };

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
    fillBlob(33, 19, 5.5, 4, 5, 0.55);

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
            map[y][x] = 6;
            break;
          }
        }
      }
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = map[y][x];
        ctx.fillStyle = C[t];
        ctx.fillRect(x * TW, y * TH, TW, TH);
        if ((x + y) % 2 === 0 && shade[t]) {
          ctx.fillStyle = shade[t];
          ctx.fillRect(x * TW, y * TH, TW / 2, TH / 2);
        }
        if ((t === 0 || t === 6) && (x + Math.floor(y / 2)) % 4 === 0) {
          ctx.fillStyle = "#2f74d6";
          ctx.fillRect(x * TW + 1, y * TH + TH * 0.55, TW - 2, 1);
        }
      }
    }

    function pix(tx: number, ty: number, color: string, cells: number[][]) {
      if (!ctx) return;
      ctx.fillStyle = color;
      for (const [cx, cy] of cells) {
        ctx.fillRect(tx * TW + cx, ty * TH + cy, 1, 1);
      }
    }
    function tree(tx: number, ty: number) {
      pix(tx, ty, "#0a2a10", [
        [3, 6],
        [4, 6],
      ]);
      pix(tx, ty, "#4cff6a", [
        [2, 2],
        [3, 1],
        [4, 1],
        [5, 2],
        [2, 3],
        [3, 2],
        [4, 2],
        [5, 3],
        [3, 3],
        [4, 3],
        [3, 4],
        [4, 4],
      ]);
    }
    function town(tx: number, ty: number) {
      pix(tx, ty, "#5a3010", [
        [2, 5],
        [3, 5],
        [4, 5],
        [5, 5],
      ]);
      pix(tx, ty, "#ffe9a0", [
        [2, 3],
        [3, 3],
        [4, 3],
        [5, 3],
        [2, 4],
        [5, 4],
      ]);
      pix(tx, ty, "#e84848", [
        [2, 2],
        [3, 1],
        [4, 1],
        [5, 2],
      ]);
    }

    [
      [6, 5],
      [7, 6],
      [8, 4],
      [9, 7],
      [5, 8],
      [17, 4],
      [18, 5],
      [19, 3],
      [20, 6],
      [21, 4],
      [22, 5],
    ].forEach(([x, y]) => tree(x, y));
    [
      [7, 7],
      [9, 5],
      [18, 6],
      [21, 5],
      [19, 7],
      [30, 5],
      [31, 6],
      [33, 5],
      [9, 20],
    ].forEach(([x, y]) => town(x, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regionBrightness は初回ロード時に確定するデータ
  }, [regionBrightness]);

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
      {/* 領名はピンより薄く、地形の上に常時表示 */}
      {REGION_LABELS.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 border border-[#ffffff55] bg-[#000c4ae6] px-2 py-1 font-[family-name:var(--font-pixel)] text-[12px] leading-none tracking-wide text-[#c9d6ff] drop-shadow-[2px_2px_0_#000]"
          style={{ left: r.left, top: r.top }}
        >
          {r.name}
        </span>
      ))}
      {markers.map((m) => {
        const pinBody =
          m.kind === "you" ? (
            <span className="flex flex-col items-center gap-0.5">
              <span
                className={`atlas-self-avatar ${activeId === m.id ? "atlas-self-avatar--active" : ""}`}
                aria-hidden
              >
                <span className="atlas-self-avatar__frame atlas-self-avatar__frame--1" />
                <span className="atlas-self-avatar__frame atlas-self-avatar__frame--2" />
              </span>
              <span className="inline-block whitespace-nowrap border-[3px] border-white bg-[#001a8c] px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[9px] leading-none text-[#9ec0ff] shadow-[2px_2px_0_#000]">
                {m.label}
              </span>
            </span>
          ) : (
            <>
              <span
                className={`inline-block whitespace-nowrap border-[3px] border-white px-1.5 py-1 font-[family-name:var(--font-pixel)] text-[10px] leading-none shadow-[3px_3px_0_#000] ${
                  m.kind === "quest"
                    ? "animate-[dq-bob_0.9s_steps(2)_infinite] bg-[#f0d25a] text-[#1a1000]"
                    : "bg-[#001a8c] text-[#3ecf5a]"
                } ${activeId === m.id ? "outline outline-2 outline-[#f0d25a]" : ""}`}
              >
                {m.label}
              </span>
              <span className="mx-auto block h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />
            </>
          );
        const positionStyle = { left: m.left, top: m.top } as const;
        if (m.href) {
          return (
            <Link
              key={m.id}
              href={m.href}
              onClick={() => onSelect?.(m.id)}
              className="absolute z-[6] -translate-x-1/2 -translate-y-full no-underline"
              style={positionStyle}
            >
              {pinBody}
            </Link>
          );
        }
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect?.(m.id)}
            className="absolute z-[6] -translate-x-1/2 -translate-y-full border-0 bg-transparent p-0"
            style={positionStyle}
          >
            {pinBody}
          </button>
        );
      })}
    </div>
  );
}
