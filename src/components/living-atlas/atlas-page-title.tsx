"use client";

import { usePathname } from "next/navigation";
import type { Ref } from "react";
import {
  AtlasSurfaceIcon,
  surfaceIdFromPathname,
  type AtlasSurfaceId,
} from "./atlas-surface-icons";

/**
 * 各面ウィンドウの表札。アイコンは面ID or 現在パスから自動。
 */
export function AtlasPageTitle({
  title,
  sub,
  surface,
  ref,
}: {
  title: string;
  sub?: string;
  /** 省略時は pathname から推定 */
  surface?: AtlasSurfaceId;
  /**
   * 起動元を持たないモーダル（AtlasWorldIntroModal等）を閉じた時の
   * フォーカス復帰先として呼び出し元が保持する。このコンポーネントは
   * 同一ページに複数回描画されうる（AtlasHarnessの各セクション等）
   * ため、id直書きではなく呼び出し元スコープのrefで渡す（opus2周目
   * レビュー指摘: idだと重複するページがあった、2026-08-18）
   */
  ref?: Ref<HTMLHeadingElement>;
}) {
  const pathname = usePathname() ?? "/";
  const id = surface ?? surfaceIdFromPathname(pathname);
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h1
        ref={ref}
        tabIndex={-1}
        className="dq-win-title mb-0 atlas-page-title"
      >
        <AtlasSurfaceIcon
          surface={id}
          size={18}
          className="atlas-page-title__icon"
        />
        <span>{title}</span>
      </h1>
      {sub ? <p className="m-0 text-[14px] text-[#c9c3a0]">{sub}</p> : null}
    </div>
  );
}
