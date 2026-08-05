import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST, shortDateJST } from "@/lib/date";

export type HeatmapCellStatus =
  | "empty"
  | "passed"
  | "failed"
  | "resolved";

export type HeatmapCell = {
  dateKey: string;
  label: string; // "M/D — 状態"
  status: HeatmapCellStatus;
};

export type HeatmapData = {
  /** 12週 × 7日 (月曜始まり)。weeks[w][d] */
  weeks: HeatmapCell[][];
};

const STATUS_LABEL: Record<HeatmapCellStatus, string> = {
  empty: "記録なし",
  passed: "合格",
  failed: "つまずき発生",
  resolved: "つまずき解消",
};

const DAY_MS = 86400000;
const WEEKS = 12;

function dayOfWeekMonday0(d: Date): number {
  // JST 日曜=0 … 土曜=6 → 月曜=0 … 日曜=6
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const sun0 = jst.getUTCDay();
  return sun0 === 0 ? 6 : sun0 - 1;
}

function mondayOfWeek(d: Date): Date {
  const start = dayStartJST(d);
  const offset = dayOfWeekMonday0(d);
  return new Date(start.getTime() - offset * DAY_MS);
}

/** 優先度: resolved > failed > passed > empty */
function pickStatus(
  hasResolved: boolean,
  hasFailed: boolean,
  hasPassed: boolean
): HeatmapCellStatus {
  if (hasResolved) return "resolved";
  if (hasFailed) return "failed";
  if (hasPassed) return "passed";
  return "empty";
}

/**
 * 直近12週 (84セル) の理解の地形ヒートマップ。
 * 週カラム × 7日 (月曜始まり)、JST 基準。
 */
export async function buildHeatmap(now: Date = new Date()): Promise<HeatmapData> {
  const thisMonday = mondayOfWeek(now);
  // 12週前の月曜 (今日の週を含む)
  const rangeStart = new Date(thisMonday.getTime() - (WEEKS - 1) * 7 * DAY_MS);
  const rangeEnd = new Date(dayStartJST(now).getTime() + DAY_MS);

  const [gates, misconceptions] = await Promise.all([
    prisma.gate.findMany({
      where: {
        OR: [
          { gradedAt: { gte: rangeStart, lt: rangeEnd } },
          { answeredAt: { gte: rangeStart, lt: rangeEnd } },
        ],
      },
      select: { status: true, gradedAt: true, answeredAt: true },
    }),
    prisma.misconception.findMany({
      where: {
        status: "resolved",
        resolvedAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { resolvedAt: true },
    }),
  ]);

  const passedDays = new Set<string>();
  const failedDays = new Set<string>();
  for (const g of gates) {
    const at = g.gradedAt ?? g.answeredAt;
    if (!at) continue;
    const key = dateKeyJST(at);
    if (["passed", "self_graded_pass"].includes(g.status)) {
      passedDays.add(key);
    } else if (["failed", "self_graded_fail"].includes(g.status)) {
      failedDays.add(key);
    }
  }

  const resolvedDays = new Set<string>();
  for (const m of misconceptions) {
    if (m.resolvedAt) resolvedDays.add(dateKeyJST(m.resolvedAt));
  }

  const weeks: HeatmapCell[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(rangeStart.getTime() + w * 7 * DAY_MS);
    const days: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * DAY_MS);
      const dateKey = dateKeyJST(day);
      // 未来の日は empty
      const isFuture = day.getTime() > dayStartJST(now).getTime();
      const status = isFuture
        ? "empty"
        : pickStatus(
            resolvedDays.has(dateKey),
            failedDays.has(dateKey),
            passedDays.has(dateKey)
          );
      days.push({
        dateKey,
        label: `${shortDateJST(day)} — ${STATUS_LABEL[status]}`,
        status,
      });
    }
    weeks.push(days);
  }

  return { weeks };
}

export type ResolvedGrowth = {
  totalResolved: number;
  thisWeekDelta: number;
  /** 直近12週の週次 resolved 件数 (古い→新しい) */
  weeklyCounts: number[];
};

/** 解消した誤解の累計 + 週次棒グラフ用データ */
export async function resolvedGrowthStats(
  now: Date = new Date()
): Promise<ResolvedGrowth> {
  const thisMonday = mondayOfWeek(now);
  const rangeStart = new Date(thisMonday.getTime() - (WEEKS - 1) * 7 * DAY_MS);
  const thisWeekEnd = new Date(thisMonday.getTime() + 7 * DAY_MS);

  const [totalResolved, resolved] = await Promise.all([
    prisma.misconception.count({ where: { status: "resolved" } }),
    prisma.misconception.findMany({
      where: {
        status: "resolved",
        resolvedAt: { gte: rangeStart },
      },
      select: { resolvedAt: true },
    }),
  ]);

  const weeklyCounts = Array.from({ length: WEEKS }, () => 0);
  let thisWeekDelta = 0;
  for (const m of resolved) {
    if (!m.resolvedAt) continue;
    const t = dayStartJST(m.resolvedAt).getTime();
    const weekIndex = Math.floor((t - rangeStart.getTime()) / (7 * DAY_MS));
    if (weekIndex >= 0 && weekIndex < WEEKS) {
      weeklyCounts[weekIndex] += 1;
    }
    if (t >= thisMonday.getTime() && t < thisWeekEnd.getTime()) {
      thisWeekDelta += 1;
    }
  }

  return { totalResolved, thisWeekDelta, weeklyCounts };
}
