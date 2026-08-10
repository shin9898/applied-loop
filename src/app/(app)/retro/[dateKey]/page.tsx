import { notFound } from "next/navigation";
import { AtlasDailyTextbook } from "@/components/living-atlas/atlas-daily-textbook";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import {
  dayRangeFromDateKey,
  loadDailyTextbook,
} from "@/lib/daily-textbook";
import { prisma } from "@/lib/db";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function RetroDatePage({
  params,
}: {
  params: Promise<{ dateKey: string }>;
}) {
  const { dateKey } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) notFound();

  const [textbook, streakDays, materialCount] = await Promise.all([
    loadDailyTextbook(dateKey),
    loadStreakDays(),
    (() => {
      const { start, end } = dayRangeFromDateKey(dateKey);
      return prisma.devEvent.count({
        where: { receivedAt: { gte: start, lt: end } },
      });
    })(),
  ]);

  return (
    <AtlasDailyTextbook
      dateKey={dateKey}
      textbook={textbook}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
      materialCountToday={materialCount}
    />
  );
}
