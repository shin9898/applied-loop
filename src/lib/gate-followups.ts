import { prisma } from "@/lib/db";

/** しれん失敗後の「次の一手」深リンク用 */
export type GateFollowups = {
  entryId: string | null;
  /** Entry 未確定なら受信箱候補 */
  inboxId: string | null;
  misconceptionId: string | null;
};

/**
 * ゲートに紐づく関連にっき / ずかん（誤解）を解決する。
 * - にっき: Capture.sourceContext の gateId → entryId、なければ同 domain の最新 Entry
 * - ずかん: Gate.misconceptionId
 */
export async function resolveGateFollowups(
  gateId: string,
): Promise<GateFollowups> {
  if (!gateId) {
    return { entryId: null, inboxId: null, misconceptionId: null };
  }

  const gate = await prisma.gate.findUnique({
    where: { id: gateId },
    select: {
      misconceptionId: true,
      domain: true,
      targetConcept: true,
    },
  });

  const misconceptionId = gate?.misconceptionId ?? null;

  const captureWithEntry = await prisma.capture.findFirst({
    where: {
      sourceContext: { contains: gateId },
      entryId: { not: null },
    },
    orderBy: [{ reviewedAt: "desc" }, { capturedAt: "desc" }],
    select: { entryId: true },
  });
  let entryId = captureWithEntry?.entryId ?? null;

  let inboxId: string | null = null;
  if (!entryId) {
    const pending = await prisma.capture.findFirst({
      where: {
        sourceContext: { contains: gateId },
        status: "pending",
      },
      orderBy: { capturedAt: "desc" },
      select: { id: true },
    });
    inboxId = pending?.id ?? null;
  }

  if (!entryId && gate?.domain) {
    const byDomain = await prisma.entry.findFirst({
      where: { domain: gate.domain },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    entryId = byDomain?.id ?? null;
  }

  if (!entryId && gate?.targetConcept) {
    const concept = gate.targetConcept.trim();
    if (concept.length >= 2) {
      const byConcept = await prisma.entry.findFirst({
        where: {
          OR: [
            { title: { contains: concept } },
            { note: { contains: concept } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      entryId = byConcept?.id ?? null;
    }
  }

  return { entryId, inboxId, misconceptionId };
}
