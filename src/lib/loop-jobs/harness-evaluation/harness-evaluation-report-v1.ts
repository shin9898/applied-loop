/**
 * Aggregate-only, deterministic harness evaluation for manual preview.
 *
 * This module deliberately has no database, clock, scheduler, worker, LLM, or
 * process boundary. Callers must reduce source-specific evidence before it is
 * supplied here. The report never carries prompts, answers, paths, URLs, or
 * row-level usage.
 */

const ROOT_KEYS = ["schema", "integrity", "hCycle", "hEval", "hCache"] as const;
const INTEGRITY_KEYS = [
  "schema",
  "privacyViolationCount",
  "dataLossDetected",
  "duplicateDurableEffectCount",
  "recordIntegrityFailureCount",
] as const;
const H_CYCLE_KEYS = [
  "schema",
  "policyVersion",
  "policyStatus",
  "eligibleWindowCount",
  "requiredAdjacentWindows",
  "executionFence",
  "recordReconcileFence",
] as const;
const H_EVAL_KEYS = [
  "schema",
  "policyVersion",
  "verdict",
  "decisionStage",
  "reasonCode",
] as const;
const H_CACHE_KEYS = ["schema", "usageSemanticsVersion", "comparison"] as const;
const CACHE_UNAVAILABLE_KEYS = ["schema", "status", "reasonCode"] as const;
const CACHE_BASELINE_KEYS = ["schema", "status", "baseline"] as const;
const CACHE_PENDING_KEYS = ["schema", "status", "interventionIdHash"] as const;
const CACHE_MATCHED_KEYS = [
  "schema",
  "status",
  "interventionIdHash",
  "before",
  "after",
] as const;
const CACHE_OBSERVATION_KEYS = [
  "cohortKeyHash",
  "contextFingerprintHash",
  "sampleCount",
  "cacheReadRateBps",
  "freshInputTokensPerTurn",
  "cacheWriteTelemetry",
] as const;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const H_CYCLE_POLICY_VERSION = "h_cycle_evidence_v1";
const H_EVAL_POLICY_VERSION = "v1";
const USAGE_SEMANTICS_VERSION = "harness-usage-v1";
const MIN_MATCHED_CACHE_SAMPLES = 7;
const MAX_PROPOSALS = 3;

const H_CYCLE_STATUSES = [
  "baseline_collecting",
  "inconclusive",
  "supported",
  "rejected",
] as const;
const H_CYCLE_FENCES = ["complete", "pending", "invalid"] as const;
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
const CACHE_UNAVAILABLE_REASONS = [
  "no_cache_samples",
  "usage_unavailable",
  "mixed_cohort",
  "invalid_normalization",
] as const;
const CACHE_COMPARISON_STATUSES = [
  "unavailable",
  "baseline_only",
  "intervention_pending",
  "matched",
] as const;
const CACHE_WRITE_TELEMETRY = ["observed", "unavailable"] as const;

type DataRecord = Record<string, unknown>;
type HCycleStatus = (typeof H_CYCLE_STATUSES)[number];
type HEvalVerdict = (typeof H_EVAL_VERDICTS)[number];
type HEvalStage = (typeof H_EVAL_STAGES)[number];
type HEvalReason = (typeof H_EVAL_REASONS)[number];
type CacheUnavailableReason = (typeof CACHE_UNAVAILABLE_REASONS)[number];
type CacheWriteTelemetry = (typeof CACHE_WRITE_TELEMETRY)[number];

export type HarnessEvaluationVerdictV1 =
  | "healthy"
  | "needs_attention"
  | "insufficient_evidence";

export type HarnessEvaluationProposalKindV1 =
  | "pause_and_investigate"
  | "complete_h_cycle_execution_fence"
  | "collect_h_cycle_observation"
  | "collect_cache_baseline"
  | "review_stable_prefix"
  | "record_and_reobserve"
  | "continue_observation";

type ProposalReasonCode =
  | "invalid_aggregate"
  | "privacy_violation"
  | "data_loss"
  | "duplicate_durable_effect"
  | "record_integrity_failure"
  | "h_cycle_rejected"
  | "h_eval_rejected"
  | "execution_fence_pending"
  | "execution_fence_invalid"
  | "record_reconcile_pending"
  | "h_cycle_baseline_missing"
  | "h_cycle_inconclusive"
  | "cache_unavailable"
  | "cache_baseline_only"
  | "cache_sample_insufficient"
  | "cache_guardrail_regressed"
  | "intervention_window_pending"
  | "provisional_or_inconclusive";

export type HarnessEvaluationProposalV1 = Readonly<{
  kind: HarnessEvaluationProposalKindV1;
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  reasonCode: ProposalReasonCode;
}>;

type CohortVerdict = HarnessEvaluationVerdictV1;

export type HarnessEvaluationReportV1 = Readonly<{
  schema: "harness_evaluation_report_v1";
  mode: "manual_preview_only";
  automaticInterventionAllowed: false;
  verdict: HarnessEvaluationVerdictV1;
  integrity: Readonly<{
    stopCondition:
      | "none"
      | "privacy_violation"
      | "data_loss"
      | "duplicate_durable_effect"
      | "record_integrity_failure";
  }>;
  cohorts: Readonly<{
    hCycle: Readonly<{
      policyVersion: typeof H_CYCLE_POLICY_VERSION;
      verdict: CohortVerdict;
      reasonCode:
        | "supported"
        | "rejected"
        | "baseline_collecting"
        | "inconclusive"
        | "execution_fence_pending"
        | "execution_fence_invalid"
        | "record_reconcile_pending"
        | "invalid_aggregate";
      eligibleWindowCount: number | null;
      requiredAdjacentWindows: number | null;
    }>;
    hEval: Readonly<{
      policyVersion: typeof H_EVAL_POLICY_VERSION;
      verdict: CohortVerdict;
      reasonCode: HEvalReason | "invalid_aggregate";
      decisionStage: HEvalStage | null;
    }>;
    hCache: Readonly<{
      usageSemanticsVersion: typeof USAGE_SEMANTICS_VERSION;
      verdict: CohortVerdict;
      reasonCode:
        | CacheUnavailableReason
        | "baseline_only"
        | "intervention_pending"
        | "sample_insufficient"
        | "guardrail_regressed"
        | "no_observed_improvement"
        | "within_guardrail"
        | "invalid_aggregate";
      metrics: Readonly<{
        beforeSampleCount: number | null;
        afterSampleCount: number | null;
        cacheReadRateDeltaBps: number | null;
        freshInputPerTurnDeltaBps: number | null;
        cacheWriteTelemetry: CacheWriteTelemetry | null;
      }>;
    }>;
  }>;
  proposals: readonly HarnessEvaluationProposalV1[];
}>;

type Integrity = Readonly<{
  privacyViolationCount: number;
  dataLossDetected: boolean;
  duplicateDurableEffectCount: number;
  recordIntegrityFailureCount: number;
}>;

type HCycle = Readonly<{
  policyStatus: HCycleStatus;
  eligibleWindowCount: number;
  requiredAdjacentWindows: number;
  executionFence: "complete" | "pending" | "invalid";
  recordReconcileFence: "complete" | "pending" | "invalid";
}>;

type HEval = Readonly<{
  verdict: HEvalVerdict;
  decisionStage: HEvalStage;
  reasonCode: HEvalReason;
}>;

type CacheObservation = Readonly<{
  cohortKeyHash: string;
  contextFingerprintHash: string;
  sampleCount: number;
  cacheReadRateBps: number;
  freshInputTokensPerTurn: number;
  cacheWriteTelemetry: CacheWriteTelemetry;
}>;

type CacheComparison =
  | Readonly<{ status: "unavailable"; reasonCode: CacheUnavailableReason }>
  | Readonly<{ status: "baseline_only"; baseline: CacheObservation }>
  | Readonly<{ status: "intervention_pending"; interventionIdHash: string }>
  | Readonly<{
      status: "matched";
      interventionIdHash: string;
      before: CacheObservation;
      after: CacheObservation;
    }>;

type Input = Readonly<{
  integrity: Integrity;
  hCycle: HCycle;
  hEval: HEval;
  hCache: Readonly<{ comparison: CacheComparison }>;
}>;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function safeBps(value: unknown): value is number {
  return safeCount(value) && value <= 10_000;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function hasExactKeys(record: DataRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function readDataObject(value: unknown): DataRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const record = Object.create(null) as DataRecord;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    record[key] = descriptor.value;
  }
  return record;
}

/**
 * A transparent Proxy is otherwise indistinguishable from a data object by
 * reflection. structuredClone rejects Proxy values, while preserving plain
 * JSON-shaped aggregate evidence. It also prevents caller-owned object graphs
 * from being retained by the output.
 */
function cloneClosedInput(value: unknown): unknown | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

function validateIntegrity(value: unknown): Integrity | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, INTEGRITY_KEYS) || record.schema !== "harness_evaluation_integrity_v1") {
    return undefined;
  }
  if (
    !safeCount(record.privacyViolationCount)
    || typeof record.dataLossDetected !== "boolean"
    || !safeCount(record.duplicateDurableEffectCount)
    || !safeCount(record.recordIntegrityFailureCount)
  ) {
    return undefined;
  }
  return {
    privacyViolationCount: record.privacyViolationCount,
    dataLossDetected: record.dataLossDetected,
    duplicateDurableEffectCount: record.duplicateDurableEffectCount,
    recordIntegrityFailureCount: record.recordIntegrityFailureCount,
  };
}

function validateHCycle(value: unknown): HCycle | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, H_CYCLE_KEYS) || record.schema !== "h_cycle_evaluation_aggregate_v1") {
    return undefined;
  }
  if (
    record.policyVersion !== H_CYCLE_POLICY_VERSION
    || !isOneOf(H_CYCLE_STATUSES, record.policyStatus)
    || !safeCount(record.eligibleWindowCount)
    || !safeCount(record.requiredAdjacentWindows)
    || record.requiredAdjacentWindows === 0
    || !isOneOf(H_CYCLE_FENCES, record.executionFence)
    || !isOneOf(H_CYCLE_FENCES, record.recordReconcileFence)
  ) {
    return undefined;
  }
  return {
    policyStatus: record.policyStatus,
    eligibleWindowCount: record.eligibleWindowCount,
    requiredAdjacentWindows: record.requiredAdjacentWindows,
    executionFence: record.executionFence,
    recordReconcileFence: record.recordReconcileFence,
  };
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

function validateHEval(value: unknown): HEval | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, H_EVAL_KEYS) || record.schema !== "h_eval_report_cohort_v1") {
    return undefined;
  }
  if (
    record.policyVersion !== H_EVAL_POLICY_VERSION
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

function validateCacheObservation(value: unknown): CacheObservation | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, CACHE_OBSERVATION_KEYS)) return undefined;
  if (
    !isHash(record.cohortKeyHash)
    || !isHash(record.contextFingerprintHash)
    || !safeCount(record.sampleCount)
    || !safeBps(record.cacheReadRateBps)
    || !safeCount(record.freshInputTokensPerTurn)
    || !isOneOf(CACHE_WRITE_TELEMETRY, record.cacheWriteTelemetry)
  ) {
    return undefined;
  }
  return {
    cohortKeyHash: record.cohortKeyHash,
    contextFingerprintHash: record.contextFingerprintHash,
    sampleCount: record.sampleCount,
    cacheReadRateBps: record.cacheReadRateBps,
    freshInputTokensPerTurn: record.freshInputTokensPerTurn,
    cacheWriteTelemetry: record.cacheWriteTelemetry,
  };
}

function validateCacheComparison(value: unknown): CacheComparison | undefined {
  const record = readDataObject(value);
  if (!record || !isOneOf(CACHE_COMPARISON_STATUSES, record.status)) return undefined;
  if (record.status === "unavailable") {
    if (!hasExactKeys(record, CACHE_UNAVAILABLE_KEYS) || record.schema !== "h_cache_comparison_v1" || !isOneOf(CACHE_UNAVAILABLE_REASONS, record.reasonCode)) {
      return undefined;
    }
    return { status: "unavailable", reasonCode: record.reasonCode };
  }
  if (record.status === "baseline_only") {
    const baseline = validateCacheObservation(record.baseline);
    if (!hasExactKeys(record, CACHE_BASELINE_KEYS) || record.schema !== "h_cache_comparison_v1" || !baseline) {
      return undefined;
    }
    return { status: "baseline_only", baseline };
  }
  if (record.status === "intervention_pending") {
    if (!hasExactKeys(record, CACHE_PENDING_KEYS) || record.schema !== "h_cache_comparison_v1" || !isHash(record.interventionIdHash)) {
      return undefined;
    }
    return { status: "intervention_pending", interventionIdHash: record.interventionIdHash };
  }
  const before = validateCacheObservation(record.before);
  const after = validateCacheObservation(record.after);
  if (
    !hasExactKeys(record, CACHE_MATCHED_KEYS)
    || record.schema !== "h_cache_comparison_v1"
    || !isHash(record.interventionIdHash)
    || !before
    || !after
    || before.cohortKeyHash !== after.cohortKeyHash
    || before.contextFingerprintHash === after.contextFingerprintHash
  ) {
    return undefined;
  }
  return {
    status: "matched",
    interventionIdHash: record.interventionIdHash,
    before,
    after,
  };
}

function validateInput(value: unknown): Input | undefined {
  const clone = cloneClosedInput(value);
  const record = readDataObject(clone);
  if (!record || !hasExactKeys(record, ROOT_KEYS) || record.schema !== "harness_evaluation_evidence_v1") {
    return undefined;
  }
  const integrity = validateIntegrity(record.integrity);
  const hCycle = validateHCycle(record.hCycle);
  const hEval = validateHEval(record.hEval);
  const hCacheRecord = readDataObject(record.hCache);
  if (
    !integrity
    || !hCycle
    || !hEval
    || !hCacheRecord
    || !hasExactKeys(hCacheRecord, H_CACHE_KEYS)
    || hCacheRecord.schema !== "h_cache_evaluation_aggregate_v1"
    || hCacheRecord.usageSemanticsVersion !== USAGE_SEMANTICS_VERSION
  ) {
    return undefined;
  }
  const comparison = validateCacheComparison(hCacheRecord.comparison);
  return comparison ? { integrity, hCycle, hEval, hCache: { comparison } } : undefined;
}

/**
 * Returns whether a value is a closed, aggregate-only report input. This is
 * intentionally a boolean boundary: callers can reject bad manual input
 * without reflecting any of it back to stdout, logs, or a durable record.
 */
export function isHarnessEvaluationEvidenceV1(value: unknown): boolean {
  try {
    return validateInput(value) !== undefined;
  } catch {
    return false;
  }
}

function proposalPriority(kind: HarnessEvaluationProposalKindV1): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  switch (kind) {
    case "pause_and_investigate": return 1;
    case "complete_h_cycle_execution_fence": return 2;
    case "collect_h_cycle_observation": return 3;
    case "collect_cache_baseline": return 4;
    case "review_stable_prefix": return 5;
    case "record_and_reobserve": return 6;
    case "continue_observation": return 7;
  }
}

function buildProposals(
  candidates: readonly Readonly<{ kind: HarnessEvaluationProposalKindV1; reasonCode: ProposalReasonCode }>[],
): readonly HarnessEvaluationProposalV1[] {
  const firstByKind = new Map<HarnessEvaluationProposalKindV1, ProposalReasonCode>();
  for (const candidate of candidates) {
    if (!firstByKind.has(candidate.kind)) firstByKind.set(candidate.kind, candidate.reasonCode);
  }
  return deepFreeze(
    [...firstByKind.entries()]
      .map(([kind, reasonCode]) => ({ kind, priority: proposalPriority(kind), reasonCode }))
      .sort((left, right) => left.priority - right.priority || left.kind.localeCompare(right.kind))
      .slice(0, MAX_PROPOSALS),
  );
}

function stopCondition(integrity: Integrity): HarnessEvaluationReportV1["integrity"]["stopCondition"] {
  if (integrity.privacyViolationCount > 0) return "privacy_violation";
  if (integrity.dataLossDetected) return "data_loss";
  if (integrity.duplicateDurableEffectCount > 0) return "duplicate_durable_effect";
  if (integrity.recordIntegrityFailureCount > 0) return "record_integrity_failure";
  return "none";
}

function hCycleCohort(hCycle: HCycle): HarnessEvaluationReportV1["cohorts"]["hCycle"] {
  if (hCycle.executionFence === "invalid") {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "needs_attention", reasonCode: "execution_fence_invalid", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  if (hCycle.executionFence === "pending") {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "needs_attention", reasonCode: "execution_fence_pending", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  if (hCycle.recordReconcileFence !== "complete") {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "needs_attention", reasonCode: "record_reconcile_pending", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  if (hCycle.policyStatus === "rejected") {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "needs_attention", reasonCode: "rejected", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  if (hCycle.policyStatus === "baseline_collecting" || hCycle.eligibleWindowCount < hCycle.requiredAdjacentWindows) {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "insufficient_evidence", reasonCode: "baseline_collecting", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  if (hCycle.policyStatus === "inconclusive") {
    return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "insufficient_evidence", reasonCode: "inconclusive", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
  }
  return { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "healthy", reasonCode: "supported", eligibleWindowCount: hCycle.eligibleWindowCount, requiredAdjacentWindows: hCycle.requiredAdjacentWindows };
}

function hEvalCohort(hEval: HEval): HarnessEvaluationReportV1["cohorts"]["hEval"] {
  if (hEval.verdict === "rejected") {
    return { policyVersion: H_EVAL_POLICY_VERSION, verdict: "needs_attention", reasonCode: hEval.reasonCode, decisionStage: hEval.decisionStage };
  }
  if (hEval.verdict === "inconclusive" || hEval.decisionStage === "provisional") {
    return { policyVersion: H_EVAL_POLICY_VERSION, verdict: "insufficient_evidence", reasonCode: hEval.reasonCode, decisionStage: hEval.decisionStage };
  }
  return { policyVersion: H_EVAL_POLICY_VERSION, verdict: "healthy", reasonCode: hEval.reasonCode, decisionStage: hEval.decisionStage };
}

function cacheMetrics(
  before: CacheObservation | null,
  after: CacheObservation | null,
): HarnessEvaluationReportV1["cohorts"]["hCache"]["metrics"] {
  const freshInputPerTurnDeltaBps = before === null || after === null || before.freshInputTokensPerTurn === 0
    ? null
    : Math.trunc(((after.freshInputTokensPerTurn - before.freshInputTokensPerTurn) * 10_000) / before.freshInputTokensPerTurn);
  return {
    beforeSampleCount: before?.sampleCount ?? null,
    afterSampleCount: after?.sampleCount ?? null,
    cacheReadRateDeltaBps: before === null || after === null ? null : after.cacheReadRateBps - before.cacheReadRateBps,
    freshInputPerTurnDeltaBps,
    cacheWriteTelemetry: before === null || after === null || before.cacheWriteTelemetry !== after.cacheWriteTelemetry
      ? null
      : before.cacheWriteTelemetry,
  };
}

function hCacheCohort(comparison: CacheComparison): HarnessEvaluationReportV1["cohorts"]["hCache"] {
  if (comparison.status === "unavailable") {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence", reasonCode: comparison.reasonCode, metrics: cacheMetrics(null, null) };
  }
  if (comparison.status === "baseline_only") {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence", reasonCode: "baseline_only", metrics: cacheMetrics(comparison.baseline, null) };
  }
  if (comparison.status === "intervention_pending") {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence", reasonCode: "intervention_pending", metrics: cacheMetrics(null, null) };
  }

  const { before, after } = comparison;
  const metrics = cacheMetrics(before, after);
  if (before.sampleCount < MIN_MATCHED_CACHE_SAMPLES || after.sampleCount < MIN_MATCHED_CACHE_SAMPLES) {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence", reasonCode: "sample_insufficient", metrics };
  }

  const cacheRateDelta = after.cacheReadRateBps - before.cacheReadRateBps;
  const freshInputWorsened = before.freshInputTokensPerTurn === 0
    ? after.freshInputTokensPerTurn > 0
    : after.freshInputTokensPerTurn * 100 > before.freshInputTokensPerTurn * 105;
  const freshInputImproved = before.freshInputTokensPerTurn > 0
    && after.freshInputTokensPerTurn * 100 <= before.freshInputTokensPerTurn * 90;
  const highReuseBaseline = before.cacheReadRateBps >= 9_000;
  const guardrailRegression = highReuseBaseline
    ? cacheRateDelta < -100 || freshInputWorsened
    : cacheRateDelta < 0 || freshInputWorsened;
  if (guardrailRegression) {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "needs_attention", reasonCode: "guardrail_regressed", metrics };
  }
  const supported = highReuseBaseline
    ? cacheRateDelta >= -100 && !freshInputWorsened
    : cacheRateDelta >= 500 || freshInputImproved;
  if (!supported) {
    return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence", reasonCode: "no_observed_improvement", metrics };
  }
  return { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "healthy", reasonCode: "within_guardrail", metrics };
}

function overallVerdict(cohorts: readonly CohortVerdict[]): HarnessEvaluationVerdictV1 {
  if (cohorts.includes("needs_attention")) return "needs_attention";
  if (cohorts.includes("insufficient_evidence")) return "insufficient_evidence";
  return "healthy";
}

function invalidReport(): HarnessEvaluationReportV1 {
  return deepFreeze({
    schema: "harness_evaluation_report_v1" as const,
    mode: "manual_preview_only" as const,
    automaticInterventionAllowed: false as const,
    verdict: "insufficient_evidence" as const,
    integrity: { stopCondition: "none" as const },
    cohorts: {
      hCycle: { policyVersion: H_CYCLE_POLICY_VERSION, verdict: "insufficient_evidence" as const, reasonCode: "invalid_aggregate" as const, eligibleWindowCount: null, requiredAdjacentWindows: null },
      hEval: { policyVersion: H_EVAL_POLICY_VERSION, verdict: "insufficient_evidence" as const, reasonCode: "invalid_aggregate" as const, decisionStage: null },
      hCache: { usageSemanticsVersion: USAGE_SEMANTICS_VERSION, verdict: "insufficient_evidence" as const, reasonCode: "invalid_aggregate" as const, metrics: cacheMetrics(null, null) },
    },
    proposals: buildProposals([{ kind: "pause_and_investigate", reasonCode: "invalid_aggregate" }]),
  });
}

/**
 * Evaluates already-reduced cohorts. It is intentionally manual-preview only:
 * no proposal has authority to enable, apply, schedule, write, or invoke an
 * LLM. Invalid, mixed, or incomplete evidence remains explicit.
 */
export function buildHarnessEvaluationReportV1(value: unknown): HarnessEvaluationReportV1 {
  try {
    const input = validateInput(value);
    if (!input) return invalidReport();

    const hCycle = hCycleCohort(input.hCycle);
    const hEval = hEvalCohort(input.hEval);
    const hCache = hCacheCohort(input.hCache.comparison);
    const stop = stopCondition(input.integrity);
    const candidates: Array<Readonly<{ kind: HarnessEvaluationProposalKindV1; reasonCode: ProposalReasonCode }>> = [];

    if (stop !== "none") candidates.push({ kind: "pause_and_investigate", reasonCode: stop });
    if (hCycle.reasonCode === "rejected") candidates.push({ kind: "pause_and_investigate", reasonCode: "h_cycle_rejected" });
    if (hEval.verdict === "needs_attention") candidates.push({ kind: "pause_and_investigate", reasonCode: "h_eval_rejected" });
    if (hCycle.reasonCode === "execution_fence_pending") candidates.push({ kind: "complete_h_cycle_execution_fence", reasonCode: "execution_fence_pending" });
    if (hCycle.reasonCode === "execution_fence_invalid") candidates.push({ kind: "complete_h_cycle_execution_fence", reasonCode: "execution_fence_invalid" });
    if (hCycle.reasonCode === "record_reconcile_pending") candidates.push({ kind: "complete_h_cycle_execution_fence", reasonCode: "record_reconcile_pending" });
    if (input.hCycle.policyStatus === "baseline_collecting" || input.hCycle.eligibleWindowCount < input.hCycle.requiredAdjacentWindows) {
      candidates.push({ kind: "collect_h_cycle_observation", reasonCode: "h_cycle_baseline_missing" });
    }
    if (input.hCycle.policyStatus === "inconclusive") candidates.push({ kind: "collect_h_cycle_observation", reasonCode: "h_cycle_inconclusive" });
    if (hCache.reasonCode === "no_cache_samples" || hCache.reasonCode === "usage_unavailable" || hCache.reasonCode === "mixed_cohort" || hCache.reasonCode === "invalid_normalization") candidates.push({ kind: "collect_cache_baseline", reasonCode: "cache_unavailable" });
    if (hCache.reasonCode === "baseline_only" || hCache.reasonCode === "sample_insufficient") candidates.push({ kind: "collect_cache_baseline", reasonCode: hCache.reasonCode === "baseline_only" ? "cache_baseline_only" : "cache_sample_insufficient" });
    if (hCache.reasonCode === "guardrail_regressed") candidates.push({ kind: "review_stable_prefix", reasonCode: "cache_guardrail_regressed" });
    if (hCache.reasonCode === "intervention_pending") candidates.push({ kind: "record_and_reobserve", reasonCode: "intervention_window_pending" });
    if (hEval.verdict === "insufficient_evidence" || hCache.reasonCode === "no_observed_improvement") candidates.push({ kind: "continue_observation", reasonCode: "provisional_or_inconclusive" });

    return deepFreeze({
      schema: "harness_evaluation_report_v1" as const,
      mode: "manual_preview_only" as const,
      automaticInterventionAllowed: false as const,
      verdict: overallVerdict([hCycle.verdict, hEval.verdict, hCache.verdict]),
      integrity: { stopCondition: stop },
      cohorts: { hCycle, hEval, hCache },
      proposals: buildProposals(candidates),
    });
  } catch {
    return invalidReport();
  }
}
