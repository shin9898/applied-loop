import Link from "next/link";
import { prisma } from "@/lib/db";
import { createCheckIn } from "@/lib/actions";

export const dynamic = "force-dynamic";

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function Home() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [unappliedEntries, dueCards, activeExperiments, recentApplications] =
    await Promise.all([
      prisma.entry.findMany({
        where: { applications: { none: {} } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.srCard.findMany({
        where: { nextReview: { lte: new Date() } },
        orderBy: { nextReview: "asc" },
      }),
      prisma.experiment.findMany({
        where: { status: "active" },
        include: { entry: true, checkIns: { where: { date: today } } },
      }),
      prisma.application.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { entry: true },
      }),
    ]);

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-lg font-bold">今日のチェックイン</h2>
        {activeExperiments.length === 0 ? (
          <p className="text-sm text-zinc-500">
            アクティブな実験はありません。学びの詳細から「実験化」できます。
          </p>
        ) : (
          <ul className="space-y-2">
            {activeExperiments.map((exp) => {
              const checked = exp.checkIns.length > 0;
              return (
                <li
                  key={exp.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3"
                >
                  <div>
                    <Link
                      href={`/experiments/${exp.id}`}
                      className="font-medium hover:underline"
                    >
                      {exp.action}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      {exp.entry.title} / 期限 {fmt(exp.endDate)}
                    </p>
                  </div>
                  {checked ? (
                    <span className="text-sm text-emerald-600">済</span>
                  ) : (
                    <form action={createCheckIn}>
                      <input type="hidden" name="experimentId" value={exp.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
                      >
                        チェックイン
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          未適用の学び
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {unappliedEntries.length} 件 — 実務で試したら適用記録を
          </span>
        </h2>
        {unappliedEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">すべて適用済みです。</p>
        ) : (
          <ul className="space-y-2">
            {unappliedEntries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <Link href={`/entries/${entry.id}`} className="font-medium hover:underline">
                  {entry.title}
                </Link>
                <p className="text-xs text-zinc-500">
                  {entry.kind}
                  {entry.source ? ` / ${entry.source}` : ""} / {fmt(entry.createdAt)} 登録
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          期限切れカード
          <span className="ml-2 text-sm font-normal text-zinc-500">{dueCards.length} 枚</span>
        </h2>
        {dueCards.length === 0 ? (
          <p className="text-sm text-zinc-500">復習期限のカードはありません。</p>
        ) : (
          <p className="text-sm">
            <Link href="/cards" className="text-blue-600 hover:underline">
              {dueCards.length} 枚を復習する →
            </Link>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">最近の適用記録</h2>
        {recentApplications.length === 0 ? (
          <p className="text-sm text-zinc-500">まだ適用記録がありません。</p>
        ) : (
          <ul className="space-y-2">
            {recentApplications.map((app) => (
              <li
                key={app.id}
                className="rounded-lg border border-zinc-200 bg-white p-3 text-sm"
              >
                <span className="font-medium">{app.entry.title}</span>
                <span className="mx-1 text-zinc-400">→</span>
                {app.appliedTo}
                <p className="mt-1 text-xs text-zinc-500">{fmt(app.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
