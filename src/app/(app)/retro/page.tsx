import Link from "next/link";
import { AtlasChrome, AtlasPageTitle } from "@/components/living-atlas";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { dateKeyJST } from "@/lib/date";
import {
  dayRangeFromDateKey,
  listTextbookDates,
} from "@/lib/daily-textbook";
import { prisma } from "@/lib/db";
import { regenerateDailyTextbookAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RetroIndexPage() {
  const today = dateKeyJST();
  const [streakDays, dates, materialCountToday] = await Promise.all([
    loadStreakDays(),
    listTextbookDates(21),
    (() => {
      const { start, end } = dayRangeFromDateKey(today);
      return prisma.devEvent.count({
        where: { receivedAt: { gte: start, lt: end } },
      });
    })(),
  ]);

  return (
    <AtlasChrome active="/retro" streakDays={streakDays}>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
        <AtlasPageTitle title="きょうのしょ" sub="日次教科書一覧" />
        <section className="dq-win mb-4 p-4">
          <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
            実装の足跡を材料として貯め、1日の教科書に圧縮する（ADR-0020）。
            即時しれんが backlog で止まっても、材料はここへ来る。
          </p>
          <p className="mt-2 mb-0 text-[13px] text-[#9ec0ff]">
            今日（{today}）の材料: {materialCountToday} 件
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/retro/${today}`}
              className="dq-btn !px-3 !py-2 text-[8px]"
            >
              きょうを開く
            </Link>
            <form
              action={async () => {
                "use server";
                await regenerateDailyTextbookAction(today);
              }}
            >
              <button type="submit" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
                きょうを生成
              </button>
            </form>
          </div>
        </section>

        <section className="dq-win p-4">
          <h2 className="dq-win-title mb-3">これまでのしょ</h2>
          {dates.length === 0 ? (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              まだ生成されていない。材料がある日に「きょうを生成」せよ。
            </p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {dates.map((d) => (
                <li key={d.dateKey}>
                  <Link
                    href={`/retro/${d.dateKey}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#002070] pb-2 text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
                  >
                    <span>{d.dateKey}</span>
                    <span className="text-[12px] text-[#9a9470]">
                      材料 {d.materialCount} · 章 {d.chapterCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AtlasChrome>
  );
}
