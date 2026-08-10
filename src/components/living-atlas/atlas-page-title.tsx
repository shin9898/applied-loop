"use client";

import { usePathname } from "next/navigation";
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
}: {
  title: string;
  sub?: string;
  /** 省略時は pathname から推定 */
  surface?: AtlasSurfaceId;
}) {
  const pathname = usePathname() ?? "/";
  const id = surface ?? surfaceIdFromPathname(pathname);
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h1 className="dq-win-title mb-0 atlas-page-title">
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
