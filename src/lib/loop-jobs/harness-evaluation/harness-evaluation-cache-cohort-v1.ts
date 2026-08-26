import { createHash } from "node:crypto";

import { HARNESS_USAGE_SEMANTICS_VERSION } from "../../harness-usage-normalization";

const ROOT_KEYS = ["schema", "baseline", "intervention", "followup"] as const;
const OBSERVATION_INPUT_KEYS = ["schema", "cohort", "samples"] as const;
const COHORT_KEYS = [
  "harness",
  "model",
  "repo",
  "contextFingerprint",
  "usageSemanticsVersion",
  "collectorVersion",
] as const;
const SAMPLE_KEYS = [
  "schema",
  "usageSemanticsVersion",
  "usageNormalizationStatus",
  "inputTotalTokens",
  "inputUncachedTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "turns",
] as const;
const INTERVENTION_KEYS = [
  "schema",
  "interventionIdHash",
  "beforeContextFingerprint",
  "afterContextFingerprint",
] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTEXT_FINGERPRINT_PATTERN = /^sha256:([0-9a-f]{64})$/;
const MAX_SAMPLES = 10_000;
const MAX_RATE_NUMERATOR = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

type DataRecord = Record<string, unknown>;
type HCacheUnavailableReasonV1 =
  | "no_cache_samples"
  | "usage_unavailable"
  | "mixed_cohort"
  | "invalid_normalization";

export type HCacheEvaluationObservationV1 = Readonly<{
  cohortKeyHash: string;
  contextFingerprintHash: string;
  sampleCount: number;
  cacheReadRateBps: number;
  freshInputTokensPerTurn: number;
  cacheWriteTelemetry: "observed" | "unavailable";
}>;

export type HCacheEvaluationComparisonV1 =
  | Readonly<{
      schema: "h_cache_comparison_v1";
      status: "unavailable";
      reasonCode: HCacheUnavailableReasonV1;
    }>
  | Readonly<{
      schema: "h_cache_comparison_v1";
      status: "baseline_only";
      baseline: HCacheEvaluationObservationV1;
    }>
  | Readonly<{
      schema: "h_cache_comparison_v1";
      status: "intervention_pending";
      interventionIdHash: string;
    }>
  | Readonly<{
      schema: "h_cache_comparison_v1";
      status: "matched";
      interventionIdHash: string;
      before: HCacheEvaluationObservationV1;
      after: HCacheEvaluationObservationV1;
    }>;

export type HCacheEvaluationAggregateV1 = Readonly<{
  schema: "h_cache_evaluation_aggregate_v1";
  usageSemanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  comparison: HCacheEvaluationComparisonV1;
}>;

type Cohort = Readonly<{
  harness: "claude" | "codex";
  model: string;
  repo: string;
  contextFingerprintHash: string;
  collectorVersion: string;
}>;

type SupportedSample = Readonly<{
  inputTotalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
  turns: number;
}>;

type ObservationReadResult =
  | Readonly<{
      ok: true;
      observation: HCacheEvaluationObservationV1;
    }>
  | Readonly<{
      ok: false;
      reasonCode: HCacheUnavailableReasonV1;
    }>;

type Intervention = Readonly<{
  interventionIdHash: string;
  beforeContextFingerprintHash: string;
  afterContextFingerprintHash: string;
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

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function safeLabel(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && value.trim() === value;
}

function contextFingerprintHash(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return CONTEXT_FINGERPRINT_PATTERN.exec(value)?.[1];
}

function cloneClosedInput(value: unknown): unknown | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

function addChecked(total: number, addend: number): number | undefined {
  return addend > Number.MAX_SAFE_INTEGER - total ? undefined : total + addend;
}

function readCohort(value: unknown): Cohort | undefined {
  const record = dataObject(value);
  if (!record || !hasExactKeys(record, COHORT_KEYS)) return undefined;
  const fingerprintHash = contextFingerprintHash(record.contextFingerprint);
  if (
    (record.harness !== "claude" && record.harness !== "codex")
    || !safeLabel(record.model, 120)
    || !safeLabel(record.repo, 200)
    || fingerprintHash === undefined
    || record.usageSemanticsVersion !== HARNESS_USAGE_SEMANTICS_VERSION
    || !safeLabel(record.collectorVersion, 64)
  ) {
    return undefined;
  }
  return {
    harness: record.harness,
    model: record.model,
    repo: record.repo,
    contextFingerprintHash: fingerprintHash,
    collectorVersion: record.collectorVersion,
  };
}

function cohortKeyHash(cohort: Cohort): string {
  // Context fingerprint is deliberately omitted: an intervention is allowed
  // to change only that dimension, while every other cohort dimension stays
  // fixed and is then checked by the same opaque key.
  return createHash("sha256")
    .update(
      JSON.stringify([
        "h_cache_cohort_v1",
        cohort.harness,
        cohort.model,
        cohort.repo,
        HARNESS_USAGE_SEMANTICS_VERSION,
        cohort.collectorVersion,
      ]),
      "utf8",
    )
    .digest("hex");
}

function readSupportedSample(record: DataRecord): SupportedSample | undefined {
  if (
    !safeCount(record.inputTotalTokens)
    || !safeCount(record.inputUncachedTokens)
    || !safeCount(record.cacheReadTokens)
    || !safeCount(record.turns)
    || record.inputTotalTokens === 0
    || record.turns === 0
    || record.cacheReadTokens > record.inputTotalTokens
  ) {
    return undefined;
  }
  const write = record.cacheWriteTokens;
  if (write !== null && !safeCount(write)) return undefined;
  const freshInputTokens = record.inputTotalTokens - record.cacheReadTokens;
  if (write === null) {
    if (record.inputUncachedTokens !== freshInputTokens) return undefined;
  } else {
    if (write > freshInputTokens || record.inputUncachedTokens !== freshInputTokens - write) return undefined;
  }
  return {
    inputTotalTokens: record.inputTotalTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: write,
    turns: record.turns,
  };
}

function readNoSample(record: DataRecord): boolean {
  return record.inputTotalTokens === 0
    && record.inputUncachedTokens === 0
    && record.cacheReadTokens === 0
    && (record.cacheWriteTokens === null || record.cacheWriteTokens === 0)
    && safeCount(record.turns);
}

function readUnavailableSample(record: DataRecord): boolean {
  return record.inputTotalTokens === null
    && record.inputUncachedTokens === null
    && record.cacheReadTokens === null
    && record.cacheWriteTokens === null
    && safeCount(record.turns);
}

function unavailable(reasonCode: HCacheUnavailableReasonV1): HCacheEvaluationAggregateV1 {
  return deepFreeze({
    schema: "h_cache_evaluation_aggregate_v1" as const,
    usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    comparison: {
      schema: "h_cache_comparison_v1" as const,
      status: "unavailable" as const,
      reasonCode,
    },
  });
}

function aggregate(comparison: HCacheEvaluationComparisonV1): HCacheEvaluationAggregateV1 {
  return deepFreeze({
    schema: "h_cache_evaluation_aggregate_v1" as const,
    usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    comparison,
  });
}

function readObservation(value: unknown): ObservationReadResult {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, OBSERVATION_INPUT_KEYS)
    || record.schema !== "h_cache_cohort_observation_input_v1"
    || !Array.isArray(record.samples)
    || record.samples.length > MAX_SAMPLES
  ) {
    return { ok: false, reasonCode: "invalid_normalization" };
  }
  const cohort = readCohort(record.cohort);
  if (!cohort) return { ok: false, reasonCode: "invalid_normalization" };

  let totalInput = 0;
  let totalCacheRead = 0;
  let totalFreshInput = 0;
  let totalTurns = 0;
  let sampleCount = 0;
  let cacheWriteObserved = true;
  for (const sampleValue of record.samples) {
    const sample = dataObject(sampleValue);
    if (
      !sample
      || !hasExactKeys(sample, SAMPLE_KEYS)
      || sample.schema !== "h_cache_usage_sample_v1"
    ) {
      return { ok: false, reasonCode: "invalid_normalization" };
    }
    if (sample.usageSemanticsVersion !== HARNESS_USAGE_SEMANTICS_VERSION) {
      return { ok: false, reasonCode: "usage_unavailable" };
    }
    if (sample.usageNormalizationStatus === "unsupported") {
      return readUnavailableSample(sample)
        ? { ok: false, reasonCode: "usage_unavailable" }
        : { ok: false, reasonCode: "invalid_normalization" };
    }
    if (sample.usageNormalizationStatus === "invalid") {
      return { ok: false, reasonCode: "invalid_normalization" };
    }
    if (sample.usageNormalizationStatus === "no_sample") {
      if (!readNoSample(sample)) return { ok: false, reasonCode: "invalid_normalization" };
      continue;
    }
    if (sample.usageNormalizationStatus !== "supported") {
      return { ok: false, reasonCode: "invalid_normalization" };
    }
    const supported = readSupportedSample(sample);
    if (!supported) return { ok: false, reasonCode: "invalid_normalization" };

    const nextTotalInput = addChecked(totalInput, supported.inputTotalTokens);
    const nextTotalRead = addChecked(totalCacheRead, supported.cacheReadTokens);
    const nextFresh = addChecked(totalFreshInput, supported.inputTotalTokens - supported.cacheReadTokens);
    const nextTurns = addChecked(totalTurns, supported.turns);
    if (
      nextTotalInput === undefined
      || nextTotalRead === undefined
      || nextFresh === undefined
      || nextTurns === undefined
    ) {
      return { ok: false, reasonCode: "invalid_normalization" };
    }
    totalInput = nextTotalInput;
    totalCacheRead = nextTotalRead;
    totalFreshInput = nextFresh;
    totalTurns = nextTurns;
    sampleCount += 1;
    if (supported.cacheWriteTokens === null) cacheWriteObserved = false;
  }

  if (sampleCount === 0) return { ok: false, reasonCode: "no_cache_samples" };
  if (totalInput === 0 || totalTurns === 0 || totalInput > MAX_RATE_NUMERATOR) {
    return { ok: false, reasonCode: "invalid_normalization" };
  }
  return {
    ok: true,
    observation: deepFreeze({
      cohortKeyHash: cohortKeyHash(cohort),
      contextFingerprintHash: cohort.contextFingerprintHash,
      sampleCount,
      cacheReadRateBps: Math.floor((totalCacheRead * 10_000) / totalInput),
      freshInputTokensPerTurn: Math.floor(totalFreshInput / totalTurns),
      cacheWriteTelemetry: cacheWriteObserved ? "observed" as const : "unavailable" as const,
    }),
  };
}

function readIntervention(value: unknown): Intervention | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, INTERVENTION_KEYS)
    || record.schema !== "h_cache_stable_prefix_intervention_v1"
    || typeof record.interventionIdHash !== "string"
    || !HASH_PATTERN.test(record.interventionIdHash)
  ) {
    return undefined;
  }
  const beforeContextFingerprintHash = contextFingerprintHash(record.beforeContextFingerprint);
  const afterContextFingerprintHash = contextFingerprintHash(record.afterContextFingerprint);
  if (
    beforeContextFingerprintHash === undefined
    || afterContextFingerprintHash === undefined
    || beforeContextFingerprintHash === afterContextFingerprintHash
  ) {
    return undefined;
  }
  return {
    interventionIdHash: record.interventionIdHash,
    beforeContextFingerprintHash,
    afterContextFingerprintHash,
  };
}

/**
 * Builds only the H-CACHE child accepted by the integrated report. It hashes
 * cohort labels, rejects mixed or unavailable usage, and treats an explicit
 * stable-prefix intervention as a prerequisite for before/after comparison.
 * This pure boundary neither queries nor writes a database.
 */
export function buildHCacheEvaluationAggregateV1(value: unknown): HCacheEvaluationAggregateV1 {
  try {
    const cloned = cloneClosedInput(value);
    const record = dataObject(cloned);
    if (
      !record
      || !hasExactKeys(record, ROOT_KEYS)
      || record.schema !== "h_cache_evaluation_request_v1"
    ) {
      return unavailable("invalid_normalization");
    }

    if (record.baseline === null) {
      return record.intervention === null && record.followup === null
        ? unavailable("no_cache_samples")
        : unavailable("invalid_normalization");
    }

    const baseline = readObservation(record.baseline);
    if (!baseline.ok) return unavailable(baseline.reasonCode);
    if (record.intervention === null) {
      return record.followup === null
        ? aggregate({
            schema: "h_cache_comparison_v1" as const,
            status: "baseline_only" as const,
            baseline: baseline.observation,
          })
        : unavailable("mixed_cohort");
    }

    const intervention = readIntervention(record.intervention);
    if (!intervention) return unavailable("invalid_normalization");
    if (baseline.observation.contextFingerprintHash !== intervention.beforeContextFingerprintHash) {
      return unavailable("mixed_cohort");
    }
    if (record.followup === null) {
      return aggregate({
        schema: "h_cache_comparison_v1" as const,
        status: "intervention_pending" as const,
        interventionIdHash: intervention.interventionIdHash,
      });
    }

    const followup = readObservation(record.followup);
    if (!followup.ok) return unavailable(followup.reasonCode);
    if (
      baseline.observation.cohortKeyHash !== followup.observation.cohortKeyHash
      || followup.observation.contextFingerprintHash !== intervention.afterContextFingerprintHash
    ) {
      return unavailable("mixed_cohort");
    }
    return aggregate({
      schema: "h_cache_comparison_v1" as const,
      status: "matched" as const,
      interventionIdHash: intervention.interventionIdHash,
      before: baseline.observation,
      after: followup.observation,
    });
  } catch {
    return unavailable("invalid_normalization");
  }
}
