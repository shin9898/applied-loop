import type { ReactNode } from "react";
import { AtlasCommandDock } from "./atlas-command-dock";

export type AtlasChromeActive =
  | "/"
  | "/zukan"
  | "/gates"
  | "/goals"
  | "/harness"
  | "/entries"
  | "/requirements"
  | "/setup"
  | "/retro"
  | "/gates/[id]";

/**
 * ぼうけんのしょ シェル。
 * ナビはユーザー操作のコマンドドック（畳む／開く／ドラッグ移動）。全幅ヘッダーは置かない。
 */
export function AtlasChrome({
  streakDays,
  children,
}: {
  /** @deprecated ドックが pathname でアクティブ判定するため未使用。呼び出し互換のため残す */
  active?: AtlasChromeActive;
  streakDays?: number;
  children: ReactNode;
}) {
  return (
    <div className="atlas-dq-root atlas-chrome">
      {children}
      <AtlasCommandDock streakDays={streakDays} />
    </div>
  );
}

export function AtlasPageTitle({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h1 className="dq-win-title mb-0">{title}</h1>
      {sub ? <p className="m-0 text-[14px] text-[#c9c3a0]">{sub}</p> : null}
    </div>
  );
}
