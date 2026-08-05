"use client";

import type { CSSProperties, ReactNode } from "react";

/** 深度方向の入場（blur → sharp）。Y上げスタッガーは使わない。 */
export function AtlasReveal({
  children,
  delayIndex = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delayIndex?: number;
  className?: string;
  as?: "div" | "section" | "aside" | "header";
}) {
  const style = {
    "--motion-delay": `${Math.min(delayIndex, 12) * 70}ms`,
  } as CSSProperties;

  return (
    <Tag className={`atlas-enter ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}
