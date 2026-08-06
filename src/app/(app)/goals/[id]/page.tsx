import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { shortDateJST } from "@/lib/date";
import {
  evidenceTimeline,
  targetTypeLabel,
  weeklyEvidenceCounts,
} from "@/lib/goal";
import { AtlasGoalDetail } from "@/components/living-atlas/atlas-goal-detail";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

const GOAL_EVIDENCE_TARGET = 3;

type Props = {
  params: Promise<{ id: string }>;
};

function hrefFor(type: string, id: string): string | null {
  if (type === "entry") return `/entries/${id}`;
  if (type === "gate") return `/gates/${id}`;
  if (type === "misconception") return "/zukan";
  return null;
}

export default async function GoalDetailPage({ params }: Props) {
  const { id } = await params;
  const goal = await prisma.goal.findUnique({ where: { id } });
  if (!goal) notFound();

  const [counts, timeline, streakDays] = await Promise.all([
    weeklyEvidenceCounts(goal.id),
    evidenceTimeline(goal.id, 20),
    loadStreakDays(),
  ]);
  const wsToken = getTerminalWsToken();
  const evidenceCount =
    counts.entries + counts.applications + counts.resolvedMisconceptions;

  let focusDomains: string[] = [];
  if (goal.focusDomains) {
    try {
      const v = JSON.parse(goal.focusDomains) as unknown;
      if (Array.isArray(v)) {
        focusDomains = v.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <AtlasGoalDetail
      streakDays={streakDays}
      wsToken={wsToken}
      evidenceCount={evidenceCount}
      evidenceTarget={GOAL_EVIDENCE_TARGET}
      goal={{
        id: goal.id,
        title: goal.title,
        period: goal.period,
        kdi: goal.kdi,
        status: goal.status,
        focusDomains,
      }}
      timeline={timeline.map((t) => ({
        id: `${t.targetType}:${t.targetId}`,
        kind: targetTypeLabel(t.targetType),
        title: t.title,
        href: hrefFor(t.targetType, t.targetId),
        at: shortDateJST(t.date),
      }))}
    />
  );
}
