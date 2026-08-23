import {
  createHEvalSchedulePayloadV1,
  type HEvalSchedulePayloadV1,
} from "./h-eval-job-contract-v1";
import { evaluateHEvalPolicyV1 } from "./h-eval-policy-v1";

const REQUEST_KEYS = ["schema", "jobIdentity", "evidence"] as const;

type PreviewFailureCode =
  | "preview_disabled"
  | "invalid_arguments"
  | "input_too_large"
  | "invalid_json"
  | "invalid_request"
  | "invalid_job_identity"
  | "invalid_evidence"
  | "identity_mismatch"
  | "internal_error";

type PolicyProjectionTuple = Readonly<{
  verdict: "supported" | "rejected" | "inconclusive";
  decisionStage: "provisional" | "final";
  reasonCode:
    | "privacy_violation"
    | "data_loss"
    | "duplicate_finding"
    | "budget_exhausted"
    | "usage_unavailable"
    | "evaluation_job_stalled"
    | "low_precision"
    | "no_scheduled_runs"
    | "on_time_slo_missed"
    | "eligible_window";
}>;

export type PolicyProjection = Readonly<PolicyProjectionTuple>;

export type HEvalPreviewKernelResultV1 =
  | Readonly<{
      schema: "h_eval_preview_result_v1";
      mode: "dormant_preview_only";
      ok: true;
      code: "evaluated";
      automaticInterventionAllowed: false;
      policy: PolicyProjection;
    }>
  | Readonly<{
      schema: "h_eval_preview_result_v1";
      mode: "dormant_preview_only";
      ok: false;
      code: PreviewFailureCode;
      automaticInterventionAllowed: false;
    }>;

type DataRecord = Record<string, unknown>;

function freezeFailure(code: PreviewFailureCode): HEvalPreviewKernelResultV1 {
  return Object.freeze({
    schema: "h_eval_preview_result_v1" as const,
    mode: "dormant_preview_only" as const,
    ok: false as const,
    code,
    automaticInterventionAllowed: false as const,
  });
}

function freezeSuccess(policy: PolicyProjectionTuple): HEvalPreviewKernelResultV1 {
  const projection = Object.freeze({
    verdict: policy.verdict,
    decisionStage: policy.decisionStage,
    reasonCode: policy.reasonCode,
  });
  return Object.freeze({
    schema: "h_eval_preview_result_v1" as const,
    mode: "dormant_preview_only" as const,
    ok: true as const,
    code: "evaluated" as const,
    automaticInterventionAllowed: false as const,
    policy: projection,
  });
}

function isDataObject(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readDataObject(value: unknown): DataRecord | undefined {
  if (!isDataObject(value)) return undefined;

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
  const keys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function readOwnEnumerableDataProperty(value: unknown, key: string): unknown {
  if (!isDataObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function projectTuple(candidate: unknown): PolicyProjectionTuple | undefined {
  const verdict = readOwnEnumerableDataProperty(candidate, "verdict");
  const decisionStage = readOwnEnumerableDataProperty(candidate, "decisionStage");
  const reasonCode = readOwnEnumerableDataProperty(candidate, "reasonCode");
  if (typeof verdict !== "string" || typeof decisionStage !== "string" || typeof reasonCode !== "string") {
    return undefined;
  }
  const tuple = `${verdict}\u0000${decisionStage}\u0000${reasonCode}`;

  switch (tuple) {
    case "rejected\u0000final\u0000privacy_violation":
    case "rejected\u0000final\u0000data_loss":
    case "rejected\u0000final\u0000duplicate_finding":
    case "rejected\u0000final\u0000budget_exhausted":
    case "inconclusive\u0000provisional\u0000usage_unavailable":
    case "rejected\u0000provisional\u0000evaluation_job_stalled":
    case "rejected\u0000final\u0000evaluation_job_stalled":
    case "rejected\u0000provisional\u0000low_precision":
    case "rejected\u0000final\u0000low_precision":
    case "inconclusive\u0000provisional\u0000no_scheduled_runs":
    case "inconclusive\u0000provisional\u0000on_time_slo_missed":
    case "supported\u0000provisional\u0000eligible_window":
    case "supported\u0000final\u0000eligible_window":
      return {
        verdict: verdict as PolicyProjectionTuple["verdict"],
        decisionStage: decisionStage as PolicyProjectionTuple["decisionStage"],
        reasonCode: reasonCode as PolicyProjectionTuple["reasonCode"],
      };
    default:
      return undefined;
  }
}

function identityMatches(expected: HEvalSchedulePayloadV1, candidate: unknown): boolean {
  return readOwnEnumerableDataProperty(candidate, "policyVersion") === expected.policyVersion &&
    readOwnEnumerableDataProperty(candidate, "cadence") === expected.cadence &&
    readOwnEnumerableDataProperty(candidate, "scopeHash") === expected.scopeHash &&
    readOwnEnumerableDataProperty(candidate, "periodHash") === expected.periodHash;
}

export function fenceAndProjectHEvalPolicyResultV1(
  expectedPayload: HEvalSchedulePayloadV1,
  candidate: unknown,
): HEvalPreviewKernelResultV1 {
  try {
    if (readOwnEnumerableDataProperty(candidate, "reasonCode") === "invalid_evidence") {
      return freezeFailure("invalid_evidence");
    }

    const candidateIdentity = readOwnEnumerableDataProperty(candidate, "identity");
    if (!isDataObject(candidateIdentity) || !identityMatches(expectedPayload, candidateIdentity)) {
      return freezeFailure("identity_mismatch");
    }

    const projection = projectTuple(candidate);
    return projection ? freezeSuccess(projection) : freezeFailure("internal_error");
  } catch {
    return freezeFailure("internal_error");
  }
}

export function runHEvalPreviewV1(input: unknown): HEvalPreviewKernelResultV1 {
  let request: DataRecord | undefined;
  try {
    request = readDataObject(input);
  } catch {
    return freezeFailure("invalid_request");
  }

  if (!request || !hasExactKeys(request, REQUEST_KEYS) || request.schema !== "h_eval_preview_request_v1") {
    return freezeFailure("invalid_request");
  }

  const jobIdentity = request.jobIdentity;
  const evidence = request.evidence;
  const scheduled = createHEvalSchedulePayloadV1(jobIdentity);
  if (!scheduled.ok) return freezeFailure("invalid_job_identity");

  const policyResult = evaluateHEvalPolicyV1(evidence);
  return fenceAndProjectHEvalPolicyResultV1(scheduled.payload, policyResult);
}
