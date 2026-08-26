import { buildHarnessEvaluationEvidenceV1 } from "./harness-evaluation-evidence-v1";
import {
  buildHarnessEvaluationReportV1,
  type HarnessEvaluationReportV1,
} from "./harness-evaluation-report-v1";

const MAX_INPUT_BYTES = 65_536;

type PreviewFailureCode =
  | "preview_disabled"
  | "invalid_arguments"
  | "input_too_large"
  | "invalid_json"
  | "invalid_source_evidence"
  | "internal_error";

type PreviewResult =
  | Readonly<{
      schema: "harness_evaluation_source_preview_result_v1";
      mode: "manual_preview_only";
      ok: true;
      code: "evaluated";
      automaticInterventionAllowed: false;
      report: HarnessEvaluationReportV1;
    }>
  | Readonly<{
      schema: "harness_evaluation_source_preview_result_v1";
      mode: "manual_preview_only";
      ok: false;
      code: PreviewFailureCode;
      automaticInterventionAllowed: false;
    }>;

export type HarnessEvaluationSourcePreviewOutputV1 = Readonly<{
  write(line: string, callback: (error: Error | null | undefined) => void): boolean;
}>;

export type HarnessEvaluationSourcePreviewCliOptionsV1 = Readonly<{
  args: readonly string[];
  input: AsyncIterable<Uint8Array>;
  output: HarnessEvaluationSourcePreviewOutputV1;
}>;

type BoundedInputResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; code: "input_too_large" | "invalid_json" | "internal_error" }>;

function failureResult(code: PreviewFailureCode): PreviewResult {
  return Object.freeze({
    schema: "harness_evaluation_source_preview_result_v1" as const,
    mode: "manual_preview_only" as const,
    ok: false as const,
    code,
    automaticInterventionAllowed: false as const,
  });
}

function successResult(report: HarnessEvaluationReportV1): PreviewResult {
  return Object.freeze({
    schema: "harness_evaluation_source_preview_result_v1" as const,
    mode: "manual_preview_only" as const,
    ok: true as const,
    code: "evaluated" as const,
    automaticInterventionAllowed: false as const,
    report,
  });
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
  output: HarnessEvaluationSourcePreviewOutputV1,
  result: PreviewResult,
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
 * Explicit stdin-only preview for source aggregates. It first closes source
 * evidence and then evaluates it, without reflecting source data or gaining
 * database, scheduler, worker, or intervention authority.
 */
export async function runHarnessEvaluationSourcePreviewCliV1(
  options: HarnessEvaluationSourcePreviewCliOptionsV1,
): Promise<number> {
  let result: PreviewResult;
  if (options.args.length === 0) {
    result = failureResult("preview_disabled");
  } else if (options.args.length !== 1 || options.args[0] !== "--stdin") {
    result = failureResult("invalid_arguments");
  } else {
    const bounded = await readBoundedPreviewInputV1(options.input);
    if (!bounded.ok) {
      result = failureResult(bounded.code);
    } else {
      const evidence = buildHarnessEvaluationEvidenceV1(bounded.value);
      if (!evidence.ok) {
        result = failureResult("invalid_source_evidence");
      } else {
        try {
          result = successResult(buildHarnessEvaluationReportV1(evidence.evidence));
        } catch {
          result = failureResult("internal_error");
        }
      }
    }
  }
  return writeOnePreviewResultV1(options.output, result);
}
