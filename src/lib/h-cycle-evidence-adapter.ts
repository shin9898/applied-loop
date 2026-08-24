import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { parseGateSourceContext } from "./gate-source-context";
import {
  projectHCycleEvidenceV1,
  type HCycleEvidenceProjectionInputV1,
  type HCycleEvidenceProjectionV1,
  type HCyclePeriodV1,
} from "./h-cycle-projection";

type EvidenceReadClient = PrismaClient | Prisma.TransactionClient;

/**
 * Privacy-minimized evidence read once from the ledger. A caller supplies the
 * completed period separately, so adjacent windows can be projected from the
 * same database snapshot without querying mutable current rows twice.
 */
export type HCycleEvidenceSnapshotV1 = Readonly<Omit<HCycleEvidenceProjectionInputV1, "period">>;

/**
 * Reads only the privacy-minimized history needed by the pure H-CYCLE
 * projection. Current Gate.status / gradedAt and Misconception.nextReviewAt
 * are intentionally absent: those values are mutable after the completed
 * period and must never rewrite its result.
 */
export async function readHCycleEvidenceSnapshotV1(
  client: EvidenceReadClient,
): Promise<HCycleEvidenceSnapshotV1> {
  const [sourceRevisions, origins, gateStateEvents, failureCaptureRows, followupObservations] = await Promise.all([
    client.textbookCheckEvidence.findMany({
      select: {
        sourceKind: true,
        textbookKey: true,
        source: true,
        checkIndex: true,
        sourceRevisionHash: true,
        firstObservedAt: true,
        masteryEvents: { select: { mastery: true, recordedAt: true } },
      },
    }),
    client.textbookCheckGateOrigin.findMany({
      select: {
        gateId: true,
        sourceKind: true,
        textbookKey: true,
        source: true,
        checkIndex: true,
        sourceRevisionHash: true,
        createdAt: true,
      },
    }),
    client.textbookCheckGateStateEvent.findMany({
      select: { id: true, gateId: true, ordinal: true, status: true, recordedAt: true },
    }),
    client.textbookCheckGateFailureCapture.findMany({
      select: {
        id: true,
        failedStateEventId: true,
        captureId: true,
        capture: {
          select: {
            capturedAt: true,
            sourceTool: true,
            sourceContext: true,
            status: true,
            reviewedAt: true,
            misconceptionId: true,
          },
        },
      },
    }),
    client.textbookCheckGateFollowupObservation.findMany({
      select: {
        id: true,
        failureCaptureId: true,
        misconceptionId: true,
        scheduledFor: true,
        observedAt: true,
      },
    }),
  ]);

  return {
    sourceRevisions: sourceRevisions.map((revision) => ({
      sourceKind: revision.sourceKind as "daily" | "weekly",
      textbookKey: revision.textbookKey,
      source: revision.source as "auto" | "compiled",
      checkIndex: revision.checkIndex,
      sourceRevisionHash: revision.sourceRevisionHash,
      firstObservedAt: revision.firstObservedAt,
      masteryEvents: revision.masteryEvents.map((event) => ({
        mastery: event.mastery as "clear" | "partial" | "stuck" | "parked",
        recordedAt: event.recordedAt,
      })),
    })),
    promotions: origins.map((origin) => ({
      gateId: origin.gateId,
      sourceKind: origin.sourceKind as "daily" | "weekly",
      textbookKey: origin.textbookKey,
      source: origin.source as "auto" | "compiled",
      checkIndex: origin.checkIndex,
      sourceRevisionHash: origin.sourceRevisionHash,
      originCreatedAt: origin.createdAt,
    })),
    gateStateEvents: gateStateEvents.map((event) => ({
      id: event.id,
      gateId: event.gateId,
      ordinal: event.ordinal,
      status: event.status as HCycleEvidenceProjectionInputV1["gateStateEvents"][number]["status"],
      recordedAt: event.recordedAt,
    })),
    failureCaptures: failureCaptureRows.map((row) => ({
      id: row.id,
      failedStateEventId: row.failedStateEventId,
      captureId: row.captureId,
      capturedAt: row.capture.capturedAt,
      sourceTool: row.capture.sourceTool,
      parsedGateId: parseGateSourceContext(row.capture.sourceContext).gateId,
      status: row.capture.status as HCycleEvidenceProjectionInputV1["failureCaptures"][number]["status"],
      reviewedAt: row.capture.reviewedAt,
      misconceptionId: row.capture.misconceptionId,
    })),
    followupObservations: followupObservations.map((observation) => ({
      id: observation.id,
      failureCaptureId: observation.failureCaptureId,
      misconceptionId: observation.misconceptionId,
      scheduledFor: observation.scheduledFor,
      observedAt: observation.observedAt,
    })),
  };
}

export function attachHCycleEvidencePeriodV1(
  snapshot: HCycleEvidenceSnapshotV1,
  period: HCyclePeriodV1,
): HCycleEvidenceProjectionInputV1 {
  return { period, ...snapshot };
}

export async function readHCycleEvidenceProjectionInputV1(
  client: EvidenceReadClient,
  period: HCyclePeriodV1,
): Promise<HCycleEvidenceProjectionInputV1> {
  return attachHCycleEvidencePeriodV1(await readHCycleEvidenceSnapshotV1(client), period);
}

/** Reads an explicit completed period and delegates all evaluation to the pure function. */
export async function projectHCycleEvidenceFromDatabaseV1(
  client: EvidenceReadClient,
  period: HCyclePeriodV1,
): Promise<HCycleEvidenceProjectionV1> {
  return projectHCycleEvidenceV1(await readHCycleEvidenceProjectionInputV1(client, period));
}
