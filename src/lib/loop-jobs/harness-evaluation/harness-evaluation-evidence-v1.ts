import { isHarnessEvaluationEvidenceV1 } from "./harness-evaluation-report-v1";

const ROOT_KEYS = ["schema", "integrity", "hCycle", "hEval", "hCache"] as const;
const INTEGRITY_KEYS = [
  "schema",
  "privacyViolationCount",
  "dataLossDetected",
  "duplicateDurableEffectCount",
  "recordIntegrityFailureCount",
] as const;
const H_CYCLE_KEYS = ["schema", "policy", "executionFence", "recordReconcileFence"] as const;
const H_CYCLE_POLICY_KEYS = [
  "schema",
  "policyVersion",
  "status",
  "requiredAdjacentWindows",
  "evaluatedWeekKeys",
] as const;
const H_EVAL_KEYS = ["schema", "policyVersion", "verdict", "decisionStage", "reasonCode"] as const;
const H_CYCLE_STATUSES = ["baseline_collecting", "inconclusive", "supported", "rejected"] as const;
const FENCE_STATUSES = ["complete", "pending", "invalid"] as const;
const H_EVAL_VERDICTS = ["supported", "rejected", "inconclusive"] as const;
const H_EVAL_STAGES = ["provisional", "final"] as const;
const H_EVAL_REASONS = [
  "privacy_violation",
  "data_loss",
  "budget_exhausted",
  "evaluation_job_stalled",
  "duplicate_finding",
  "low_precision",
  "usage_unavailable",
  "no_scheduled_runs",
  "on_time_slo_missed",
  "eligible_window",
  "invalid_evidence",
] as const;

type DataRecord = Record<string, unknown>;
type HCycleStatus = (typeof H_CYCLE_STATUSES)[number];
type FenceStatus = (typeof FENCE_STATUSES)[number];
type HEvalVerdict = (typeof H_EVAL_VERDICTS)[number];
type HEvalStage = (typeof H_EVAL_STAGES)[number];
type HEvalReason = (typeof H_EVAL_REASONS)[number];

export type HarnessEvaluationEvidenceV1 = Readonly<{
  schema: "harness_evaluation_evidence_v1";
  integrity: Readonly<{
    schema: "harness_evaluation_integrity_v1";
    privacyViolationCount: number;
    dataLossDetected: boolean;
    duplicateDurableEffectCount: number;
    recordIntegrityFailureCount: number;
  }>;
  hCycle: Readonly<{
    schema: "h_cycle_evaluation_aggregate_v1";
    policyVersion: "h_cycle_evidence_v1";
    policyStatus: HCycleStatus;
    eligibleWindowCount: number;
    requiredAdjacentWindows: 2;
    executionFence: FenceStatus;
    recordReconcileFence: FenceStatus;
  }>;
  hEval: Readonly<{
    schema: "h_eval_report_cohort_v1";
    policyVersion: "v1";
    verdict: HEvalVerdict;
    decisionStage: HEvalStage;
    reasonCode: HEvalReason;
  }>;
  hCache: unknown;
}>;

export type HarnessEvaluationEvidenceBuildResultV1 =
  | Readonly<{
      schema: "harness_evaluation_evidence_build_result_v1";
      mode: "manual_preview_only";
      ok: true;
      code: "assembled";
      automaticInterventionAllowed: false;
      evidence: HarnessEvaluationEvidenceV1;
    }>
  | Readonly<{
      schema: "harness_evaluation_evidence_build_result_v1";
      mode: "manual_preview_only";
      ok: false;
      code: "invalid_source_evidence";
      automaticInterventionAllowed: false;
    }>;

type HCycle = Readonly<{
  policyStatus: HCycleStatus;
  eligibleWindowCount: number;
  executionFence: FenceStatus;
  recordReconcileFence: FenceStatus;
}>;

type HEval = Readonly<{
  verdict: HEvalVerdict;
  decisionStage: HEvalStage;
  reasonCode: HEvalReason;
}>;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function dataObject(value: unknown): DataRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result = Object.create(null) as DataRecord;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function hasExactKeys(record: DataRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expectedSorted = [...expected].sort();
  return actual.length === expectedSorted.length && actual.every((key, index) => key === expectedSorted[index]);
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function validIsoWeek(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);
}

function cloneClosedInput(value: unknown): unknown | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

function failure(): HarnessEvaluationEvidenceBuildResultV1 {
  return Object.freeze({
    schema: "harness_evaluation_evidence_build_result_v1" as const,
    mode: "manual_preview_only" as const,
    ok: false as const,
    code: "invalid_source_evidence" as const,
    automaticInterventionAllowed: false as const,
  });
}

function validHEvalTuple(
  verdict: HEvalVerdict,
  decisionStage: HEvalStage,
  reasonCode: HEvalReason,
): boolean {
  if (reasonCode === "privacy_violation" || reasonCode === "data_loss" || reasonCode === "duplicate_finding" || reasonCode === "budget_exhausted") {
    return verdict === "rejected" && decisionStage === "final";
  }
  if (reasonCode === "evaluation_job_stalled" || reasonCode === "low_precision") {
    return verdict === "rejected";
  }
  if (reasonCode === "usage_unavailable" || reasonCode === "no_scheduled_runs" || reasonCode === "on_time_slo_missed" || reasonCode === "invalid_evidence") {
    return verdict === "inconclusive" && decisionStage === "provisional";
  }
  return reasonCode === "eligible_window" && verdict === "supported";
}

function readIntegrity(value: unknown): HarnessEvaluationEvidenceV1["integrity"] | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, INTEGRITY_KEYS)
    || record.schema !== "harness_evaluation_integrity_v1"
    || !safeCount(record.privacyViolationCount)
    || typeof record.dataLossDetected !== "boolean"
    || !safeCount(record.duplicateDurableEffectCount)
    || !safeCount(record.recordIntegrityFailureCount)
  ) {
    return undefined;
  }
  return {
    schema: "harness_evaluation_integrity_v1",
    privacyViolationCount: record.privacyViolationCount,
    dataLossDetected: record.dataLossDetected,
    duplicateDurableEffectCount: record.duplicateDurableEffectCount,
    recordIntegrityFailureCount: record.recordIntegrityFailureCount,
  };
}

function readHCycle(value: unknown): HCycle | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, H_CYCLE_KEYS)
    || record.schema !== "h_cycle_evaluation_source_v1"
    || !isOneOf(FENCE_STATUSES, record.executionFence)
    || !isOneOf(FENCE_STATUSES, record.recordReconcileFence)
  ) {
    return undefined;
  }
  const policy = dataObject(record.policy);
  if (
    !policy
    || !hasExactKeys(policy, H_CYCLE_POLICY_KEYS)
    || policy.schema !== "h_cycle_evidence_policy_v1"
    || policy.policyVersion !== "h_cycle_evidence_v1"
    || !isOneOf(H_CYCLE_STATUSES, policy.status)
    || policy.requiredAdjacentWindows !== 2
    || !Array.isArray(policy.evaluatedWeekKeys)
    || policy.evaluatedWeekKeys.length > 2
    || !policy.evaluatedWeekKeys.every(validIsoWeek)
    || new Set(policy.evaluatedWeekKeys).size !== policy.evaluatedWeekKeys.length
  ) {
    return undefined;
  }
  if (
    (policy.status === "supported" || policy.status === "rejected" || policy.status === "inconclusive")
    && policy.evaluatedWeekKeys.length !== 2
  ) {
    return undefined;
  }

  // The upstream policy supplies pair-level status plus observed week coverage,
  // not a separately derived eligibility counter. Preserve that coverage while
  // keeping status distinct: two observed windows never turn an inconclusive
  // or baseline result into a healthy one in the report kernel.
  return {
    policyStatus: policy.status,
    eligibleWindowCount: policy.evaluatedWeekKeys.length,
    executionFence: record.executionFence,
    recordReconcileFence: record.recordReconcileFence,
  };
}

function readHEval(value: unknown): HEval | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, H_EVAL_KEYS)
    || record.schema !== "h_eval_policy_cohort_input_v1"
    || record.policyVersion !== "v1"
    || !isOneOf(H_EVAL_VERDICTS, record.verdict)
    || !isOneOf(H_EVAL_STAGES, record.decisionStage)
    || !isOneOf(H_EVAL_REASONS, record.reasonCode)
    || !validHEvalTuple(record.verdict, record.decisionStage, record.reasonCode)
  ) {
    return undefined;
  }
  return {
    verdict: record.verdict,
    decisionStage: record.decisionStage,
    reasonCode: record.reasonCode,
  };
}

/**
 * Reduces already-aggregate H-CYCLE, H-EVAL, and H-CACHE outputs into the
 * closed evidence envelope consumed by the report kernel. It deliberately
 * has no database, clock, scheduler, worker, LLM, or application authority.
 */
export function buildHarnessEvaluationEvidenceV1(value: unknown): HarnessEvaluationEvidenceBuildResultV1 {
  try {
    const cloned = cloneClosedInput(value);
    const record = dataObject(cloned);
    if (
      !record
      || !hasExactKeys(record, ROOT_KEYS)
      || record.schema !== "harness_evaluation_source_evidence_v1"
    ) {
      return failure();
    }
    const integrity = readIntegrity(record.integrity);
    const hCycle = readHCycle(record.hCycle);
    const hEval = readHEval(record.hEval);
    if (!integrity || !hCycle || !hEval) return failure();

    const evidence: HarnessEvaluationEvidenceV1 = {
      schema: "harness_evaluation_evidence_v1",
      integrity,
      hCycle: {
        schema: "h_cycle_evaluation_aggregate_v1",
        policyVersion: "h_cycle_evidence_v1",
        policyStatus: hCycle.policyStatus,
        eligibleWindowCount: hCycle.eligibleWindowCount,
        requiredAdjacentWindows: 2,
        executionFence: hCycle.executionFence,
        recordReconcileFence: hCycle.recordReconcileFence,
      },
      hEval: {
        schema: "h_eval_report_cohort_v1",
        policyVersion: "v1",
        verdict: hEval.verdict,
        decisionStage: hEval.decisionStage,
        reasonCode: hEval.reasonCode,
      },
      hCache: record.hCache,
    };
    if (!isHarnessEvaluationEvidenceV1(evidence)) return failure();
    return Object.freeze({
      schema: "harness_evaluation_evidence_build_result_v1" as const,
      mode: "manual_preview_only" as const,
      ok: true as const,
      code: "assembled" as const,
      automaticInterventionAllowed: false as const,
      evidence: deepFreeze(evidence),
    });
  } catch {
    return failure();
  }
}
