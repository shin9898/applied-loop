"use client";

import { useId } from "react";
import type { QuadrantFlows } from "@/lib/quadrant";
import { QuadrantMap } from "@/components/quadrant-map";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";

/** ちしきの4つのくに — デフォルト閉じのアコーディオン */
export function AtlasZukanQuadrant({ flows }: { flows: QuadrantFlows }) {
  const panelId = useId();
  return (
    <section className="dq-win atlas-zukan-quadrant">
      <details className="atlas-zukan-quadrant__details">
        <summary className="atlas-zukan-quadrant__summary">
          <span className="atlas-zukan-quadrant__summary-main">
            <AtlasSurfaceIcon surface="zukan" size={16} />
            <span className="atlas-zukan-quadrant__summary-text">
              <span className="atlas-zukan-quadrant__title">
                ちしきの4つのくに
              </span>
              <span className="atlas-zukan-quadrant__sub">
                {flows.weekKey} の流れ · タップでひらく
              </span>
            </span>
          </span>
          <span className="atlas-zukan-quadrant__chevron" aria-hidden>
            ▸
          </span>
        </summary>
        <div className="atlas-zukan-quadrant__body" id={panelId}>
          <p className="mb-3 mt-0 text-[12px] leading-relaxed text-[#c9c3a0]">
            未知の未知〜知の知。今週どこが動いたかを見る地図じゃ（ちずの CTA
            は触らない）。ずかん本の外に当面残す。
          </p>
          <QuadrantMap flows={flows} />
        </div>
      </details>
    </section>
  );
}
