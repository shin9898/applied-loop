import type { ReactNode } from "react";

/** ぼうけんのしょ シェル — DQウィンドウ列 */
export function AtlasShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative mx-auto grid max-w-[1180px] gap-3 px-3.5 py-3.5 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
