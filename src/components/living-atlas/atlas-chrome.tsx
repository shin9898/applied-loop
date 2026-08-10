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

/** 各面ウィンドウの表札（アイコン付き） */
export { AtlasPageTitle } from "./atlas-page-title";

/**
 * ぼうけんのしょ シェル。
 * ブランドロックアップは LP のみ。アプリ内はコマンドドック＋各面の表札。
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
