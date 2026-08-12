import { AtlasChrome } from "@/components/living-atlas";
import { AtlasNikkiRetro } from "@/components/living-atlas/atlas-nikki-retro";
import { groupNikkiMonths } from "@/components/living-atlas/nikki-months";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { dateKeyJST } from "@/lib/date";
import {
  dayRangeFromDateKey,
  listTextbookDates,
  listUngeneratedDays,
} from "@/lib/daily-textbook";
import { prisma } from "@/lib/db";
import { regenerateDailyTextbookAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RetroIndexPage() {
  const today = dateKeyJST();
  const [streakDays, dates, ungeneratedDays, materialCountToday] =
    await Promise.all([
      loadStreakDays(),
      listTextbookDates(120),
      listUngeneratedDays(60),
      (() => {
        const { start, end } = dayRangeFromDateKey(today);
        return prisma.devEvent.count({
          where: { receivedAt: { gte: start, lt: end } },
        });
      })(),
    ]);

  const months = groupNikkiMonths(dates);

  async function regenerateAction() {
    "use server";
    await regenerateDailyTextbookAction(today);
  }

  return (
    <AtlasChrome active="/retro" streakDays={streakDays}>
      <AtlasNikkiRetro
        months={months}
        todayKey={today}
        materialCountToday={materialCountToday}
        ungeneratedDays={ungeneratedDays}
        regenerateAction={regenerateAction}
      />
    </AtlasChrome>
  );
}
