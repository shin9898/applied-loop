"use client";

import { useEffect, useRef } from "react";
import { ENEMY_CACHE, paintEnemyFrame } from "./atlas-enemies";

/** LP ヒーロー用のミニバトル構図（本番バトルの見た目を縮小） */
export function LpHeroBattle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    paintEnemyFrame(ctx, ENEMY_CACHE, 0, 2);
    const t = window.setInterval(() => {
      frame = 1 - frame;
      paintEnemyFrame(ctx, ENEMY_CACHE, frame, 2);
    }, 420);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="atlas-enter relative mx-auto mt-10 w-full max-w-md overflow-hidden border-4 border-black shadow-[8px_8px_0_#000] md:mt-0 md:max-w-none"
      style={{ animationDelay: "100ms" }}
      aria-hidden
    >
      <div className="flex items-center justify-between border-b-4 border-black bg-[#001a8c] px-3 py-2">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
          ◆ しれん（理解度チェック）
        </p>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          SAMPLE
        </p>
      </div>

      <div className="relative grid items-center gap-3 bg-[linear-gradient(#2a4a7a_0%,#1a3a18_48%,#0c220c_100%)] px-3 py-4 shadow-[inset_0_0_0_3px_#3d6b3a] sm:grid-cols-[0.9fr_1.2fr] sm:gap-4 sm:px-4">
        <div className="flex flex-col items-center gap-2">
          <div className="border-[3px] border-white bg-[#001a8c] px-2 py-1.5 font-[family-name:var(--font-pixel)] text-[8px] leading-relaxed text-[#f0d25a] shadow-[3px_3px_0_#000]">
            いみキャッシュまぼろし
          </div>
          <canvas
            ref={canvasRef}
            width={64}
            height={64}
            className="dq-enemy-idle h-28 w-28 drop-shadow-[5px_5px_0_#000] sm:h-32 sm:w-32"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="h-2.5 w-16 rounded-[50%] bg-black/35" />
          <div className="w-full max-w-[200px] border-[3px] border-white bg-[#001a8c] px-2 py-1.5 shadow-[3px_3px_0_#000]">
            <div className="mb-1 flex justify-between font-[family-name:var(--font-pixel)] text-[8px] text-[#f7f3d9]">
              <span>GATE HP</span>
              <span>72 / 100</span>
            </div>
            <div className="h-2.5 border-2 border-[#223] bg-black">
              <i
                className="block h-full bg-gradient-to-r from-[#e84848] to-[#f0d25a]"
                style={{ width: "72%" }}
              />
            </div>
          </div>
        </div>

        <div className="border-4 border-white bg-[#001a8c] px-3 py-3 shadow-[4px_4px_0_#000]">
          <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a]">
            つまずきのセリフ
          </p>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#f7f3d9]">
            「このキャッシュ設計、なぜ必要？」
          </p>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[12px] leading-relaxed text-[#c9c3a0]">
            コミットの差分から出た理解チェック。答えるとずかんに残る。
          </p>
        </div>
      </div>

      <div className="border-t-4 border-black bg-[#001a8c] px-3 py-2.5">
        <div className="grid grid-cols-2 gap-2 border-2 border-white bg-[#000c4a] p-2 font-[family-name:var(--font-pixel)] text-[8px] leading-relaxed text-[#f7f3d9]">
          <span className="text-[#f0d25a]">▶ こたえる</span>
          <span className="text-[#9a9470]">　ヒント</span>
          <span className="text-[#9a9470]">　ずかん</span>
          <span className="text-[#9a9470]">　にげる</span>
        </div>
      </div>
    </div>
  );
}
