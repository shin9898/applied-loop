import type { CSSProperties } from "react";

/** 実験進捗のリング。入場時に弧が伸びる（Pencil: innerRadius 0.78 / startAngle 90） */
export function ProgressRing({
  ratio,
  size = 72,
  label,
}: {
  ratio: number; // 0〜1
  size?: number;
  label: string;
}) {
  const strokeWidth = size * 0.11;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, ratio));
  const offset = circumference * (1 - clamped);

  const ringStyle = {
    "--ring-circumference": circumference,
    animation: "ring-draw 1s cubic-bezier(0.22, 1, 0.36, 1) both",
  } as CSSProperties;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={ringStyle}
        />
      </svg>
      <span className="absolute font-display text-[17px] font-bold text-ink">
        {label}
      </span>
    </div>
  );
}
