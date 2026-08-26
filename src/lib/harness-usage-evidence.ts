import {
  HARNESS_USAGE_SEMANTICS_VERSION,
  normalizeHarnessUsage,
  type HarnessUsageInput,
} from "./harness-usage-normalization";

export type HarnessUsageNormalizationStatus =
  | "supported"
  | "no_sample"
  | "invalid"
  | "unsupported";

export type HarnessUsageNormalizationReason =
  | "zero_total"
  | "non_finite_input"
  | "non_integer_input"
  | "unsafe_integer_input"
  | "negative_input"
  | "cache_read_exceeds_total"
  | "derived_total_overflow"
  | "unsupported_harness"
  | "unsupported_usage_semantics";

/**
 * Additive, server-derived storage projection for one raw HarnessRun row.
 *
 * The original counters remain the source of truth. A null cacheWriteTokens
 * value means that the provider did not expose a write counter; it must never
 * be treated as a zero write.
 */
export type HarnessUsageEvidence = Readonly<{
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageSemanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  usageNormalizationStatus: HarnessUsageNormalizationStatus;
  usageNormalizationReason: HarnessUsageNormalizationReason | null;
}>;

export type StoredHarnessUsageEvidence = Readonly<{
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageSemanticsVersion: string | null;
  usageNormalizationStatus: string | null;
}>;

export type SupportedStoredHarnessUsage = Readonly<{
  inputTotalTokens: number;
  inputUncachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
}>;

function safeNonNegativeInteger(value: number | null): value is number {
  return value !== null
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

/**
 * Reads only the server-derived evidence projection. Legacy/null, invalid,
 * unsupported, and semantically inconsistent rows are not measurement data.
 * Callers must keep them out of rate denominators instead of treating them as
 * zero or falling back to the provider-ambiguous raw counters.
 */
export function readSupportedStoredHarnessUsage(
  row: StoredHarnessUsageEvidence,
): SupportedStoredHarnessUsage | null {
  if (
    row.usageSemanticsVersion !== HARNESS_USAGE_SEMANTICS_VERSION
    || row.usageNormalizationStatus !== "supported"
    || !safeNonNegativeInteger(row.inputTotalTokens)
    || !safeNonNegativeInteger(row.inputUncachedTokens)
    || !safeNonNegativeInteger(row.cacheReadTokens)
    || (row.cacheWriteTokens !== null && !safeNonNegativeInteger(row.cacheWriteTokens))
    || row.inputTotalTokens === 0
    || row.cacheReadTokens > row.inputTotalTokens
  ) {
    return null;
  }

  const freshInput = row.inputTotalTokens - row.cacheReadTokens;
  const uncachedMatches = row.cacheWriteTokens === null
    ? row.inputUncachedTokens === freshInput
    : row.inputUncachedTokens <= freshInput
      && row.inputUncachedTokens + row.cacheWriteTokens === freshInput;
  if (!uncachedMatches) return null;

  return {
    inputTotalTokens: row.inputTotalTokens,
    inputUncachedTokens: row.inputUncachedTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  };
}

function unavailableEvidence(
  status: "invalid" | "unsupported",
  reason: HarnessUsageNormalizationReason,
): HarnessUsageEvidence {
  return {
    inputTotalTokens: null,
    inputUncachedTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    usageNormalizationStatus: status,
    usageNormalizationReason: reason,
  };
}

/**
 * Applies the single A1 semantics authority to raw counters and materializes
 * an evidence shape suitable for an additive HarnessRun column set.
 */
export function projectHarnessUsageEvidence(
  raw: HarnessUsageInput,
): HarnessUsageEvidence {
  const normalized = normalizeHarnessUsage(raw);
  switch (normalized.status) {
    case "supported":
      return {
        inputTotalTokens: normalized.totalInput,
        inputUncachedTokens: normalized.ordinaryNonReadInput,
        cacheReadTokens: normalized.cacheRead,
        cacheWriteTokens: normalized.cacheWrite,
        usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
        usageNormalizationStatus: "supported",
        usageNormalizationReason: null,
      };
    case "no_sample":
      return {
        inputTotalTokens: 0,
        inputUncachedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: normalized.provider === "anthropic" ? 0 : null,
        usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
        usageNormalizationStatus: "no_sample",
        usageNormalizationReason: normalized.reason,
      };
    case "invalid":
      return unavailableEvidence("invalid", normalized.reason);
    case "unsupported":
      return unavailableEvidence("unsupported", normalized.reason);
  }
}
