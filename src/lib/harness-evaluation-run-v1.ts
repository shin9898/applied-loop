import { createHash } from "node:crypto";

import type { HarnessEvaluationRun, PrismaClient } from "../generated/prisma/client";
import {
  normalizeHarnessEvaluationReportV1,
  type HarnessEvaluationReportV1,
} from "./loop-jobs/harness-evaluation/harness-evaluation-report-v1";
import { canonicalJson } from "./loop-jobs/state-machine";

const RECORD_SCHEMA_V1 = "harness_evaluation_run_v1" as const;
const REPORT_SCHEMA_V1 = "harness_evaluation_report_v1" as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RECORD_INPUT_KEYS = ["client", "evaluationKeyHash", "report", "evaluatedAt"] as const;
const RECORD_WRITE_INPUT_KEYS = ["evaluationKeyHash", "report", "evaluatedAt"] as const;

type DataObject = Record<string, unknown>;
type HarnessEvaluationRunClient = Readonly<{
  harnessEvaluationRun: Pick<PrismaClient["harnessEvaluationRun"], "create" | "findUnique">;
}>;

export type HarnessEvaluationRunIdentityV1 = Readonly<{
  recordSchema: typeof RECORD_SCHEMA_V1;
  reportSchema: typeof REPORT_SCHEMA_V1;
  evaluationKeyHash: string;
}>;

export type PreparedHarnessEvaluationRunV1 = Readonly<{
  identity: HarnessEvaluationRunIdentityV1;
  evaluatedAt: Date;
  reportEnvelopeJson: string;
  reportEnvelopeSha256: string;
  recordSha256: string;
}>;

type PreparedRecord = PreparedHarnessEvaluationRunV1 & Readonly<{ client: HarnessEvaluationRunClient }>;

export type PersistHarnessEvaluationRunResult =
  | Readonly<{ ok: true; created: boolean; record: HarnessEvaluationRun }>
  | Readonly<{
    ok: false;
    code: "invalid_evaluation_run" | "evaluation_run_integrity_failure" | "storage_failure";
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneDate(value: unknown): Date | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Date.prototype) return null;
  const milliseconds = (value as Date).getTime();
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function prepareRecord(input: unknown): PreparedRecord | null {
  try {
    const record = dataObject(input);
    if (!record
      || !hasExactKeys(record, RECORD_INPUT_KEYS)
      || record.client === null
      || typeof record.client !== "object"
      || Array.isArray(record.client)) return null;

    const evaluationKeyHash = record.evaluationKeyHash;
    if (typeof evaluationKeyHash !== "string" || !HASH_PATTERN.test(evaluationKeyHash)) return null;
    const report = normalizeHarnessEvaluationReportV1(record.report);
    const evaluatedAt = cloneDate(record.evaluatedAt);
    if (report === null || evaluatedAt === null) return null;

    const reportEnvelopeJson = canonicalJson(report);
    const reportEnvelopeSha256 = sha256(reportEnvelopeJson);
    const identity: HarnessEvaluationRunIdentityV1 = Object.freeze({
      recordSchema: RECORD_SCHEMA_V1,
      reportSchema: REPORT_SCHEMA_V1,
      evaluationKeyHash,
    });
    const recordSha256 = sha256(canonicalJson({
      ...identity,
      evaluatedAt: evaluatedAt.toISOString(),
      reportEnvelopeSha256,
    }));
    return Object.freeze({
      client: record.client as HarnessEvaluationRunClient,
      identity,
      evaluatedAt,
      reportEnvelopeJson,
      reportEnvelopeSha256,
      recordSha256,
    });
  } catch {
    return null;
  }
}

function identityWhere(identity: HarnessEvaluationRunIdentityV1) {
  return { recordSchema_reportSchema_evaluationKeyHash: identity };
}

function recordConstraintTarget(value: unknown): boolean {
  const fields = ["recordSchema", "reportSchema", "evaluationKeyHash"];
  if (Array.isArray(value)) return value.length === fields.length && value.every((field, index) => field === fields[index]);
  return value === "HarnessEvaluationRun_recordSchema_reportSchema_evaluationKeyHash_key";
}

function targetedRecordP2002(error: unknown): boolean {
  const record = errorObject(error);
  if (!record || record.code !== "P2002") return false;
  const meta = errorObject(record.meta);
  if (!meta || (meta.modelName !== undefined && meta.modelName !== "HarnessEvaluationRun")) return false;
  if (recordConstraintTarget(meta.target)) return true;
  const adapterError = errorObject(meta.driverAdapterError);
  const cause = adapterError === null ? null : errorObject(adapterError.cause);
  const constraint = cause === null ? null : errorObject(cause.constraint);
  return constraint !== null && recordConstraintTarget(constraint.fields);
}

function failure(code: Extract<PersistHarnessEvaluationRunResult, { ok: false }>['code']): PersistHarnessEvaluationRunResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Persists one closed aggregate report. The unique identity makes retries
 * idempotent, while a changed report for the same identity is an integrity
 * failure. This function never updates or deletes an existing record.
 */
export async function persistHarnessEvaluationRunV1(input: unknown): Promise<PersistHarnessEvaluationRunResult> {
  const prepared = prepareRecord(input);
  if (prepared === null) return failure("invalid_evaluation_run");
  try {
    const created = await prepared.client.harnessEvaluationRun.create({
      data: {
        ...prepared.identity,
        evaluatedAt: prepared.evaluatedAt,
        reportEnvelopeJson: prepared.reportEnvelopeJson,
        reportEnvelopeSha256: prepared.reportEnvelopeSha256,
        recordSha256: prepared.recordSha256,
      },
    });
    return Object.freeze({ ok: true as const, created: true, record: created });
  } catch (error) {
    if (!targetedRecordP2002(error)) return failure("storage_failure");
  }
  try {
    const winner = await prepared.client.harnessEvaluationRun.findUnique({ where: identityWhere(prepared.identity) });
    if (winner === null) return failure("storage_failure");
    if (winner.reportEnvelopeSha256 !== prepared.reportEnvelopeSha256) {
      return failure("evaluation_run_integrity_failure");
    }
    return Object.freeze({ ok: true as const, created: false, record: winner });
  } catch {
    return failure("storage_failure");
  }
}

export const HARNESS_EVALUATION_RUN_RECORD_SCHEMA_V1 = RECORD_SCHEMA_V1;
export const HARNESS_EVALUATION_RUN_REPORT_SCHEMA_V1 = REPORT_SCHEMA_V1;
export const HARNESS_EVALUATION_RUN_WRITE_INPUT_KEYS_V1 = RECORD_WRITE_INPUT_KEYS;
export type { HarnessEvaluationReportV1 };

// A9-D1: deterministic, feature-off observation-window boundary. The source
// carries only opaque identity hashes and aggregate outcomes. A caller can
// pass the resulting evaluationKeyHash to the A9-B writer without exposing a
// source-specific key or adding scheduler authority.
const HARNESS_EVALUATION_WINDOW_SOURCE_SCHEMA = "harness_evaluation_window_source_v1" as const;
const HARNESS_EVALUATION_WINDOW_SCHEMA = "harness_evaluation_window_v1" as const;
const HARNESS_EVALUATION_WINDOW_RESULT_SCHEMA = "harness_evaluation_window_result_v1" as const;
const WINDOW_SOURCE_KEYS = [
  "schema",
  "cohort",
  "policyVersion",
  "scopeHash",
  "cadence",
  "periodOrdinal",
  "periodStartEpochMs",
  "periodEndEpochMs",
  "outcome",
  "decisionStage",
] as const;
const WINDOW_SET_KEYS = ["schema", "windows"] as const;
const WINDOW_COHORTS = ["h_cycle", "h_eval", "h_cache"] as const;
const WINDOW_POLICY_VERSIONS = {
  h_cycle: "h_cycle_evidence_v1",
  h_eval: "v1",
  h_cache: "harness-usage-v1",
} as const;
const WINDOW_CADENCES = ["daily", "weekly", "intervention_7d", "intervention_14d", "monthly"] as const;
const WINDOW_OUTCOMES = ["supported", "rejected", "inconclusive"] as const;
const WINDOW_DECISION_STAGES = ["provisional", "final"] as const;
const MAX_WINDOW_SET_SIZE = 128;

type HarnessEvaluationWindowCohort = (typeof WINDOW_COHORTS)[number];
type HarnessEvaluationWindowCadence = (typeof WINDOW_CADENCES)[number];
type HarnessEvaluationWindowOutcome = (typeof WINDOW_OUTCOMES)[number];
type HarnessEvaluationWindowDecisionStage = (typeof WINDOW_DECISION_STAGES)[number];

export type HarnessEvaluationWindowV1 = Readonly<{
  schema: typeof HARNESS_EVALUATION_WINDOW_SCHEMA;
  cohort: HarnessEvaluationWindowCohort;
  policyVersion: string;
  scopeHash: string;
  cadence: HarnessEvaluationWindowCadence;
  periodHash: string;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
  outcome: HarnessEvaluationWindowOutcome;
  decisionStage: HarnessEvaluationWindowDecisionStage;
}>;

export type HarnessEvaluationWindowResultV1 = Readonly<{
  schema: typeof HARNESS_EVALUATION_WINDOW_RESULT_SCHEMA;
  mode: "dormant_policy_only";
  cohort: HarnessEvaluationWindowCohort | null;
  policyVersion: string | null;
  scopeHash: string | null;
  cadence: HarnessEvaluationWindowCadence | null;
  status: "baseline_collecting" | "inconclusive" | "eligible";
  outcome: HarnessEvaluationWindowOutcome;
  decisionStage: HarnessEvaluationWindowDecisionStage;
  requiredAdjacentWindows: 2;
  observedWindowCount: number;
  adjacentWindowCount: 0 | 2;
  currentPeriodHash: string | null;
  previousPeriodHash: string | null;
  evaluationKeyHash: string | null;
  reasonCode:
    | "fewer_than_two_completed_windows"
    | "no_adjacent_completed_windows"
    | "inconclusive_window"
    | "outcome_changed"
    | "current_window_provisional"
    | "eligible_window"
    | "invalid_window";
  automaticInterventionAllowed: false;
}>;

const WINDOW_POLICY_VERSION_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function isOneOfWindow<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function safeWindowCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function validWindowPolicyVersion(value: unknown): value is string {
  return typeof value === "string" && WINDOW_POLICY_VERSION_PATTERN.test(value);
}

function validWindowOutcomeTuple(
  outcome: HarnessEvaluationWindowOutcome,
  decisionStage: HarnessEvaluationWindowDecisionStage,
): boolean {
  return outcome !== "inconclusive" || decisionStage === "provisional";
}

function windowPeriodHash(input: Readonly<{
  cohort: HarnessEvaluationWindowCohort;
  policyVersion: string;
  cadence: HarnessEvaluationWindowCadence;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
}>): string {
  return sha256(canonicalJson([
    "harness_evaluation_period_v1",
    input.cohort,
    input.policyVersion,
    input.cadence,
    input.periodOrdinal,
    input.periodStartEpochMs,
    input.periodEndEpochMs,
  ]));
}

/**
 * Derives the opaque A9-B identity for one normalized observation window.
 * The input contains no raw period key, repository path, or usage row.
 */
export function deriveHarnessEvaluationWindowKeyHashV1(window: HarnessEvaluationWindowV1): string {
  return sha256(canonicalJson([
    "harness_evaluation_window_key_v1",
    RECORD_SCHEMA_V1,
    REPORT_SCHEMA_V1,
    window.cohort,
    window.policyVersion,
    window.scopeHash,
    window.cadence,
    window.periodHash,
  ]));
}

function cloneClosedWindowInput(value: unknown): unknown | null {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function readHarnessEvaluationWindow(value: unknown): HarnessEvaluationWindowV1 | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, WINDOW_SOURCE_KEYS)
    || record.schema !== HARNESS_EVALUATION_WINDOW_SOURCE_SCHEMA
    || !isOneOfWindow(WINDOW_COHORTS, record.cohort)
    || !validWindowPolicyVersion(record.policyVersion)
    || record.policyVersion !== WINDOW_POLICY_VERSIONS[record.cohort]
    || typeof record.scopeHash !== "string"
    || !HASH_PATTERN.test(record.scopeHash)
    || !isOneOfWindow(WINDOW_CADENCES, record.cadence)
    || !safeWindowCount(record.periodOrdinal)
    || !safeWindowCount(record.periodStartEpochMs)
    || !safeWindowCount(record.periodEndEpochMs)
    || record.periodEndEpochMs <= record.periodStartEpochMs
    || !isOneOfWindow(WINDOW_OUTCOMES, record.outcome)
    || !isOneOfWindow(WINDOW_DECISION_STAGES, record.decisionStage)
    || !validWindowOutcomeTuple(record.outcome, record.decisionStage)
  ) {
    return undefined;
  }
  const identity = {
    cohort: record.cohort,
    policyVersion: record.policyVersion,
    cadence: record.cadence,
    periodOrdinal: record.periodOrdinal,
    periodStartEpochMs: record.periodStartEpochMs,
    periodEndEpochMs: record.periodEndEpochMs,
  } as const;
  return Object.freeze({
    schema: HARNESS_EVALUATION_WINDOW_SCHEMA,
    ...identity,
    scopeHash: record.scopeHash,
    periodHash: windowPeriodHash(identity),
    outcome: record.outcome,
    decisionStage: record.decisionStage,
  });
}

/**
 * Normalizes one aggregate-only window source. Callers must supply completed
 * windows; this function never reads a clock or a database.
 */
export function normalizeHarnessEvaluationWindowV1(value: unknown): HarnessEvaluationWindowV1 | null {
  try {
    return readHarnessEvaluationWindow(cloneClosedWindowInput(value)) ?? null;
  } catch {
    return null;
  }
}

export function isHarnessEvaluationWindowV1(value: unknown): boolean {
  return normalizeHarnessEvaluationWindowV1(value) !== null;
}

function windowSetResult(
  values: Omit<HarnessEvaluationWindowResultV1, "schema" | "mode" | "automaticInterventionAllowed">,
): HarnessEvaluationWindowResultV1 {
  return Object.freeze({
    schema: HARNESS_EVALUATION_WINDOW_RESULT_SCHEMA,
    mode: "dormant_policy_only" as const,
    ...values,
    automaticInterventionAllowed: false as const,
  });
}

function invalidWindowSetResult(): HarnessEvaluationWindowResultV1 {
  return windowSetResult({
    cohort: null,
    policyVersion: null,
    scopeHash: null,
    cadence: null,
    status: "inconclusive",
    outcome: "inconclusive",
    decisionStage: "provisional",
    requiredAdjacentWindows: 2,
    observedWindowCount: 0,
    adjacentWindowCount: 0,
    currentPeriodHash: null,
    previousPeriodHash: null,
    evaluationKeyHash: null,
    reasonCode: "invalid_window",
  });
}

function validWindowSet(value: unknown): HarnessEvaluationWindowV1[] | null {
  const clone = cloneClosedWindowInput(value);
  const record = dataObject(clone);
  if (!record || !hasExactKeys(record, WINDOW_SET_KEYS) || record.schema !== "harness_evaluation_window_set_v1" || !Array.isArray(record.windows) || record.windows.length > MAX_WINDOW_SET_SIZE) {
    return null;
  }
  const windows = record.windows.map((window) => normalizeHarnessEvaluationWindowV1(window));
  if (windows.some((window): window is null => window === null)) return null;
  const normalized = windows as HarnessEvaluationWindowV1[];
  if (normalized.length === 0) return normalized;
  const first = normalized[0];
  const periodHashes = new Set<string>();
  for (const window of normalized) {
    if (
      window.cohort !== first.cohort
      || window.policyVersion !== first.policyVersion
      || window.scopeHash !== first.scopeHash
      || window.cadence !== first.cadence
      || periodHashes.has(window.periodHash)
    ) {
      return null;
    }
    periodHashes.add(window.periodHash);
  }
  return normalized.sort((left, right) => left.periodStartEpochMs - right.periodStartEpochMs || left.periodOrdinal - right.periodOrdinal);
}

/**
 * Applies the A9-D1 two-adjacent-window rule to one cohort. The latest
 * adjacent pair is selected; mixed cohort/policy/scope input fails closed.
 */
export function evaluateHarnessEvaluationWindowsV1(value: unknown): HarnessEvaluationWindowResultV1 {
  try {
    const windows = validWindowSet(value);
    if (windows === null) return invalidWindowSetResult();
    if (windows.length === 0) {
      return windowSetResult({
        cohort: null,
        policyVersion: null,
        scopeHash: null,
        cadence: null,
        status: "baseline_collecting",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        observedWindowCount: 0,
        adjacentWindowCount: 0,
        currentPeriodHash: null,
        previousPeriodHash: null,
        evaluationKeyHash: null,
        reasonCode: "fewer_than_two_completed_windows",
      });
    }

    const current = windows[windows.length - 1];
    const common = {
      cohort: current.cohort,
      policyVersion: current.policyVersion,
      scopeHash: current.scopeHash,
      cadence: current.cadence,
      observedWindowCount: windows.length,
      currentPeriodHash: current.periodHash,
      evaluationKeyHash: deriveHarnessEvaluationWindowKeyHashV1(current),
    } as const;
    if (windows.length < 2) {
      return windowSetResult({
        ...common,
        status: "baseline_collecting",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        adjacentWindowCount: 0,
        previousPeriodHash: null,
        reasonCode: "fewer_than_two_completed_windows",
      });
    }

    let pair: readonly [HarnessEvaluationWindowV1, HarnessEvaluationWindowV1] | null = null;
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const candidate = windows[index];
      if (
        previous.periodEndEpochMs === candidate.periodStartEpochMs
        && previous.periodOrdinal + 1 === candidate.periodOrdinal
      ) {
        pair = [previous, candidate];
      }
    }
    if (pair === null) {
      return windowSetResult({
        ...common,
        status: "baseline_collecting",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        adjacentWindowCount: 0,
        previousPeriodHash: null,
        reasonCode: "no_adjacent_completed_windows",
      });
    }

    const [previous, latest] = pair;
    const pairCommon = {
      ...common,
      currentPeriodHash: latest.periodHash,
      previousPeriodHash: previous.periodHash,
      adjacentWindowCount: 2 as const,
    } as const;
    if (previous.outcome === "inconclusive" || latest.outcome === "inconclusive") {
      return windowSetResult({
        ...pairCommon,
        status: "inconclusive",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        reasonCode: "inconclusive_window",
      });
    }
    if (previous.outcome !== latest.outcome) {
      return windowSetResult({
        ...pairCommon,
        status: "inconclusive",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        reasonCode: "outcome_changed",
      });
    }
    if (latest.decisionStage !== "final") {
      return windowSetResult({
        ...pairCommon,
        status: "inconclusive",
        outcome: "inconclusive",
        decisionStage: "provisional",
        requiredAdjacentWindows: 2,
        reasonCode: "current_window_provisional",
      });
    }
    return windowSetResult({
      ...pairCommon,
      status: "eligible",
      outcome: latest.outcome,
      decisionStage: "final",
      requiredAdjacentWindows: 2,
      reasonCode: "eligible_window",
    });
  } catch {
    return invalidWindowSetResult();
  }
}
