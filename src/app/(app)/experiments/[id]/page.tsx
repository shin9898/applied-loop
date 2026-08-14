import { notFound } from "next/navigation";
import { AtlasExperimentDetail } from "@/components/living-atlas/atlas-experiment-detail";
import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST } from "@/lib/date";

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
    (c) => c.date.getTime() === today.getTime(),
  );
  const remaining = Math.max(
    0,
    Math.ceil((experiment.endDate.getTime() - today.getTime()) / 86400000),
  );

  return (
    <AtlasExperimentDetail
      experiment={{
        id: experiment.id,
        action: experiment.action,
        successMetric: experiment.successMetric,
        status: experiment.status,
        endDateKey: dateKeyJST(experiment.endDate),
        remainingDays: remaining,
        outcome: experiment.outcome,
        entryId: experiment.entryId,
        entryTitle: experiment.entry.title,
        checkedToday,
        checkIns: experiment.checkIns.map((c) => ({
          id: c.id,
          dateKey: dateKeyJST(c.date),
          note: c.note,
        })),
      }}
    />
  );
}
