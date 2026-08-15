"use client";

import { useEffect } from "react";
import { useAtlasRouteLoadingSignal } from "./atlas-route-loading-provider";

/**
 * 各ルートの loading.tsx（Suspense の fallback）に置く合図コンポーネント。
 * 見た目は持たない。マウント/アンマウントで AtlasRouteLoadingProvider に
 * 開始/終了を伝えるだけで、実際に見えるウィンドウは Provider 側が描画する
 * （表示遅延・最小表示時間は fallback 自身では制御できないため分離している）。
 * ホームは hero（大きめ窓）、他ルートは compact（小さめ窓）。
 */
export function AtlasRouteLoading({
  variant = "compact",
}: {
  variant?: "hero" | "compact";
}) {
  const signal = useAtlasRouteLoadingSignal();

  useEffect(() => {
    signal?.notifyStart(variant);
    return () => signal?.notifyEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- マウント/アンマウント一回ずつでよい
  }, []);

  return null;
}
