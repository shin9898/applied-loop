import { buildHarnessEvaluationEvidenceV1 } from "./harness-evaluation-evidence-v1";
import {
  buildHarnessEvaluationReportV1,
  type HarnessEvaluationReportV1,
} from "./harness-evaluation-report-v1";
import {
  adaptHarnessEvaluationReportToWindowV1,
  type HarnessEvaluationWindowSourceV1,
} from "./harness-evaluation-window-adapter-v1";

const MAX_INPUT_BYTES = 65_536;
const REQUEST_KEYS = [
  "schema",
  "cohort",
  "policyVersion",
  "scopeHash",
  "cadence",
  "periodOrdinal",
  "periodStartEpochMs",
  "periodEndEpochMs",
  "source",
] as const;

type DataRecord = Record<string, unknown>;
type WindowCohort = "h_cycle" | "h_eval" | "h_cache";
type CallerFailureCode =
  | "preview_disabled"
  | "invalid_arguments"
  | "input_too_large"
  | "invalid_json"
  | "invalid_request"
  | "invalid_source_evidence"
  | "invalid_window"
  | "integrity_stop_condition"
  | "invalid_cohort_aggregate"
  | "internal_error";

export type HarnessEvaluationWindowPreviewRequestV1 = Readonly<{
  schema: "harness_evaluation_window_preview_request_v1";
  cohort: WindowCohort;
  policyVersion: string;
  scopeHash: string;
  cadence: string;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
  source: unknown;
}>;

export type HarnessEvaluationWindowPreviewResultV1 =
  | Readonly<{
      schema: "harness_evaluation_window_preview_result_v1";
      mode: "manual_preview_only";
      ok: true;
      code: "evaluated";
      automaticInterventionAllowed: false;
      window: HarnessEvaluationWindowSourceV1;
    }>
  | Readonly<{
      schema: "harness_evaluation_window_preview_result_v1";
      mode: "manual_preview_only";
      ok: false;
      code: CallerFailureCode;
      automaticInterventionAllowed: false;
    }>;

export type HarnessEvaluationWindowPreviewOutputV1 = Readonly<{
  write(line: string, callback: (error: Error | null | undefined) => void): boolean;
}>;

export type HarnessEvaluationWindowPreviewCliOptionsV1 = Readonly<{
  args: readonly string[];
  input: AsyncIterable<Uint8Array>;
  output: HarnessEvaluationWindowPreviewOutputV1;
}>;

type BoundedInputResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; code: "input_too_large" | "invalid_json" | "internal_error" }>;

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

function failure(code: CallerFailureCode): HarnessEvaluationWindowPreviewResultV1 {
  return Object.freeze({
    schema: "harness_evaluation_window_preview_result_v1" as const,
    mode: "manual_preview_only" as const,
    ok: false as const,
    code,
    automaticInterventionAllowed: false as const,
  });
}

function mapAdapterFailure(
  code: "invalid_request" | "invalid_window" | "invalid_report" | "integrity_stop_condition" | "invalid_cohort_aggregate",
): CallerFailureCode {
  switch (code) {
    case "invalid_report": return "internal_error";
    case "invalid_request": return "invalid_request";
    case "invalid_window": return "invalid_window";
    case "integrity_stop_condition": return "integrity_stop_condition";
    case "invalid_cohort_aggregate": return "invalid_cohort_aggregate";
  }
}

/**
 * Explicitly composes one closed source envelope into one cohort-specific
 * observation window. It never collects a second window, persists a report,
 * invokes the classifier, or gains runtime authority.
 */
export function composeHarnessEvaluationWindowPreviewV1(
  value: unknown,
): HarnessEvaluationWindowPreviewResultV1 {
  try {
    const cloned = cloneClosedInput(value);
    const request = dataObject(cloned);
    if (!request || !hasExactKeys(request, REQUEST_KEYS)
      || request.schema !== "harness_evaluation_window_preview_request_v1") {
      return failure("invalid_request");
    }

    const evidence = buildHarnessEvaluationEvidenceV1(request.source);
    if (!evidence.ok) return failure("invalid_source_evidence");

    const report: HarnessEvaluationReportV1 = buildHarnessEvaluationReportV1(evidence.evidence);
    const adapted = adaptHarnessEvaluationReportToWindowV1({
      schema: "harness_evaluation_window_adapter_request_v1",
      cohort: request.cohort,
      policyVersion: request.policyVersion,
      scopeHash: request.scopeHash,
      cadence: request.cadence,
      periodOrdinal: request.periodOrdinal,
      periodStartEpochMs: request.periodStartEpochMs,
      periodEndEpochMs: request.periodEndEpochMs,
      report,
    });
    if (!adapted.ok) return failure(mapAdapterFailure(adapted.code));

    return Object.freeze({
      schema: "harness_evaluation_window_preview_result_v1" as const,
      mode: "manual_preview_only" as const,
      ok: true as const,
      code: "evaluated" as const,
      automaticInterventionAllowed: false as const,
      window: adapted.window,
    });
  } catch {
    return failure("internal_error");
  }
}

async function readBoundedPreviewInputV1(input: AsyncIterable<Uint8Array>): Promise<BoundedInputResult> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let overflowed = false;

  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array)) return { ok: false, code: "internal_error" };
      if (byteLength + chunk.byteLength > MAX_INPUT_BYTES) {
        overflowed = true;
        break;
      }
      chunks.push(new Uint8Array(chunk));
      byteLength += chunk.byteLength;
    }
  } catch {
    return overflowed ? { ok: false, code: "input_too_large" } : { ok: false, code: "internal_error" };
  }

  if (overflowed) return { ok: false, code: "input_too_large" };

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)),
    };
  } catch {
    return { ok: false, code: "invalid_json" };
  }
}

function writeOnePreviewResultV1(
  output: HarnessEvaluationWindowPreviewOutputV1,
  result: HarnessEvaluationWindowPreviewResultV1,
): Promise<number> {
  let serializedLine: string;
  try {
    serializedLine = `${JSON.stringify(result)}\n`;
  } catch {
    return Promise.resolve(1);
  }

  return new Promise((resolve) => {
    let callbackSettled = false;
    let writeReturned = false;
    let callbackError: Error | null | undefined;
    const finish = (error: Error | null | undefined) => {
      if (callbackSettled) return;
      callbackSettled = true;
      callbackError = error;
      if (writeReturned) resolve(error == null && result.ok ? 0 : 1);
    };
    try {
      output.write(serializedLine, finish);
      writeReturned = true;
      if (callbackSettled) resolve(callbackError == null && result.ok ? 0 : 1);
    } catch {
      resolve(1);
    }
  });
}

/**
 * Stdin-only manual caller for one A9-D2 window. No DB, clock, scheduler,
 * worker, launchd, LLM, writer, or automatic intervention is reachable from
 * this boundary.
 */
export async function runHarnessEvaluationWindowPreviewCliV1(
  options: HarnessEvaluationWindowPreviewCliOptionsV1,
): Promise<number> {
  let result: HarnessEvaluationWindowPreviewResultV1;
  if (options.args.length === 0) {
    result = failure("preview_disabled");
  } else if (options.args.length !== 1 || options.args[0] !== "--stdin") {
    result = failure("invalid_arguments");
  } else {
    const bounded = await readBoundedPreviewInputV1(options.input);
    result = bounded.ok ? composeHarnessEvaluationWindowPreviewV1(bounded.value) : failure(bounded.code);
  }
  return writeOnePreviewResultV1(options.output, result);
}
