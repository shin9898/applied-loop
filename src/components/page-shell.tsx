import type { ReactNode } from "react";

/** 一覧・ダッシュボード共通の外枠（design-fundamentals）。 */
export function PageShell({
  children,
  narrow = false,
  className = "",
}: {
  children: ReactNode;
  /** 詳細・長文向け max-w */
  narrow?: boolean;
  className?: string;
}) {
  const width = narrow ? "max-w-[860px]" : "max-w-[1312px]";
  return (
    <div
      className={`relative mx-auto ${width} space-y-8 px-8 py-12 md:px-16 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
