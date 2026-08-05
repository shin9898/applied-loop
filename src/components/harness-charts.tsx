import type { ShareSlice, WeeklyTokenBreakdown } from "@/lib/harness-stats";

const STACK: {
  key: keyof Omit<WeeklyTokenBreakdown, "weekKey">;
  label: string;
  color: string;
}[] = [
  { key: "cacheRead", label: "cache read", color: "#6D9C7F" },
  { key: "cacheCreate", label: "cache create", color: "#A8832F" },
  { key: "tokensIn", label: "input", color: "#8A7C66" },
  { key: "tokensOut", label: "output", color: "#BC5B33" },
  { key: "thinking", label: "thinking", color: "#5B7C9C" },
];

/** 週次 token 内訳の積み上げ棒 (SVG、チャートライブラリ不使用) */
export function TokenStackChart({ weeks }: { weeks: WeeklyTokenBreakdown[] }) {
  const totals = weeks.map(
    (w) => w.cacheRead + w.cacheCreate + w.tokensIn + w.tokensOut + w.thinking
  );
  const max = Math.max(1, ...totals);
  const width = 480;
  const height = 180;
  const padL = 8;
  const padB = 28;
  const padT = 8;
  const chartH = height - padB - padT;
  const gap = 8;
  const barW = (width - padL * 2 - gap * (weeks.length - 1)) / weeks.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full max-w-[520px]"
        role="img"
        aria-label="週次トークン内訳"
      >
        {weeks.map((w, i) => {
          const x = padL + i * (barW + gap);
          let y = padT + chartH;
          const segments = STACK.map((s) => ({
            ...s,
            value: w[s.key],
          })).filter((s) => s.value > 0);
          return (
            <g key={w.weekKey}>
              {segments.map((s) => {
                const h = (s.value / max) * chartH;
                y -= h;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, 0)}
                    fill={s.color}
                    rx={2}
                  >
                    <title>
                      {w.weekKey} {s.label}: {s.value.toLocaleString()}
                    </title>
                  </rect>
                );
              })}
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                fill="#8A7C66"
                fontSize="10"
              >
                {w.weekKey.replace(/^\d{4}-/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {STACK.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: s.color }}
            />
            <span className="text-[11px] text-ink-secondary">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SHARE_COLORS = ["#BC5B33", "#6D9C7F", "#A8832F", "#5B7C9C", "#8A7C66", "#B8AB90"];

/** 構成比の横棒 */
export function ShareBars({
  title,
  slices,
}: {
  title: string;
  slices: ShareSlice[];
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  if (slices.length === 0) {
    return (
      <div>
        <p className="mb-2 text-xs text-ink-secondary">{title}</p>
        <p className="text-sm text-ink-faint">まだデータがありません</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-secondary">{title}</p>
      {slices.slice(0, 8).map((s, i) => {
        const pct = Math.round((s.value / total) * 100);
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="truncate text-ink">{s.label}</span>
              <span className="shrink-0 text-ink-faint">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: SHARE_COLORS[i % SHARE_COLORS.length],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
