import type { HCycleEvidenceSnapshotV1 } from "../../h-cycle-evidence-adapter";
import {
  buildHCycleEvidencePreviewV1,
  type HCycleEvidencePreviewV1,
} from "../../h-cycle-evidence-preview";
import type {
  PersistHCycleEvaluationRecordResult,
} from "../../h-cycle-evaluation-record";
import type { LoopJobHandler } from "../delivery";
import { createHCycleEvaluatePayloadV1 } from "./h-cycle-evaluate-job-contract-v1";
import { deriveHCycleEvaluateTimingV1 } from "./h-cycle-evaluate-planner-v1";

type TriggerKind = "scheduled" | "catch_up";
type Timeliness = "on_time" | "catch_up";

type RecordInput = Readonly<{
  preview: HCycleEvidencePreviewV1;
  scheduledFor: Date;
  evaluatedAt: Date;
  triggerKind: TriggerKind;
  timeliness: Timeliness;
}>;

export type HCycleEvaluateDormantHandlerDependenciesV1 = Readonly<{
  now(): Date;
  readSnapshot(): Promise<HCycleEvidenceSnapshotV1>;
  persistRecord(input: RecordInput): Promise<PersistHCycleEvaluationRecordResult>;
}>;

type HandlerFailureCode =
  | "invalid_job_identity"
  | "invalid_evaluation_time"
  | "week_not_due"
  | "snapshot_read_failure"
  | "preview_failure"
  | "invalid_evaluation_record"
  | "evaluation_record_integrity_failure"
  | "storage_failure";

type HandlerResult =
  | Readonly<{ ok: true; created: boolean }>
  | Readonly<{ ok: false; code: HandlerFailureCode }>;

const PAYLOAD_KEYS = [
  "hypothesis",
  "cadence",
  "targetWeekKey",
  "policyVersion",
  "projectionSchemaVersion",
] as const;

function dataObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function closedTargetWeekKey(payload: unknown): string | null {
  const record = dataObject(payload);
  if (!record || !hasExactKeys(record, PAYLOAD_KEYS)) return null;
  const created = createHCycleEvaluatePayloadV1({ targetWeekKey: record.targetWeekKey });
  if (!created.ok) return null;
  for (const key of PAYLOAD_KEYS) {
    if (record[key] !== created.payload[key]) return null;
  }
  return created.payload.targetWeekKey;
}

function failure(code: HandlerFailureCode): HandlerResult {
  return Object.freeze({ ok: false as const, code });
}

async function executeHCycleEvaluateDormantV1(
  payload: Record<string, string>,
  dependencies: HCycleEvaluateDormantHandlerDependenciesV1,
): Promise<HandlerResult> {
  const targetWeekKey = closedTargetWeekKey(payload);
  if (targetWeekKey === null) return failure("invalid_job_identity");

  let evaluatedAt: Date;
  try {
    evaluatedAt = dependencies.now();
  } catch {
    return failure("invalid_evaluation_time");
  }
  const timing = deriveHCycleEvaluateTimingV1({ targetWeekKey, evaluatedAt });
  if (!timing.ok) return failure(timing.code === "week_not_due" ? "week_not_due" : "invalid_evaluation_time");

  let snapshot: HCycleEvidenceSnapshotV1;
  try {
    snapshot = await dependencies.readSnapshot();
  } catch {
    return failure("snapshot_read_failure");
  }

  let preview: HCycleEvidencePreviewV1;
  try {
    preview = buildHCycleEvidencePreviewV1(snapshot, timing.timing.periods);
  } catch {
    return failure("preview_failure");
  }

  try {
    const persisted = await dependencies.persistRecord({
      preview,
      scheduledFor: timing.timing.scheduledFor,
      evaluatedAt: timing.timing.evaluatedAt,
      triggerKind: timing.timing.triggerKind,
      timeliness: timing.timing.timeliness,
    });
    if (!persisted.ok) return failure(persisted.code);
    return Object.freeze({ ok: true as const, created: persisted.created });
  } catch {
    return failure("storage_failure");
  }
}

/**
 * A deliberately unregistered handler. A future A8-C operator path must
 * provide the read and write boundaries explicitly; this factory neither opens
 * a database nor activates a worker, queue, scheduler, or manual CLI.
 */
export function createHCycleEvaluateDormantHandlerV1(
  dependencies: HCycleEvaluateDormantHandlerDependenciesV1,
): LoopJobHandler {
  return Object.freeze({
    idempotencyKey: "job_id" as const,
    async handle(context) {
      const result = await executeHCycleEvaluateDormantV1(context.payload, dependencies);
      if (!result.ok) throw new Error(result.code);
    },
  });
}
