import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CircleCheck,
  Inbox,
  Sparkles,
  Zap,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { shortDateJST, weekKeyJST } from "@/lib/date";
import {
  evidenceTimeline,
  targetTypeLabel,
  weeklyEvidenceCounts,
} from "@/lib/goal";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function GoalDetailPage({ params }: Props) {
  const { id } = await params;
  const goal = await prisma.goal.findUnique({
    where: { id },
    include: {
      reviews: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!goal) notFound();

  const [counts, timeline] = await Promise.all([
    weeklyEvidenceCounts(goal.id),
    evidenceTimeline(goal.id, 20),
  ]);
  const total =
    counts.entries + counts.applications + counts.resolvedMisconceptions;
  const thisWeekKey = weekKeyJST();
  const latestReview = goal.reviews[0] ?? null;
  const olderReviews = goal.reviews.slice(1);

  return (
    <PageShell>
      <Link
        href="/goals"
        className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        目標一覧
      </Link>

      <section className="space-y-5 rounded-xl bg-surface p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold text-ink">
              {goal.title}
            </h1>
            {goal.kdi && (
              <p className="text-[12.5px] text-ink-secondary">KDI: {goal.kdi}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold text-accent">
            {goal.period} · {goal.status}
          </span>
        </div>

        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[10px] bg-bg px-7 py-6 text-center">
            <Inbox className="h-7 w-7 text-ink-faint" strokeWidth={1.8} />
            <p className="text-sm font-bold text-ink-secondary">
              今週はこの目標の証跡がありません
            </p>
            <p className="max-w-lg text-xs leading-5 text-ink-faint">
              動いていないことが最も重要なシグナルです。月曜の週次 Goal OS
              でこの目標の扱い (継続/縮小/統合) を決めましょう。
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-8">
            <div className="flex items-center gap-2">
              <BookOpen className="h-[18px] w-[18px] text-ink" />
              <span className="font-display text-[26px] font-bold text-ink">
                {counts.entries}
              </span>
              <span className="text-xs text-ink-secondary">今週の学び</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-[18px] w-[18px] text-accent" />
              <span className="font-display text-[26px] font-bold text-accent">
                {counts.applications}
              </span>
              <span className="text-xs text-ink-secondary">実務で使用</span>
            </div>
            <div className="flex items-center gap-2">
              <CircleCheck className="h-[18px] w-[18px] text-warn" />
              <span className="font-display text-[26px] font-bold text-warn">
                {counts.resolvedMisconceptions}
              </span>
              <span className="text-xs text-ink-secondary">つまずき解消</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-xs font-bold text-ink-faint">直近の証跡</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-ink-secondary">まだ紐付き証跡がありません。</p>
          ) : (
            <ul>
              {timeline.map((item) => (
                <li
                  key={`${item.targetType}-${item.targetId}`}
                  className="flex items-center gap-2.5 border-b border-border py-2 last:border-0"
                >
                  <TypeIcon type={item.targetType} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    [{targetTypeLabel(item.targetType)}] {item.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {shortDateJST(item.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {latestReview && (
          <div className="flex gap-2.5 rounded-[10px] bg-accent-soft px-[18px] py-3.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="space-y-1 text-[12.5px] leading-[21px] text-ink">
              <p className="font-bold">
                週次評価 ({latestReview.weekKey}
                {latestReview.weekKey === thisWeekKey ? " · 今週" : ""})
              </p>
              <p>{latestReview.comment}</p>
            </div>
          </div>
        )}
      </section>

      {olderReviews.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-ink">
            週次評価の履歴
          </h2>
          <ul className="space-y-2">
            {olderReviews.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-surface px-5 py-4"
              >
                <p className="mb-1 text-xs font-bold text-ink-faint">{r.weekKey}</p>
                <p className="text-sm leading-6 text-ink">{r.comment}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case "entry":
      return <BookOpen className="h-[15px] w-[15px] shrink-0 text-ink" />;
    case "application":
      return <Zap className="h-[15px] w-[15px] shrink-0 text-accent" />;
    case "misconception":
      return <CircleCheck className="h-[15px] w-[15px] shrink-0 text-warn" />;
    default:
      return <BookOpen className="h-[15px] w-[15px] shrink-0 text-ink-faint" />;
  }
}
