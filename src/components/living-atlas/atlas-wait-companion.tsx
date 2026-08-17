"use client";

import { useEffect, useRef } from "react";
import { MEKURIN, paintMekurinFrame } from "./atlas-mekurin";

const SCALE = 3;
const BLINK_INTERVAL_MS = 2600;
const BLINK_HOLD_MS = 160;

export function AtlasWaitCompanion({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    paintMekurinFrame(ctx, MEKURIN, 0, SCALE);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    let blinkTimeout: number | null = null;
    const blinkInterval = window.setInterval(() => {
      paintMekurinFrame(ctx, MEKURIN, 1, SCALE);
      blinkTimeout = window.setTimeout(() => {
        paintMekurinFrame(ctx, MEKURIN, 0, SCALE);
      }, BLINK_HOLD_MS);
    }, BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(blinkInterval);
      if (blinkTimeout) window.clearTimeout(blinkTimeout);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="atlas-wait-companion" role="status" aria-live="polite">
      <span className="atlas-wait-companion__aura" aria-hidden />
      <span className="atlas-wait-companion__ring" aria-hidden />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--0"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--1"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--2"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--3"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="atlas-wait-companion__canvas"
        width={MEKURIN.width * SCALE}
        height={MEKURIN.height * SCALE}
        aria-hidden
      />
    </div>
  );
}
