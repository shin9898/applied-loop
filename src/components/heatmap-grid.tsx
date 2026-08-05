import type { HeatmapCell, HeatmapCellStatus } from "@/lib/heatmap";

const STATUS_COLOR: Record<HeatmapCellStatus, string> = {
  empty: "bg-border",
  passed: "bg-[#6D9C7F]",
  failed: "bg-[#D9A441]",
  resolved: "bg-accent",
};

const LEGEND: { status: HeatmapCellStatus; label: string }[] = [
  { status: "passed", label: "合格" },
  { status: "failed", label: "つまずき発生" },
  { status: "resolved", label: "つまずき解消" },
  { status: "empty", label: "記録なし" },
];

export function HeatmapGrid({ weeks }: { weeks: HeatmapCell[][] }) {
  return (
    <div>
      <div className="flex gap-1 pt-3">
        {weeks.map((days, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {days.map((cell) => (
              <div
                key={cell.dateKey}
                title={cell.label}
                className={`h-[15px] w-[15px] rounded-[3px] ${STATUS_COLOR[cell.status]}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
        {LEGEND.map((item) => (
          <div key={item.status} className="flex items-center gap-1.5">
            <span
              className={`h-[11px] w-[11px] rounded-[3px] ${STATUS_COLOR[item.status]}`}
            />
            <span className="text-[11px] text-ink-secondary">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeeklyBarChart({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="flex h-[92px] items-end gap-1 pt-2">
      {counts.map((count, i) => {
        const isLatest = i === counts.length - 1;
        const height = count === 0 ? 6 : 6 + Math.round((count / max) * 78);
        return (
          <div
            key={i}
            title={`${count}件`}
            className={`flex-1 rounded-[3px] ${
              isLatest ? "bg-accent" : "bg-accent/30"
            }`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}
