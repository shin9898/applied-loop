"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Variant = "hero" | "compact";

type RouteLoadingSignal = {
  notifyStart: (variant: Variant) => void;
  notifyEnd: () => void;
};

const AtlasRouteLoadingCtx = createContext<RouteLoadingSignal | null>(null);

/** 200ms未満で終わる遷移は一切見せない（チラつき防止） */
const SHOW_DELAY_MS = 200;
/** 一度出たら最低でも400msは表示を保つ（出た瞬間消えるチラつき防止） */
const MIN_DURATION_MS = 400;

/**
 * ページ遷移ロードUIの表示/非表示を、Suspense の fallback マウント/アンマウント
 * とは切り離して制御する。fallback 自身（AtlasRouteLoading）は見た目を持たず、
 * マウント/アンマウントで notifyStart/notifyEnd を呼ぶだけ。実際に見える
 * ウィンドウはここ（レイアウト直下の常駐コンポーネント）が描画する。
 * Suspense の fallback は「実データが揃った瞬間」に問答無用でアンマウントされるため、
 * fallback 側から最小表示時間を制御することはできない — それがこの分離の理由。
 */
export function AtlasRouteLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<Variant>("compact");

  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number | null>(null);

  const notifyStart = useCallback((v: Variant) => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (delayTimer.current || shownAt.current !== null) {
      // 既に遅延待ち、または表示中（連続遷移）: variant だけ更新
      setVariant(v);
      return;
    }
    delayTimer.current = setTimeout(() => {
      delayTimer.current = null;
      shownAt.current = Date.now();
      setVariant(v);
      setVisible(true);
    }, SHOW_DELAY_MS);
  }, []);

  const notifyEnd = useCallback(() => {
    if (delayTimer.current) {
      // 200ms未満で終わった: 一度も表示せずに終える
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
      return;
    }
    if (shownAt.current === null) return;
    const elapsed = Date.now() - shownAt.current;
    const remaining = MIN_DURATION_MS - elapsed;
    if (remaining <= 0) {
      shownAt.current = null;
      setVisible(false);
    } else {
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        shownAt.current = null;
        setVisible(false);
      }, remaining);
    }
  }, []);

  return (
    <AtlasRouteLoadingCtx.Provider value={{ notifyStart, notifyEnd }}>
      {children}
      {visible ? <AtlasRouteLoadingWindow variant={variant} /> : null}
    </AtlasRouteLoadingCtx.Provider>
  );
}

export function useAtlasRouteLoadingSignal() {
  return useContext(AtlasRouteLoadingCtx);
}

function AtlasRouteLoadingWindow({ variant }: { variant: Variant }) {
  return (
    <div
      className={`atlas-route-loading-overlay atlas-route-loading-overlay--${variant}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`atlas-route-loading dq-win atlas-route-loading--${variant}`}
      >
        <div className="atlas-route-loading__stage">
          <div className="atlas-route-loading__walker" />
        </div>
        <p className="atlas-route-loading__label">
          {variant === "hero" ? "せかいを " : ""}
          <span className="atlas-route-loading__gold">よみこみちゅう</span> ……
        </p>
      </div>
    </div>
  );
}
