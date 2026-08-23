import { createHash } from "node:crypto";

const CADENCES = ["daily", "weekly", "intervention_7d", "intervention_14d", "monthly"] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ROOT_KEYS = ["schema", "current", "previous"];
const CURRENT_KEYS = ["identity", "scheduler", "usage", "findings", "integrity"];
const IDENTITY_KEYS = [
  "policyVersion",
  "cadence",
  "scopeHash",
  "periodHash",
  "periodOrdinal",
  "periodStartEpochMs",
  "periodEndEpochMs",
];
const SCHEDULER_KEYS = ["scheduledRunCount", "onTimeCompletedRunCount", "eventualIncompleteRunCount"];
const FINDINGS_KEYS = ["duplicateFindingCount", "acceptedFindingCount", "ignoredFindingCount"];
const INTEGRITY_KEYS = ["privacyViolationCount", "dataLossDetected"];
const PREVIOUS_KEYS = ["provenance", "identity", "outcome"];

export const H_EVAL_POLICY_VERSION = "v1" as const;

type Cadence = (typeof CADENCES)[number];
type ReasonCode =
  | "invalid_evidence"
  | "privacy_violation"
  | "data_loss"
  | "budget_exhausted"
  | "evaluation_job_stalled"
  | "duplicate_finding"
  | "low_precision"
  | "usage_unavailable"
  | "no_scheduled_runs"
  | "on_time_slo_missed"
  | "eligible_window";

type DecisionStage = "provisional" | "final";
type DecisionBasis = "current_aggregate_only" | "current_and_caller_asserted_prior";

export type HEvalPolicyResult = Readonly<{
  schema: "h_eval_policy_result_v1";
  mode: "dormant_policy_only";
  identity?: Readonly<{
    policyVersion: "v1";
    cadence: Cadence;
    scopeHash: string;
    periodHash: string;
  }>;
  verdict: "supported" | "rejected" | "inconclusive";
  decisionStage: DecisionStage;
  decisionBasis: DecisionBasis;
  reasonCode: ReasonCode;
  automaticInterventionAllowed: false;
}>;

type Identity = {
  policyVersion: typeof H_EVAL_POLICY_VERSION;
  cadence: Cadence;
  scopeHash: string;
  periodHash: string;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
};

type Scheduler = {
  scheduledRunCount: number;
  onTimeCompletedRunCount: number;
  eventualIncompleteRunCount: number;
};

type Usage =
  | { attribution: "unavailable" }
  | {
      attribution: "observed";
      budgetScope: "global";
      budgetWeekKeyHash: string;
      llmCalls: number;
      freshInputTokens: number;
    };

type Findings = {
  duplicateFindingCount: number;
  acceptedFindingCount: number;
  ignoredFindingCount: number;
};

type Integrity = { privacyViolationCount: number; dataLossDetected: boolean };

type Previous = {
  provenance: "caller_asserted_persisted";
  identity: Identity;
  outcome: "supported" | "ordinary_rejected" | "immediate_rejected" | "inconclusive";
};

type Evidence = {
  identity: Identity;
  scheduler: Scheduler;
  usage: Usage;
  findings: Findings;
  integrity: Integrity;
  previous: Previous | null;
};

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) deepFreeze(nested);
  }
  return Object.freeze(value);
}

function invalidResult(): HEvalPolicyResult {
  return deepFreeze({
    schema: "h_eval_policy_result_v1" as const,
    mode: "dormant_policy_only" as const,
    verdict: "inconclusive" as const,
    decisionStage: "provisional" as const,
    decisionBasis: "current_aggregate_only" as const,
    reasonCode: "invalid_evidence" as const,
    automaticInterventionAllowed: false as const,
  });
}

function resultFor(
  identity: Identity,
  options: {
    verdict: HEvalPolicyResult["verdict"];
    decisionStage: DecisionStage;
    decisionBasis?: DecisionBasis;
    reasonCode: Exclude<ReasonCode, "invalid_evidence">;
  },
): HEvalPolicyResult {
  return deepFreeze({
    schema: "h_eval_policy_result_v1" as const,
    mode: "dormant_policy_only" as const,
    identity: {
      policyVersion: H_EVAL_POLICY_VERSION,
      cadence: identity.cadence,
      scopeHash: identity.scopeHash,
      periodHash: identity.periodHash,
    },
    verdict: options.verdict,
    decisionStage: options.decisionStage,
    decisionBasis: options.decisionBasis ?? "current_aggregate_only",
    reasonCode: options.reasonCode,
    automaticInterventionAllowed: false as const,
  });
}

function readDataObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    record[key] = descriptor.value;
  }
  return record;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  if (keys.length !== expected.length) return false;
  return keys.every((key, index) => key === [...expected].sort()[index]);
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isCadence(value: unknown): value is Cadence {
  return typeof value === "string" && (CADENCES as readonly string[]).includes(value);
}

function calculatePeriodHash(identity: Pick<Identity, "cadence" | "periodOrdinal" | "periodStartEpochMs" | "periodEndEpochMs">) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "h_eval_period_v1",
        H_EVAL_POLICY_VERSION,
        identity.cadence,
        identity.periodOrdinal,
        identity.periodStartEpochMs,
        identity.periodEndEpochMs,
      ]),
      "utf8",
    )
    .digest("hex");
}

function validateIdentity(value: unknown): Identity | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, IDENTITY_KEYS)) return undefined;
  if (
    record.policyVersion !== H_EVAL_POLICY_VERSION ||
    !isCadence(record.cadence) ||
    !isHash(record.scopeHash) ||
    !isHash(record.periodHash) ||
    !safeCount(record.periodOrdinal) ||
    !safeCount(record.periodStartEpochMs) ||
    !safeCount(record.periodEndEpochMs) ||
    record.periodEndEpochMs <= record.periodStartEpochMs
  ) {
    return undefined;
  }
  const identity: Identity = {
    policyVersion: H_EVAL_POLICY_VERSION,
    cadence: record.cadence,
    scopeHash: record.scopeHash,
    periodHash: record.periodHash,
    periodOrdinal: record.periodOrdinal,
    periodStartEpochMs: record.periodStartEpochMs,
    periodEndEpochMs: record.periodEndEpochMs,
  };
  return calculatePeriodHash(identity) === identity.periodHash ? identity : undefined;
}

function validateScheduler(value: unknown): Scheduler | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, SCHEDULER_KEYS)) return undefined;
  if (
    !safeCount(record.scheduledRunCount) ||
    !safeCount(record.onTimeCompletedRunCount) ||
    !safeCount(record.eventualIncompleteRunCount) ||
    record.onTimeCompletedRunCount > record.scheduledRunCount ||
    record.eventualIncompleteRunCount > record.scheduledRunCount ||
    record.onTimeCompletedRunCount > record.scheduledRunCount - record.eventualIncompleteRunCount
  ) {
    return undefined;
  }
  return {
    scheduledRunCount: record.scheduledRunCount,
    onTimeCompletedRunCount: record.onTimeCompletedRunCount,
    eventualIncompleteRunCount: record.eventualIncompleteRunCount,
  };
}

function validateUsage(value: unknown): Usage | undefined {
  const record = readDataObject(value);
  if (!record || typeof record.attribution !== "string") return undefined;
  if (record.attribution === "unavailable") {
    return hasExactKeys(record, ["attribution"]) ? { attribution: "unavailable" } : undefined;
  }
  if (
    record.attribution !== "observed" ||
    !hasExactKeys(record, ["attribution", "budgetScope", "budgetWeekKeyHash", "llmCalls", "freshInputTokens"]) ||
    record.budgetScope !== "global" ||
    !isHash(record.budgetWeekKeyHash) ||
    !safeCount(record.llmCalls) ||
    !safeCount(record.freshInputTokens)
  ) {
    return undefined;
  }
  return {
    attribution: "observed",
    budgetScope: "global",
    budgetWeekKeyHash: record.budgetWeekKeyHash,
    llmCalls: record.llmCalls,
    freshInputTokens: record.freshInputTokens,
  };
}

function validateFindings(value: unknown): Findings | undefined {
  const record = readDataObject(value);
  if (
    !record ||
    !hasExactKeys(record, FINDINGS_KEYS) ||
    !safeCount(record.duplicateFindingCount) ||
    !safeCount(record.acceptedFindingCount) ||
    !safeCount(record.ignoredFindingCount) ||
    record.acceptedFindingCount > Number.MAX_SAFE_INTEGER - record.ignoredFindingCount
  ) {
    return undefined;
  }
  return {
    duplicateFindingCount: record.duplicateFindingCount,
    acceptedFindingCount: record.acceptedFindingCount,
    ignoredFindingCount: record.ignoredFindingCount,
  };
}

function validateIntegrity(value: unknown): Integrity | undefined {
  const record = readDataObject(value);
  if (!record || !hasExactKeys(record, INTEGRITY_KEYS) || !safeCount(record.privacyViolationCount) ||
      typeof record.dataLossDetected !== "boolean") {
    return undefined;
  }
  return { privacyViolationCount: record.privacyViolationCount, dataLossDetected: record.dataLossDetected };
}

function validatePrevious(value: unknown): Previous | null | undefined {
  if (value === null) return null;
  const record = readDataObject(value);
  if (
    !record ||
    !hasExactKeys(record, PREVIOUS_KEYS) ||
    record.provenance !== "caller_asserted_persisted" ||
    (record.outcome !== "supported" && record.outcome !== "ordinary_rejected" &&
      record.outcome !== "immediate_rejected" && record.outcome !== "inconclusive")
  ) {
    return undefined;
  }
  const identity = validateIdentity(record.identity);
  return identity ? { provenance: "caller_asserted_persisted", identity, outcome: record.outcome } : undefined;
}

function validateEvidence(value: unknown): Evidence | undefined {
  const root = readDataObject(value);
  if (!root || !hasExactKeys(root, ROOT_KEYS) || root.schema !== "h_eval_evidence_v1") return undefined;
  const current = readDataObject(root.current);
  if (!current || !hasExactKeys(current, CURRENT_KEYS)) return undefined;
  const identity = validateIdentity(current.identity);
  const scheduler = validateScheduler(current.scheduler);
  const usage = validateUsage(current.usage);
  const findings = validateFindings(current.findings);
  const integrity = validateIntegrity(current.integrity);
  const previous = validatePrevious(root.previous);
  if (!identity || !scheduler || !usage || !findings || !integrity || previous === undefined) return undefined;
  return { identity, scheduler, usage, findings, integrity, previous };
}

function hasAdjacentPrior(
  current: Identity,
  previous: Previous | null,
  expectedOutcome: Previous["outcome"],
): boolean {
  return previous !== null &&
    previous.provenance === "caller_asserted_persisted" &&
    previous.outcome === expectedOutcome &&
    previous.identity.policyVersion === current.policyVersion &&
    previous.identity.cadence === current.cadence &&
    previous.identity.scopeHash === current.scopeHash &&
    previous.identity.periodEndEpochMs === current.periodStartEpochMs &&
    current.periodOrdinal > 0 &&
    previous.identity.periodOrdinal === current.periodOrdinal - 1;
}

function ordinaryResult(
  identity: Identity,
  previous: Previous | null,
  expectedOutcome: Previous["outcome"],
  verdict: "supported" | "rejected",
  reasonCode: "evaluation_job_stalled" | "low_precision" | "eligible_window",
): HEvalPolicyResult {
  const final = hasAdjacentPrior(identity, previous, expectedOutcome);
  return resultFor(identity, {
    verdict,
    decisionStage: final ? "final" : "provisional",
    decisionBasis: final ? "current_and_caller_asserted_prior" : "current_aggregate_only",
    reasonCode,
  });
}

export function evaluateHEvalPolicyV1(input: unknown): HEvalPolicyResult {
  try {
    const evidence = validateEvidence(input);
    if (!evidence) return invalidResult();

    const { identity, integrity, findings, scheduler, usage, previous } = evidence;
    if (integrity.privacyViolationCount > 0) {
      return resultFor(identity, { verdict: "rejected", decisionStage: "final", reasonCode: "privacy_violation" });
    }
    if (integrity.dataLossDetected) {
      return resultFor(identity, { verdict: "rejected", decisionStage: "final", reasonCode: "data_loss" });
    }
    if (findings.duplicateFindingCount > 0) {
      return resultFor(identity, { verdict: "rejected", decisionStage: "final", reasonCode: "duplicate_finding" });
    }
    if (usage.attribution === "observed" && (usage.llmCalls > 5 || usage.freshInputTokens > 50_000)) {
      return resultFor(identity, { verdict: "rejected", decisionStage: "final", reasonCode: "budget_exhausted" });
    }
    if (usage.attribution === "unavailable") {
      return resultFor(identity, { verdict: "inconclusive", decisionStage: "provisional", reasonCode: "usage_unavailable" });
    }
    if (scheduler.eventualIncompleteRunCount > 0) {
      return ordinaryResult(
        identity,
        previous,
        "ordinary_rejected",
        "rejected",
        "evaluation_job_stalled",
      );
    }
    const decidedFindingCount = findings.acceptedFindingCount + findings.ignoredFindingCount;
    if (
      decidedFindingCount >= 4 &&
      findings.acceptedFindingCount < decidedFindingCount - Math.floor(decidedFindingCount / 2)
    ) {
      return ordinaryResult(identity, previous, "ordinary_rejected", "rejected", "low_precision");
    }
    if (scheduler.scheduledRunCount === 0) {
      return resultFor(identity, { verdict: "inconclusive", decisionStage: "provisional", reasonCode: "no_scheduled_runs" });
    }
    if (scheduler.onTimeCompletedRunCount < scheduler.scheduledRunCount - Math.floor(scheduler.scheduledRunCount / 100)) {
      return resultFor(identity, { verdict: "inconclusive", decisionStage: "provisional", reasonCode: "on_time_slo_missed" });
    }
    return ordinaryResult(identity, previous, "supported", "supported", "eligible_window");
  } catch {
    return invalidResult();
  }
}
