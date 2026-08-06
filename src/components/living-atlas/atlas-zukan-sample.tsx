"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_ENEMY, paintEnemyFrame } from "./atlas-enemies";

/** ずかん空状態のサンプル像（B7-2） */
export function AtlasZukanSampleSprite({ scale = 3 }: { scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let frame = 0;
    paintEnemyFrame(ctx, DEFAULT_ENEMY, 0, scale);
    const id = window.setInterval(() => {
      frame = (frame + 1) % 2;
      paintEnemyFrame(ctx, DEFAULT_ENEMY, frame, scale);
    }, 480);
    return () => window.clearInterval(id);
  }, [scale]);

  const px = 32 * scale;
  return (
    <canvas
      ref={ref}
      width={px}
      height={px}
      className="block"
      style={{ width: px, height: px, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
