import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import {
  BRAND_COLORS,
  BRAND_GRID,
  BRAND_ROWS,
} from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — 同一ピクセルグリッドを拡大 */
export default function AppleIcon() {
  const cell = size.width / BRAND_GRID;
  const tiles: ReactNode[] = [];
  for (let y = 0; y < BRAND_GRID; y++) {
    const row = BRAND_ROWS[y] ?? "";
    for (let x = 0; x < BRAND_GRID; x++) {
      const ch = row[x] ?? ".";
      if (ch === ".") continue;
      const fill = BRAND_COLORS[ch];
      if (!fill || fill === "transparent") continue;
      tiles.push(
        <div
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: x * cell,
            top: y * cell,
            width: cell,
            height: cell,
            backgroundColor: fill,
          }}
        />,
      );
    }
  }
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: BRAND_COLORS.N,
        }}
      >
        {tiles}
      </div>
    ),
    { ...size },
  );
}
