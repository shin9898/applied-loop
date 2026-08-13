/**
 * 外部セッション・事後ダイジェスト DB 問い合わせ層 (server-only)。純関数は session-digest-shared.ts。
 */

import "server-only";

import { prisma } from "@/lib/db";
import { dayRangeFromDateKey } from "@/lib/daily-textbook-shared";
import { classifySystem } from "@/lib/atlas-taxonomy";
import {
  buildSessionDigest,
  isExternalSession,
  normalizeRepoKey,
  type SessionDigest,
  type SystemKind,
} from "@/lib/session-digest-shared";

export * from "@/lib/session-digest-shared";

async function resolveRegionsByRepo(
  repos: string[],
): Promise<Record<string, SystemKind | null>> {
  const result: Record<string, SystemKind | null> = {};
  await Promise.all(
    repos.map(async (repo) => {
      const gates = await prisma.gate.findMany({
        where: { event: { repo } },
        select: { question: true, domain: true, targetConcept: true },
        take: 50,
        orderBy: { createdAt: "desc" },
      });
      if (gates.length === 0) {
        result[normalizeRepoKey(repo)] = null;
        return;
      }
      const counts = new Map<SystemKind, number>();
      for (const g of gates) {
        const kind = classifySystem({
          text: g.question,
          domain: g.domain,
          targetConcept: g.targetConcept,
        });
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      let best: SystemKind = "other";
      let bestCount = -1;
      for (const [kind, count] of counts) {
        if (count > bestCount) {
          best = kind;
          bestCount = count;
        }
      }
      result[normalizeRepoKey(repo)] = best;
    }),
  );
  return result;
}

export async function buildSessionDigestForDate(
  dateKey: string,
): Promise<SessionDigest> {
  const { start, end } = dayRangeFromDateKey(dateKey);

  const runsRaw = await prisma.harnessRun.findMany({
    where: { startedAt: { gte: start, lt: end } },
    select: {
      sessionId: true,
      repo: true,
      startedAt: true,
      endedAt: true,
      tools: true,
    },
  });
  const harnessRuns = runsRaw.filter(isExternalSession);

  const [captures, gatesRaw, devEvents, goalLinks, requirementLinks] =
    await Promise.all([
      prisma.capture.findMany({
        where: { capturedAt: { gte: start, lt: end } },
        select: { title: true, capturedAt: true },
      }),
      prisma.gate.findMany({
        where: { answeredAt: { gte: start, lt: end } },
        select: { answeredAt: true, event: { select: { repo: true } } },
      }),
      prisma.devEvent.findMany({
        where: { receivedAt: { gte: start, lt: end } },
        select: { repo: true, receivedAt: true },
      }),
      prisma.goalLink.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { createdAt: true },
      }),
      prisma.requirementLink.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { createdAt: true },
      }),
    ]);

  const gatesAnswered = gatesRaw.map((g) => ({
    repo: g.event?.repo ?? null,
    answeredAt: g.answeredAt!,
  }));

  const repos = [
    ...new Set(
      harnessRuns
        .map((r) => r.repo)
        .filter((r): r is string => Boolean(r)),
    ),
  ];
  const regionByRepo = await resolveRegionsByRepo(repos);

  return buildSessionDigest({
    dateKey,
    harnessRuns,
    captures,
    gatesAnswered,
    devEvents,
    goalLinks,
    requirementLinks,
    regionByRepo,
  });
}
