import { createHash } from "node:crypto";

import type { HCycleEvaluationRecord, PrismaClient } from "../generated/prisma/client";
import {
  evaluateHCycleEvidencePolicyV1,
  H_CYCLE_COHORT_KINDS_V1,
  H_CYCLE_POLICY_VERSION_V1,
  type EvidenceRate,
  type HCycleCount,
  type HCycleEvidencePolicyResultV1,
  type HCycleEvidenceProjectionV1,
} from "./h-cycle-projection";
import { canonicalJson } from "./loop-jobs/state-machine";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RECORD_SCHEMA_V1 = "h_cycle_evaluation_record_v1" as const;
const PREVIEW_SCHEMA_V1 = "h_cycle_evidence_preview_v1" as const;
const PROJECTION_SCHEMA_V1 = "h_cycle_evidence_projection_v1" as const;

const ROOT_KEYS = ["schema", "policyVersion", "targetWeekKey", "projections", "policy"] as const;
const PROJECTION_KEYS = [
  "schema",
  "policyVersion",
  "period",
  "cohortKinds",
  "selfAssessmentRate",
  "actionableCheckCount",
  "explicitPromotionRate",
  "answeredPromotedGateRate",
  "gradedPromotedGateRate",
  "failedTriageRate",
  "scheduledFollowupRate",
  "evidenceClosureRate",
  "diagnostics",
] as const;
const PERIOD_KEYS = ["weekKey", "start", "end", "asOf"] as const;
const RECORD_INPUT_KEYS = ["client", "preview", "scheduledFor", "evaluatedAt", "triggerKind", "timeliness"] as const;
const KNOWN_RATE_REASONS = new Set([
  "invalid_mastery_event",
  "invalid_gate_state_history",
  "pending_gate",
  "self_graded_gate",
  "grading_failed",
  "non_evaluable_gate",
  "missing_gate_capture",
  "malformed_capture_mapping",
  "pending_capture",
  "missing_followup_observation",
  "ignored_capture",
]);
const KNOWN_DIAGNOSTICS = new Set([
  "ambiguous_mastery_event",
  "duplicate_failure_capture",
  "duplicate_followup_observation",
  "duplicate_gate_state_event",
  "duplicate_promotion_gate",
  "duplicate_source_revision",
  "failure_capture_without_failed_event",
  "followup_without_failure_capture",
  "invalid_failure_capture",
  "invalid_followup_observation",
  "invalid_gate_state_event",
  "invalid_gate_state_history",
  "invalid_gate_state_transition",
  "invalid_mastery_event",
  "invalid_promotion",
  "invalid_source_revision",
  "malformed_failure_capture_mapping",
  "malformed_followup_observation",
  "non_contiguous_gate_state_ordinal",
  "non_monotonic_gate_state_time",
  "origin_before_source_observation",
  "promotion_without_source_revision",
  "state_event_without_promotion",
]);

type DataObject = Record<string, unknown>;
type ParsedIsoWeek = Readonly<{ year: number; week: number; weekKey: string }>;
type ClosedPreviewEnvelope = Readonly<{
  schema: typeof PREVIEW_SCHEMA_V1;
  policyVersion: typeof H_CYCLE_POLICY_VERSION_V1;
  targetWeekKey: string;
  projections: readonly [HCycleEvidenceProjectionV1, HCycleEvidenceProjectionV1];
  policy: HCycleEvidencePolicyResultV1;
}>;
type RecordIdentity = Readonly<{
  recordSchema: typeof RECORD_SCHEMA_V1;
  policyVersion: typeof H_CYCLE_POLICY_VERSION_V1;
  projectionSchemaVersion: typeof PREVIEW_SCHEMA_V1;
  targetWeekKey: string;
}>;
type HCycleEvaluationRecordClient = Readonly<{
  hCycleEvaluationRecord: Pick<PrismaClient["hCycleEvaluationRecord"], "create" | "findUnique">;
}>;
type PreparedRecord = Readonly<{
  client: HCycleEvaluationRecordClient;
  identity: RecordIdentity;
  previousWeekKey: string;
  previousPeriodJson: string;
  targetPeriodJson: string;
  scheduledFor: Date;
  evaluatedAt: Date;
  triggerKind: "scheduled" | "catch_up";
  timeliness: "on_time" | "catch_up";
  aggregateEnvelopeJson: string;
  aggregateEnvelopeSha256: string;
  recordSha256: string;
}>;

export type PersistHCycleEvaluationRecordResult =
  | Readonly<{ ok: true; created: boolean; record: HCycleEvaluationRecord }>
  | Readonly<{
    ok: false;
    code: "invalid_evaluation_record" | "evaluation_record_integrity_failure" | "storage_failure";
  }>;

function dataObject(value: unknown): DataObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function errorObject(value: unknown): DataObject | null {
  return value !== null && typeof value === "object" ? value as DataObject : null;
}

function hasExactKeys(record: DataObject, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function utcMidnightMs(year: number, month: number, date: number): number {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month, date);
  instant.setUTCHours(0, 0, 0, 0);
  return instant.getTime();
}

function firstJstIsoMondayMs(year: number): number {
  const janFourthMs = utcMidnightMs(year, 0, 4);
  const janFourthWeekday = new Date(janFourthMs).getUTCDay() || 7;
  return janFourthMs - (janFourthWeekday - 1) * DAY_MS - JST_OFFSET_MS;
}

function isoWeeksInJstYear(year: number): number {
  return Math.round((firstJstIsoMondayMs(year + 1) - firstJstIsoMondayMs(year)) / WEEK_MS);
}

function parseIsoWeek(value: unknown): ParsedIsoWeek | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999 || !Number.isSafeInteger(week) || week < 1 || week > isoWeeksInJstYear(year)) {
    return null;
  }
  return Object.freeze({ year, week, weekKey: value });
}

function isoWeekKeyForJstMonday(startMs: number): string {
  const jstMonday = new Date(startMs + JST_OFFSET_MS);
  const mondayMs = utcMidnightMs(jstMonday.getUTCFullYear(), jstMonday.getUTCMonth(), jstMonday.getUTCDate());
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstMondayMs = firstJstIsoMondayMs(isoYear) + JST_OFFSET_MS;
  const week = Math.floor((mondayMs - firstMondayMs) / WEEK_MS) + 1;
  return String(isoYear) + "-W" + String(week).padStart(2, "0");
}

function periodForIsoWeek(week: ParsedIsoWeek): HCycleEvidenceProjectionV1["period"] {
  const startMs = firstJstIsoMondayMs(week.year) + (week.week - 1) * WEEK_MS;
  const endMs = startMs + WEEK_MS;
  return Object.freeze({
    weekKey: week.weekKey,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    asOf: new Date(endMs).toISOString(),
  });
}

function previousPeriodFor(target: ParsedIsoWeek): HCycleEvidenceProjectionV1["period"] {
  const targetPeriod = periodForIsoWeek(target);
  const previousStartMs = Date.parse(targetPeriod.start) - WEEK_MS;
  const previousWeekKey = isoWeekKeyForJstMonday(previousStartMs);
  const previousWeek = parseIsoWeek(previousWeekKey);
  if (previousWeek === null) throw new Error("invalid_previous_iso_week");
  return periodForIsoWeek(previousWeek);
}

function exactIsoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? value : null;
}

function normalizePeriod(value: unknown): HCycleEvidenceProjectionV1["period"] | null {
  const record = dataObject(value);
  if (!record || !hasExactKeys(record, PERIOD_KEYS)) return null;
  const week = parseIsoWeek(record.weekKey);
  const start = exactIsoInstant(record.start);
  const end = exactIsoInstant(record.end);
  const asOf = exactIsoInstant(record.asOf);
  if (week === null || start === null || end === null || asOf === null) return null;
  if (Date.parse(end) - Date.parse(start) !== WEEK_MS || Date.parse(asOf) !== Date.parse(end)) return null;
  return Object.freeze({ weekKey: week.weekKey, start, end, asOf });
}

function normalizeRate(value: unknown): EvidenceRate | null {
  const record = dataObject(value);
  if (!record || typeof record.status !== "string") return null;
  if (record.status === "measured") {
    if (!hasExactKeys(record, ["status", "numerator", "denominator", "ratio"])
      || !safeNonNegativeInteger(record.numerator)
      || !safeNonNegativeInteger(record.denominator)
      || record.denominator === 0
      || typeof record.ratio !== "number"
      || !Number.isFinite(record.ratio)
      || record.ratio !== record.numerator / record.denominator) return null;
    return Object.freeze({
      status: "measured" as const,
      numerator: record.numerator,
      denominator: record.denominator,
      ratio: record.ratio,
    });
  }
  if (record.status === "not_applicable") {
    if (!hasExactKeys(record, ["status", "numerator", "denominator", "reason"])
      || record.numerator !== 0
      || record.denominator !== 0
      || record.reason !== "zero_denominator") return null;
    return Object.freeze({ status: "not_applicable" as const, numerator: 0 as const, denominator: 0 as const, reason: "zero_denominator" as const });
  }
  if (record.status === "incomplete") {
    if (!hasExactKeys(record, ["status", "numerator", "denominator", "reason"])
      || !safeNonNegativeInteger(record.numerator)
      || !safeNonNegativeInteger(record.denominator)
      || record.denominator === 0
      || typeof record.reason !== "string"
      || !KNOWN_RATE_REASONS.has(record.reason)) return null;
    return Object.freeze({
      status: "incomplete" as const,
      numerator: record.numerator,
      denominator: record.denominator,
      reason: record.reason,
    });
  }
  return null;
}

function normalizeCount(value: unknown): HCycleCount | null {
  const record = dataObject(value);
  if (!record || typeof record.status !== "string" || !safeNonNegativeInteger(record.count)) return null;
  if (record.status === "measured" && hasExactKeys(record, ["status", "count"])) {
    return Object.freeze({ status: "measured" as const, count: record.count });
  }
  if (record.status === "incomplete"
    && hasExactKeys(record, ["status", "count", "reason"])
    && typeof record.reason === "string"
    && KNOWN_RATE_REASONS.has(record.reason)) {
    return Object.freeze({ status: "incomplete" as const, count: record.count, reason: record.reason });
  }
  return null;
}

function normalizeDiagnostics(value: unknown): Readonly<Record<string, number>> | null {
  const record = dataObject(value);
  if (!record) return null;
  const normalized: Record<string, number> = Object.create(null);
  for (const [key, count] of Object.entries(record)) {
    if (!KNOWN_DIAGNOSTICS.has(key) || !safeNonNegativeInteger(count) || count === 0) return null;
    normalized[key] = count;
  }
  return Object.freeze(Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))));
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function normalizeProjection(value: unknown): HCycleEvidenceProjectionV1 | null {
  const record = dataObject(value);
  if (!record || !hasExactKeys(record, PROJECTION_KEYS)
    || record.schema !== PROJECTION_SCHEMA_V1
    || record.policyVersion !== H_CYCLE_POLICY_VERSION_V1) return null;
  const period = normalizePeriod(record.period);
  const cohortKinds = dataObject(record.cohortKinds);
  const selfAssessmentRate = normalizeRate(record.selfAssessmentRate);
  const actionableCheckCount = normalizeCount(record.actionableCheckCount);
  const explicitPromotionRate = normalizeRate(record.explicitPromotionRate);
  const answeredPromotedGateRate = normalizeRate(record.answeredPromotedGateRate);
  const gradedPromotedGateRate = normalizeRate(record.gradedPromotedGateRate);
  const failedTriageRate = normalizeRate(record.failedTriageRate);
  const scheduledFollowupRate = normalizeRate(record.scheduledFollowupRate);
  const evidenceClosureRate = normalizeRate(record.evidenceClosureRate);
  const diagnostics = normalizeDiagnostics(record.diagnostics);
  if (period === null || cohortKinds === null || !sameCanonical(cohortKinds, H_CYCLE_COHORT_KINDS_V1)
    || selfAssessmentRate === null || actionableCheckCount === null || explicitPromotionRate === null
    || answeredPromotedGateRate === null || gradedPromotedGateRate === null || failedTriageRate === null
    || scheduledFollowupRate === null || evidenceClosureRate === null || diagnostics === null) return null;
  return Object.freeze({
    schema: PROJECTION_SCHEMA_V1,
    policyVersion: H_CYCLE_POLICY_VERSION_V1,
    period,
    cohortKinds: H_CYCLE_COHORT_KINDS_V1,
    selfAssessmentRate,
    actionableCheckCount,
    explicitPromotionRate,
    answeredPromotedGateRate,
    gradedPromotedGateRate,
    failedTriageRate,
    scheduledFollowupRate,
    evidenceClosureRate,
    diagnostics,
  });
}

function normalizeClosedPreview(value: unknown): ClosedPreviewEnvelope | null {
  try {
    const record = dataObject(value);
    if (!record || !hasExactKeys(record, ROOT_KEYS)
      || record.schema !== PREVIEW_SCHEMA_V1
      || record.policyVersion !== H_CYCLE_POLICY_VERSION_V1
      || !Array.isArray(record.projections)
      || record.projections.length !== 2) return null;
    const targetWeek = parseIsoWeek(record.targetWeekKey);
    const previous = normalizeProjection(record.projections[0]);
    const target = normalizeProjection(record.projections[1]);
    if (targetWeek === null || previous === null || target === null) return null;
    const expectedTargetPeriod = periodForIsoWeek(targetWeek);
    const expectedPreviousPeriod = previousPeriodFor(targetWeek);
    if (!sameCanonical(previous.period, expectedPreviousPeriod)
      || !sameCanonical(target.period, expectedTargetPeriod)
      || target.period.weekKey !== targetWeek.weekKey) return null;
    const expectedPolicy = evaluateHCycleEvidencePolicyV1([previous, target]);
    if (!sameCanonical(record.policy, expectedPolicy)) return null;
    return Object.freeze({
      schema: PREVIEW_SCHEMA_V1,
      policyVersion: H_CYCLE_POLICY_VERSION_V1,
      targetWeekKey: targetWeek.weekKey,
      projections: Object.freeze([previous, target]) as readonly [HCycleEvidenceProjectionV1, HCycleEvidenceProjectionV1],
      policy: expectedPolicy,
    });
  } catch {
    return null;
  }
}

function validDate(value: unknown): Date | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  return new Date(value.getTime());
}

function prepareRecord(input: unknown): PreparedRecord | null {
  try {
    const record = dataObject(input);
    if (!record || !hasExactKeys(record, RECORD_INPUT_KEYS)
      || record.client === null || typeof record.client !== "object") return null;
    const preview = normalizeClosedPreview(record.preview);
    const scheduledFor = validDate(record.scheduledFor);
    const evaluatedAt = validDate(record.evaluatedAt);
    const triggerKind = record.triggerKind;
    const timeliness = record.timeliness;
    if (preview === null || scheduledFor === null || evaluatedAt === null || scheduledFor.getTime() > evaluatedAt.getTime()
      || !((triggerKind === "scheduled" && timeliness === "on_time")
        || (triggerKind === "catch_up" && timeliness === "catch_up"))) return null;

    const aggregateEnvelopeJson = canonicalJson(preview);
    const aggregateEnvelopeSha256 = sha256(aggregateEnvelopeJson);
    const previousPeriodJson = canonicalJson(preview.projections[0].period);
    const targetPeriodJson = canonicalJson(preview.projections[1].period);
    const identity: RecordIdentity = Object.freeze({
      recordSchema: RECORD_SCHEMA_V1,
      policyVersion: H_CYCLE_POLICY_VERSION_V1,
      projectionSchemaVersion: PREVIEW_SCHEMA_V1,
      targetWeekKey: preview.targetWeekKey,
    });
    const recordSha256 = sha256(canonicalJson({
      ...identity,
      previousWeekKey: preview.projections[0].period.weekKey,
      previousPeriodJson,
      targetPeriodJson,
      scheduledFor: scheduledFor.toISOString(),
      evaluatedAt: evaluatedAt.toISOString(),
      triggerKind,
      timeliness,
      aggregateEnvelopeSha256,
    }));
    return Object.freeze({
      client: record.client as HCycleEvaluationRecordClient,
      identity,
      previousWeekKey: preview.projections[0].period.weekKey,
      previousPeriodJson,
      targetPeriodJson,
      scheduledFor,
      evaluatedAt,
      triggerKind,
      timeliness,
      aggregateEnvelopeJson,
      aggregateEnvelopeSha256,
      recordSha256,
    });
  } catch {
    return null;
  }
}

function identityWhere(identity: RecordIdentity) {
  return {
    recordSchema_policyVersion_projectionSchemaVersion_targetWeekKey: identity,
  };
}

function recordConstraintTarget(value: unknown): boolean {
  const fields = ["recordSchema", "policyVersion", "projectionSchemaVersion", "targetWeekKey"];
  if (Array.isArray(value)) return value.length === fields.length && value.every((field, index) => field === fields[index]);
  return value === "HCycleEvaluationRecord_recordSchema_policyVersion_projectionSchemaVersion_targetWeekKey_key";
}

function targetedRecordP2002(error: unknown): boolean {
  const record = errorObject(error);
  if (!record || record.code !== "P2002") return false;
  const meta = errorObject(record.meta);
  if (!meta || (meta.modelName !== undefined && meta.modelName !== "HCycleEvaluationRecord")) return false;
  if (recordConstraintTarget(meta.target)) return true;
  const adapterError = errorObject(meta.driverAdapterError);
  const cause = adapterError === null ? null : errorObject(adapterError.cause);
  const constraint = cause === null ? null : errorObject(cause.constraint);
  return constraint !== null && recordConstraintTarget(constraint.fields);
}

function failure(code: Extract<PersistHCycleEvaluationRecordResult, { ok: false }>["code"]): PersistHCycleEvaluationRecordResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Records a normalized preview once. The only retry-safe equality is the
 * canonical aggregate envelope digest; this writer never updates or deletes.
 */
export async function persistHCycleEvaluationRecordV1(input: unknown): Promise<PersistHCycleEvaluationRecordResult> {
  const prepared = prepareRecord(input);
  if (prepared === null) return failure("invalid_evaluation_record");
  try {
    const created = await prepared.client.hCycleEvaluationRecord.create({
      data: {
        ...prepared.identity,
        previousWeekKey: prepared.previousWeekKey,
        previousPeriodJson: prepared.previousPeriodJson,
        targetPeriodJson: prepared.targetPeriodJson,
        scheduledFor: prepared.scheduledFor,
        evaluatedAt: prepared.evaluatedAt,
        triggerKind: prepared.triggerKind,
        timeliness: prepared.timeliness,
        aggregateEnvelopeJson: prepared.aggregateEnvelopeJson,
        aggregateEnvelopeSha256: prepared.aggregateEnvelopeSha256,
        recordSha256: prepared.recordSha256,
      },
    });
    return Object.freeze({ ok: true as const, created: true, record: created });
  } catch (error) {
    if (!targetedRecordP2002(error)) return failure("storage_failure");
  }
  try {
    const winner = await prepared.client.hCycleEvaluationRecord.findUnique({ where: identityWhere(prepared.identity) });
    if (winner === null) return failure("storage_failure");
    if (winner.aggregateEnvelopeSha256 !== prepared.aggregateEnvelopeSha256) {
      return failure("evaluation_record_integrity_failure");
    }
    return Object.freeze({ ok: true as const, created: false, record: winner });
  } catch {
    return failure("storage_failure");
  }
}
