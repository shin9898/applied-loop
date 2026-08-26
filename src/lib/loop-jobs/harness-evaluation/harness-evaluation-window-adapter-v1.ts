import {
  normalizeHarnessEvaluationWindowV1,
} from "../../harness-evaluation-run-v1";
import {
  normalizeHarnessEvaluationReportV1,
  type HarnessEvaluationReportV1,
} from "./harness-evaluation-report-v1";

const REQUEST_KEYS = ["schema", "cohort", "policyVersion", "scopeHash", "cadence", "periodOrdinal", "periodStartEpochMs", "periodEndEpochMs", "report"] as const;
const WINDOW_COHORTS = ["h_cycle", "h_eval", "h_cache"] as const;
const WINDOW_POLICY_VERSIONS = {
  h_cycle: "h_cycle_evidence_v1",
  h_eval: "v1",
  h_cache: "harness-usage-v1",
} as const;

type DataRecord = Record<string, unknown>;
type WindowCohort = (typeof WINDOW_COHORTS)[number];
type WindowOutcome = "supported" | "rejected" | "inconclusive";
type WindowDecisionStage = "provisional" | "final";

export type HarnessEvaluationWindowAdapterRequestV1 = Readonly<{
  schema: "harness_evaluation_window_adapter_request_v1";
  cohort: WindowCohort;
  policyVersion: string;
  scopeHash: string;
  cadence: string;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
  report: HarnessEvaluationReportV1;
}>;

export type HarnessEvaluationWindowSourceV1 = Readonly<{
  schema: "harness_evaluation_window_source_v1";
  cohort: WindowCohort;
  policyVersion: string;
  scopeHash: string;
  cadence: string;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
  outcome: WindowOutcome;
  decisionStage: WindowDecisionStage;
}>;

export type HarnessEvaluationWindowAdapterResultV1 =
  | Readonly<{
      schema: "harness_evaluation_window_adapter_result_v1";
      mode: "manual_preview_only";
      ok: true;
      code: "adapted";
      automaticInterventionAllowed: false;
      window: HarnessEvaluationWindowSourceV1;
    }>
  | Readonly<{
      schema: "harness_evaluation_window_adapter_result_v1";
      mode: "manual_preview_only";
      ok: false;
      code:
        | "invalid_request"
        | "invalid_window"
        | "invalid_report"
        | "integrity_stop_condition"
        | "invalid_cohort_aggregate";
      automaticInterventionAllowed: false;
    }>;

type ReportCohort =
  | HarnessEvaluationReportV1["cohorts"]["hCycle"]
  | HarnessEvaluationReportV1["cohorts"]["hEval"]
  | HarnessEvaluationReportV1["cohorts"]["hCache"];

function dataObject(value: unknown): DataRecord | undefined {
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

function hasExactKeys(record: DataRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  return actual.length === expectedKeys.length && actual.every((key, index) => key === expectedKeys[index]);
}

function cloneClosedInput(value: unknown): unknown | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

function failure(
  code: Extract<HarnessEvaluationWindowAdapterResultV1, { ok: false }>["code"],
): HarnessEvaluationWindowAdapterResultV1 {
  return Object.freeze({
    schema: "harness_evaluation_window_adapter_result_v1" as const,
    mode: "manual_preview_only" as const,
    ok: false as const,
    code,
    automaticInterventionAllowed: false as const,
  });
}

function reportCohort(report: HarnessEvaluationReportV1, cohort: WindowCohort): ReportCohort {
  switch (cohort) {
    case "h_cycle": return report.cohorts.hCycle;
    case "h_eval": return report.cohorts.hEval;
    case "h_cache": return report.cohorts.hCache;
  }
}

function outcomeFor(cohort: ReportCohort): WindowOutcome {
  if (cohort.verdict === "healthy") return "supported";
  if (cohort.verdict === "needs_attention") return "rejected";
  return "inconclusive";
}

function decisionStageFor(
  cohort: WindowCohort,
  value: ReportCohort,
  outcome: WindowOutcome,
): WindowDecisionStage | undefined {
  if (outcome === "inconclusive") return "provisional";

  if (cohort === "h_eval") {
    return (value as HarnessEvaluationReportV1["cohorts"]["hEval"]).decisionStage ?? undefined;
  }

  if (cohort === "h_cycle") {
    return value.reasonCode === "supported" || value.reasonCode === "rejected" ? "final" : "provisional";
  }

  // H-CACHE matched aggregates are deterministic closed comparisons. A
  // missing/insufficient comparison is already represented as inconclusive
  // above, so a supported or rejected cache result is final for this window.
  return "final";
}

function normalizeRequest(value: unknown):
  | Readonly<{
      cohort: WindowCohort;
      policyVersion: string;
      scopeHash: string;
      cadence: string;
      periodOrdinal: number;
      periodStartEpochMs: number;
      periodEndEpochMs: number;
      report: HarnessEvaluationReportV1;
    }>
  | { code: "invalid_request" | "invalid_window" | "invalid_report" } {
  const cloned = cloneClosedInput(value);
  const record = dataObject(cloned);
  if (!record || !hasExactKeys(record, REQUEST_KEYS) || record.schema !== "harness_evaluation_window_adapter_request_v1") {
    return { code: "invalid_request" };
  }

  const cohort = record.cohort;
  if (typeof cohort !== "string" || !(WINDOW_COHORTS as readonly string[]).includes(cohort)) {
    return { code: "invalid_window" };
  }
  if (record.policyVersion !== WINDOW_POLICY_VERSIONS[cohort as WindowCohort]) {
    return { code: "invalid_window" };
  }

  const report = normalizeHarnessEvaluationReportV1(record.report);
  if (report === null) return { code: "invalid_report" };

  return {
    cohort: cohort as WindowCohort,
    policyVersion: record.policyVersion as string,
    scopeHash: record.scopeHash as string,
    cadence: record.cadence as string,
    periodOrdinal: record.periodOrdinal as number,
    periodStartEpochMs: record.periodStartEpochMs as number,
    periodEndEpochMs: record.periodEndEpochMs as number,
    report,
  };
}

/**
 * Converts one already-closed manual report cohort into one A9-D1 observation
 * window. The adapter never queries, writes, schedules, or applies a result;
 * it only supplies the opaque window source consumed by the pure classifier.
 */
export function adaptHarnessEvaluationReportToWindowV1(
  value: unknown,
): HarnessEvaluationWindowAdapterResultV1 {
  try {
    const request = normalizeRequest(value);
    if ("code" in request) return failure(request.code);

    if (request.report.integrity.stopCondition !== "none") {
      return failure("integrity_stop_condition");
    }

    const cohort = reportCohort(request.report, request.cohort);
    if (cohort.reasonCode === "invalid_aggregate") {
      return failure("invalid_cohort_aggregate");
    }
    const outcome = outcomeFor(cohort);
    const decisionStage = decisionStageFor(request.cohort, cohort, outcome);
    if (decisionStage === undefined) return failure("invalid_cohort_aggregate");

    const source: HarnessEvaluationWindowSourceV1 = Object.freeze({
      schema: "harness_evaluation_window_source_v1",
      cohort: request.cohort,
      policyVersion: request.policyVersion,
      scopeHash: request.scopeHash,
      cadence: request.cadence,
      periodOrdinal: request.periodOrdinal,
      periodStartEpochMs: request.periodStartEpochMs,
      periodEndEpochMs: request.periodEndEpochMs,
      outcome,
      decisionStage,
    });
    if (normalizeHarnessEvaluationWindowV1(source) === null) return failure("invalid_window");

    return Object.freeze({
      schema: "harness_evaluation_window_adapter_result_v1" as const,
      mode: "manual_preview_only" as const,
      ok: true as const,
      code: "adapted" as const,
      automaticInterventionAllowed: false as const,
      window: source,
    });
  } catch {
    return failure("invalid_request");
  }
}
