export const HARNESS_USAGE_SEMANTICS_VERSION = "harness-usage-v1" as const;

export type HarnessUsageInput = Readonly<{
  harness: string;
  tokensIn: number;
  cacheRead: number;
  cacheCreate: number;
}>;

type Provider = "anthropic" | "openai";
type CounterField = "tokensIn" | "cacheRead" | "cacheCreate";
type InvalidReason =
  | "non_finite_input"
  | "non_integer_input"
  | "unsafe_integer_input"
  | "negative_input"
  | "cache_read_exceeds_total"
  | "derived_total_overflow";

export type SupportedHarnessUsage = {
  status: "supported";
  semanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  provider: Provider;
  totalInput: number;
  ordinaryNonReadInput: number;
  cacheRead: number;
  cacheWrite: number | null;
  cacheReuseRate: number;
  freshInput: number;
  freshInputRate: number;
};

export type NoSampleHarnessUsage = {
  status: "no_sample";
  reason: "zero_total";
  semanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  provider: Provider;
  raw: HarnessUsageInput;
};

export type InvalidHarnessUsage = {
  status: "invalid";
  reason: InvalidReason;
  field?: CounterField;
  raw: HarnessUsageInput;
};

export type UnsupportedHarnessUsage = {
  status: "unsupported";
  reason: "unsupported_harness" | "unsupported_usage_semantics";
  raw: HarnessUsageInput;
};

export type HarnessUsageNormalizationResult =
  | SupportedHarnessUsage
  | NoSampleHarnessUsage
  | InvalidHarnessUsage
  | UnsupportedHarnessUsage;

function noSample(
  raw: HarnessUsageInput,
  provider: Provider,
): NoSampleHarnessUsage {
  return {
    status: "no_sample",
    reason: "zero_total",
    semanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    provider,
    raw,
  };
}

function snapshotInput(input: HarnessUsageInput): HarnessUsageInput {
  return {
    harness: input.harness,
    tokensIn: input.tokensIn,
    cacheRead: input.cacheRead,
    cacheCreate: input.cacheCreate,
  };
}

function invalid(
  raw: HarnessUsageInput,
  reason: InvalidReason,
  field?: CounterField,
): InvalidHarnessUsage {
  return {
    status: "invalid",
    reason,
    ...(field === undefined ? {} : { field }),
    raw,
  };
}

function validateCounter(value: number): InvalidReason | null {
  if (!Number.isFinite(value)) return "non_finite_input";
  if (!Number.isInteger(value)) return "non_integer_input";
  if (!Number.isSafeInteger(value)) return "unsafe_integer_input";
  if (value < 0) return "negative_input";
  return null;
}

function checkedAdd(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

export function normalizeHarnessUsage(
  input: HarnessUsageInput,
): HarnessUsageNormalizationResult {
  const raw = snapshotInput(input);
  const fields: readonly CounterField[] = [
    "tokensIn",
    "cacheRead",
    "cacheCreate",
  ];
  for (const field of fields) {
    const reason = validateCounter(input[field]);
    if (reason !== null) return invalid(raw, reason, field);
  }

  if (input.harness !== "claude" && input.harness !== "codex") {
    return {
      status: "unsupported",
      reason: "unsupported_harness",
      raw,
    };
  }

  if (input.harness === "claude") {
    const inputAndRead = checkedAdd(input.tokensIn, input.cacheRead);
    if (inputAndRead === null) {
      return invalid(raw, "derived_total_overflow");
    }
    const totalInput = checkedAdd(inputAndRead, input.cacheCreate);
    if (totalInput === null) {
      return invalid(raw, "derived_total_overflow");
    }
    if (totalInput === 0) return noSample(raw, "anthropic");
    const freshInput = totalInput - input.cacheRead;
    return {
      status: "supported",
      semanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
      provider: "anthropic",
      totalInput,
      ordinaryNonReadInput: input.tokensIn,
      cacheRead: input.cacheRead,
      cacheWrite: input.cacheCreate,
      cacheReuseRate: input.cacheRead / totalInput,
      freshInput,
      freshInputRate: freshInput / totalInput,
    };
  }

  if (input.cacheRead > input.tokensIn) {
    return invalid(raw, "cache_read_exceeds_total");
  }
  if (input.cacheCreate > 0) {
    return {
      status: "unsupported",
      reason: "unsupported_usage_semantics",
      raw,
    };
  }

  const totalInput = input.tokensIn;
  if (totalInput === 0) return noSample(raw, "openai");
  const freshInput = totalInput - input.cacheRead;
  return {
    status: "supported",
    semanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    provider: "openai",
    totalInput,
    ordinaryNonReadInput: freshInput,
    cacheRead: input.cacheRead,
    cacheWrite: null,
    cacheReuseRate: input.cacheRead / totalInput,
    freshInput,
    freshInputRate: freshInput / totalInput,
  };
}
