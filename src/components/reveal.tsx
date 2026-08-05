"use client";

import type { CSSProperties, ReactNode } from "react";

/** ページ入場のフェードアップ。delayIndex でスタッガー（60ms 刻み）。 */
export function Reveal({
  children,
  delayIndex = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delayIndex?: number;
  className?: string;
  as?: "div" | "section" | "li" | "header";
}) {
  const style = {
    "--motion-delay": `${Math.min(delayIndex, 12) * 60}ms`,
  } as CSSProperties;

  return (
    <Tag className={`motion-enter ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}
