import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { parseGateSourceContext } from "./gate-source-context";

export const TEXTBOOK_CHECK_GATE_STATE_STATUSES = [
  "pending",
  "answered",
  "grading",
  "grading_failed",
  "passed",
  "failed",
  "self_graded_pass",
  "self_graded_fail",
  "dismissed",
  "parked",
] as const;

export type TextbookCheckGateStateStatus = (typeof TEXTBOOK_CHECK_GATE_STATE_STATUSES)[number];

type HistoryClient = PrismaClient | Prisma.TransactionClient;

type StateEventInput = Readonly<{
  gateId: string;
  status: TextbookCheckGateStateStatus;
  recordedAt?: Date;
}>;

type FailureCaptureInput = Readonly<{
  failedStateEventId: string;
  captureId: string;
  recordedAt?: Date;
}>;

type FollowupInput = Readonly<{
  failureCaptureId: string;
  misconceptionId: string;
  scheduledFor: Date;
  observedAt?: Date;
}>;

export type TextbookCheckGateTransitionResult = Readonly<{
  updated: boolean;
  stateEventId: string | null;
}>;

function validNonEmptyId(value: string): boolean {
  return value.trim().length > 0;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function isStateStatus(value: string): value is TextbookCheckGateStateStatus {
  return (TEXTBOOK_CHECK_GATE_STATE_STATUSES as readonly string[]).includes(value);
}

function allowsTransition(
  previous: TextbookCheckGateStateStatus,
  next: TextbookCheckGateStateStatus,
): boolean {
  if (previous === "pending") return next === "answered" || next === "dismissed" || next === "parked";
  if (previous === "answered") return next === "grading";
  if (previous === "grading") return next === "passed" || next === "failed" || next === "grading_failed";
  if (previous === "grading_failed") return next === "answered" || next === "self_graded_pass" || next === "self_graded_fail" || next === "dismissed";
  if (previous === "failed") return next === "answered" || next === "dismissed";
  if (previous === "self_graded_fail") return next === "answered";
  if (previous === "parked") return next === "pending";
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function textbookOriginForGate(client: HistoryClient, gateId: string) {
  const gate = await client.gate.findUnique({
    where: { id: gateId },
    select: {
      kind: true,
      status: true,
      textbookCheckOrigin: { select: { createdAt: true } },
    },
  });
  if (gate === null || gate.kind !== "textbook_check" || gate.textbookCheckOrigin === null) return null;
  return { status: gate.status, originCreatedAt: gate.textbookCheckOrigin.createdAt };
}

/**
 * Appends one verified persistent status transition for a textbook_check Gate.
 * Call this inside the same transaction that updates Gate.status. Ordinary
 * Gates and pre-A7-B history deliberately produce no row.
 */
export async function appendTextbookCheckGateStateEvent(
  client: HistoryClient,
  input: StateEventInput,
) {
  const gateId = input.gateId.trim();
  const recordedAt = input.recordedAt ?? new Date();
  if (!validNonEmptyId(gateId) || !isStateStatus(input.status) || !validDate(recordedAt)) {
    throw new Error("invalid_textbook_check_gate_state_event");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const gate = await textbookOriginForGate(client, gateId);
    if (gate === null) return null;
    if (gate.status !== input.status) throw new Error("textbook_check_gate_status_mismatch");
    if (recordedAt.getTime() < gate.originCreatedAt.getTime()) {
      throw new Error("textbook_check_gate_state_before_origin");
    }

    const previous = await client.textbookCheckGateStateEvent.findFirst({
      where: { gateId },
      orderBy: { ordinal: "desc" },
    });
    const previousStatus = previous?.status;
    if (previousStatus !== undefined && !isStateStatus(previousStatus)) {
      throw new Error("invalid_existing_textbook_check_gate_state");
    }
    if (previousStatus === input.status) return previous;
    if (!allowsTransition(previousStatus ?? "pending", input.status)) {
      throw new Error("invalid_textbook_check_gate_transition");
    }

    try {
      return await client.textbookCheckGateStateEvent.create({
        data: { gateId, ordinal: (previous?.ordinal ?? 0) + 1, status: input.status, recordedAt },
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error("textbook_check_gate_state_retry_exhausted");
}

/**
 * The sole status-mutation adapter for existing writers. It preserves each
 * writer's compare-and-set boundary while adding the event in the very same
 * transaction. Non-textbook Gates retain their existing update behavior and
 * intentionally receive no A7-B history row.
 */
export async function transitionGateStatusWithTextbookHistory(
  client: PrismaClient,
  input: Readonly<{
    gateId: string;
    from: string | readonly string[];
    status: TextbookCheckGateStateStatus;
    data?: Omit<Prisma.GateUpdateManyMutationInput, "status">;
    recordedAt?: Date;
  }>,
): Promise<TextbookCheckGateTransitionResult> {
  const gateId = input.gateId.trim();
  const from = Array.isArray(input.from) ? input.from : [input.from];
  const recordedAt = input.recordedAt ?? new Date();
  if (!validNonEmptyId(gateId) || from.length === 0 || !isStateStatus(input.status) || !validDate(recordedAt)) {
    throw new Error("invalid_textbook_check_gate_transition");
  }
  const result = await client.$transaction(async (tx) => {
    const updated = await tx.gate.updateMany({
      where: { id: gateId, status: from.length === 1 ? from[0] : { in: from } },
      data: { ...(input.data ?? {}), status: input.status },
    });
    if (updated.count === 0) return { updated: false, stateEventId: null } as const;
    const stateEvent = await appendTextbookCheckGateStateEvent(tx, {
      gateId,
      status: input.status,
      recordedAt,
    });
    return { updated: true, stateEventId: stateEvent?.id ?? null } as const;
  });
  return Object.freeze(result);
}

/**
 * Records only a newly-created Capture that can be directly proven to belong
 * to a failed textbook_check state event. The raw sourceContext stays local to
 * this transaction and is never copied to the history table.
 */
export async function linkTextbookCheckGateFailureCapture(
  client: HistoryClient,
  input: FailureCaptureInput,
) {
  const failedStateEventId = input.failedStateEventId.trim();
  const captureId = input.captureId.trim();
  const recordedAt = input.recordedAt ?? new Date();
  if (!validNonEmptyId(failedStateEventId) || !validNonEmptyId(captureId) || !validDate(recordedAt)) {
    throw new Error("invalid_textbook_check_gate_failure_capture");
  }

  const existing = await client.textbookCheckGateFailureCapture.findUnique({
    where: { captureId },
  });
  if (existing !== null) {
    if (existing.failedStateEventId !== failedStateEventId) {
      throw new Error("capture_already_mapped_to_different_failed_state");
    }
    return existing;
  }

  const [failedState, capture] = await Promise.all([
    client.textbookCheckGateStateEvent.findUnique({
      where: { id: failedStateEventId },
      select: { gateId: true, status: true, recordedAt: true },
    }),
    client.capture.findUnique({
      where: { id: captureId },
      select: { sourceTool: true, sourceContext: true, capturedAt: true },
    }),
  ]);
  if (failedState?.status !== "failed" || capture === null) return null;
  const parsed = parseGateSourceContext(capture.sourceContext);
  if (
    capture.sourceTool !== "gate"
    || parsed.gateId !== failedState.gateId
    || capture.capturedAt.getTime() < failedState.recordedAt.getTime()
    || recordedAt.getTime() < capture.capturedAt.getTime()
  ) {
    return null;
  }
  try {
    return await client.textbookCheckGateFailureCapture.create({
      data: { failedStateEventId, captureId, recordedAt },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await client.textbookCheckGateFailureCapture.findUnique({ where: { captureId } });
    if (raced?.failedStateEventId === failedStateEventId) return raced;
    throw new Error("capture_already_mapped_to_different_failed_state");
  }
}

/**
 * Records the exact scheduled follow-up at acceptance time. It must run in the
 * same transaction that makes the Capture accepted and sets the misconception
 * schedule, so a later nextReviewAt change cannot rewrite history.
 */
export async function observeTextbookCheckGateFollowup(
  client: HistoryClient,
  input: FollowupInput,
) {
  const failureCaptureId = input.failureCaptureId.trim();
  const misconceptionId = input.misconceptionId.trim();
  const observedAt = input.observedAt ?? new Date();
  if (
    !validNonEmptyId(failureCaptureId)
    || !validNonEmptyId(misconceptionId)
    || !validDate(input.scheduledFor)
    || !validDate(observedAt)
  ) {
    throw new Error("invalid_textbook_check_gate_followup_observation");
  }

  const existing = await client.textbookCheckGateFollowupObservation.findUnique({
    where: { failureCaptureId },
  });
  if (existing !== null) {
    if (
      existing.misconceptionId !== misconceptionId
      || existing.scheduledFor.getTime() !== input.scheduledFor.getTime()
    ) {
      throw new Error("failure_capture_already_observed_with_different_followup");
    }
    return existing;
  }

  const failureCapture = await client.textbookCheckGateFailureCapture.findUnique({
    where: { id: failureCaptureId },
    select: {
      capture: {
        select: { status: true, reviewedAt: true, misconceptionId: true },
      },
    },
  });
  if (
    failureCapture?.capture.status !== "accepted"
    || failureCapture.capture.reviewedAt === null
    || failureCapture.capture.misconceptionId !== misconceptionId
    || observedAt.getTime() < failureCapture.capture.reviewedAt.getTime()
  ) {
    return null;
  }
  const misconception = await client.misconception.findUnique({
    where: { id: misconceptionId },
    select: { nextReviewAt: true },
  });
  if (
    misconception === null
    || misconception.nextReviewAt === null
    || misconception.nextReviewAt.getTime() !== input.scheduledFor.getTime()
  ) {
    return null;
  }
  try {
    return await client.textbookCheckGateFollowupObservation.create({
      data: { failureCaptureId, misconceptionId, scheduledFor: input.scheduledFor, observedAt },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await client.textbookCheckGateFollowupObservation.findUnique({ where: { failureCaptureId } });
    if (
      raced?.misconceptionId === misconceptionId
      && raced.scheduledFor.getTime() === input.scheduledFor.getTime()
    ) {
      return raced;
    }
    throw new Error("failure_capture_already_observed_with_different_followup");
  }
}
