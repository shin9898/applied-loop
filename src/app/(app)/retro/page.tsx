import { AtlasNikkiRetro } from "@/components/living-atlas/atlas-nikki-retro";
import { groupNikkiMonths } from "@/components/living-atlas/nikki-months";
import { dateKeyJST } from "@/lib/date";
import {
  dayRangeFromDateKey,
  listTextbookDates,
  listUngeneratedDays,
} from "@/lib/daily-textbook";
import {
  ensureRecentWeeklyTextbooks,
  loadLatestWeeklyTextbookSummary,
} from "@/lib/weekly-textbook";
import { prisma } from "@/lib/db";
import { regenerateDailyTextbookAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RetroIndexPage() {
  const today = dateKeyJST();

  // 直近8週の週のしょ欠落をサイレントに補完する（取りこぼしゼロ）。
  // 既に生成済みの週は generateWeeklyTextbook 側で即 skip されるため軽い。
  await ensureRecentWeeklyTextbooks(8);

  const [dates, ungeneratedDays, materialCountToday, latestWeekly] =
    await Promise.all([
      listTextbookDates(120),
      listUngeneratedDays(60),
      (() => {
        const { start, end } = dayRangeFromDateKey(today);
        return prisma.devEvent.count({
          where: { receivedAt: { gte: start, lt: end } },
        });
      })(),
      loadLatestWeeklyTextbookSummary(),
    ]);

  const months = groupNikkiMonths(dates);

  async function regenerateAction() {
    "use server";
    await regenerateDailyTextbookAction(today);
  }

  return (
    <AtlasNikkiRetro
      months={months}
      todayKey={today}
      materialCountToday={materialCountToday}
      ungeneratedDays={ungeneratedDays}
      regenerateAction={regenerateAction}
      latestWeekly={latestWeekly}
    />
  );
}
