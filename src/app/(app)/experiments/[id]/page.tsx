import Link from "next/link";
import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { prisma } from "@/lib/db";
import { createCheckIn, completeExperiment } from "@/lib/actions";
import { dateKeyJST, dayStartJST } from "@/lib/date";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

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

  const today = dayStartJST();
  const checkedToday = experiment.checkIns.some(
    (c) => c.date.getTime() === today.getTime()
  );
  const remaining = Math.max(
    0,
    Math.ceil((experiment.endDate.getTime() - today.getTime()) / 86400000)
  );

  const field =
    "w-full rounded-[10px] border border-border bg-surface-raised px-3.5 py-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

  return (
    <PageShell narrow>
      <Reveal className="space-y-2">
        <Link
          href={`/entries/${experiment.entryId}`}
          className="text-xs text-ink-faint transition-colors hover:text-ink-secondary"
        >
          ← {experiment.entry.title}
        </Link>
        <div className="flex items-center gap-2.5 pt-1">
          <FlaskConical className="h-5 w-5 text-accent" strokeWidth={2.2} />
          <h1 className="font-display text-2xl font-bold text-ink">
            {experiment.action}
          </h1>
        </div>
        <p className="text-sm text-ink-secondary">
          成功指標: {experiment.successMetric} / 残り {remaining} 日（
          {dateKeyJST(experiment.endDate)} まで）/ {experiment.status}
        </p>
      </Reveal>

      {experiment.status === "active" && (
        <Reveal
          delayIndex={1}
          as="section"
          className="space-y-3 rounded-xl bg-surface/90 p-7 shadow-[0_12px_40px_#2e241808] backdrop-blur-sm"
        >
          <h2 className="font-display text-[17px] font-bold text-ink">
            今日のチェックイン
          </h2>
          {checkedToday ? (
            <p className="text-sm font-bold text-accent">
              今日はチェックイン済みです。
            </p>
          ) : (
            <form action={createCheckIn} className="space-y-3">
              <input type="hidden" name="experimentId" value={experiment.id} />
              <input
                name="note"
                placeholder="一言メモ（任意）"
                className={field}
              />
              <button
                type="submit"
                className="rounded-[10px] bg-accent px-5 py-2.5 text-sm font-bold text-surface transition-opacity hover:opacity-90"
              >
                チェックイン
              </button>
            </form>
          )}
        </Reveal>
      )}

      {experiment.status === "active" && (
        <Reveal
          delayIndex={2}
          as="section"
          className="space-y-3 rounded-xl bg-surface/90 p-7 shadow-[0_12px_40px_#2e241808] backdrop-blur-sm"
        >
          <h2 className="font-display text-[17px] font-bold text-ink">
            実験を終える
          </h2>
          <form action={completeExperiment} className="space-y-3">
            <input type="hidden" name="experimentId" value={experiment.id} />
            <textarea
              name="outcome"
              rows={3}
              placeholder="結果: 成功指標に対してどうだったか・学び"
              className={field}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                name="status"
                value="completed"
                className="rounded-[10px] bg-accent px-5 py-2.5 text-sm font-bold text-surface transition-opacity hover:opacity-90"
              >
                完了
              </button>
              <button
                type="submit"
                name="status"
                value="abandoned"
                className="rounded-[10px] border border-border px-5 py-2.5 text-sm text-ink-secondary transition-colors hover:bg-bg"
              >
                中止
              </button>
            </div>
          </form>
        </Reveal>
      )}

      {experiment.outcome && (
        <Reveal
          delayIndex={1}
          as="section"
          className="rounded-xl bg-accent-soft p-6 text-sm text-accent"
        >
          <h2 className="mb-1 font-display font-bold">結果</h2>
          <p className="whitespace-pre-wrap text-ink">{experiment.outcome}</p>
        </Reveal>
      )}

      <Reveal delayIndex={3} as="section" className="space-y-3">
        <h2 className="font-display text-[17px] font-bold text-ink">
          チェックイン履歴（{experiment.checkIns.length} 日）
        </h2>
        {experiment.checkIns.length === 0 ? (
          <p className="text-sm text-ink-faint">まだチェックインがありません。</p>
        ) : (
          <ul className="overflow-hidden rounded-xl bg-surface/90">
            {experiment.checkIns.map((c, i) => (
              <li
                key={c.id}
                className={`flex gap-3 px-5 py-3 text-sm ${
                  i < experiment.checkIns.length - 1
                    ? "border-b border-border"
                    : ""
                }`}
              >
                <span className="shrink-0 text-ink-faint">
                  {dateKeyJST(c.date)}
                </span>
                <span className="text-ink">{c.note ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </PageShell>
  );
}
