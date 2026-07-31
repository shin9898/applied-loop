import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createCheckIn, completeExperiment } from "@/lib/actions";

export const dynamic = "force-dynamic";

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { entry: true, checkIns: { orderBy: { date: "desc" } } },
  });
  if (!experiment) notFound();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkedToday = experiment.checkIns.some((c) => c.date.getTime() === today.getTime());
  const remaining = Math.max(
    0,
    Math.ceil((experiment.endDate.getTime() - today.getTime()) / 86400000)
  );

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/entries/${experiment.entryId}`} className="text-sm text-zinc-500 hover:underline">
          ← {experiment.entry.title}
        </Link>
        <h1 className="mt-2 text-xl font-bold">{experiment.action}</h1>
        <p className="text-sm text-zinc-500">
          成功指標: {experiment.successMetric} / 残り {remaining} 日（{fmt(experiment.endDate)} まで）/ {experiment.status}
        </p>
      </div>

      {experiment.status === "active" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-bold">今日のチェックイン</h2>
          {checkedToday ? (
            <p className="text-sm text-emerald-600">今日はチェックイン済みです。</p>
          ) : (
            <form action={createCheckIn} className="space-y-3">
              <input type="hidden" name="experimentId" value={experiment.id} />
              <input
                name="note"
                placeholder="一言メモ（任意）"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
              >
                チェックイン
              </button>
            </form>
          )}
        </section>
      )}

      {experiment.status === "active" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-bold">実験を終える</h2>
          <form action={completeExperiment} className="space-y-3">
            <input type="hidden" name="experimentId" value={experiment.id} />
            <textarea
              name="outcome"
              rows={3}
              placeholder="結果: 成功指標に対してどうだったか・学び"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                name="status"
                value="completed"
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
              >
                完了
              </button>
              <button
                type="submit"
                name="status"
                value="abandoned"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100"
              >
                中止
              </button>
            </div>
          </form>
        </section>
      )}

      {experiment.outcome && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <h2 className="mb-1 font-bold">結果</h2>
          <p className="whitespace-pre-wrap">{experiment.outcome}</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">チェックイン履歴（{experiment.checkIns.length} 日）</h2>
        {experiment.checkIns.length === 0 ? (
          <p className="text-sm text-zinc-500">まだチェックインがありません。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {experiment.checkIns.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="text-zinc-500">{fmt(c.date)}</span>
                <span>{c.note ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
