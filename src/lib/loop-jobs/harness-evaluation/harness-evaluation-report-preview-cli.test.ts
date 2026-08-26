import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { runHarnessEvaluationReportPreviewCliV1 } from "./harness-evaluation-report-preview-cli";

const encoder = new TextEncoder();
const hash = (character: string) => character.repeat(64);

function cacheObservation(overrides: Record<string, unknown> = {}) {
  return {
    cohortKeyHash: hash("a"),
    contextFingerprintHash: hash("b"),
    sampleCount: 7,
    cacheReadRateBps: 9_200,
    freshInputTokensPerTurn: 100,
    cacheWriteTelemetry: "observed",
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schema: "harness_evaluation_evidence_v1",
    integrity: {
      schema: "harness_evaluation_integrity_v1",
      privacyViolationCount: 0,
      dataLossDetected: false,
      duplicateDurableEffectCount: 0,
      recordIntegrityFailureCount: 0,
    },
    hCycle: {
      schema: "h_cycle_evaluation_aggregate_v1",
      policyVersion: "h_cycle_evidence_v1",
      policyStatus: "supported",
      eligibleWindowCount: 2,
      requiredAdjacentWindows: 2,
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
    hEval: {
      schema: "h_eval_report_cohort_v1",
      policyVersion: "v1",
      verdict: "supported",
      decisionStage: "final",
      reasonCode: "eligible_window",
    },
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "matched",
        interventionIdHash: hash("c"),
        before: cacheObservation(),
        after: cacheObservation({
          contextFingerprintHash: hash("d"),
          cacheReadRateBps: 9_150,
          freshInputTokensPerTurn: 105,
        }),
      },
    },
    ...overrides,
  };
}

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield value;
}

function outputCollector() {
  let text = "";
  let writes = 0;
  return {
    output: {
      write(line: string, callback: (error: Error | null | undefined) => void): boolean {
        writes += 1;
        text += line;
        callback(null);
        return true;
      },
    },
    get text() {
      return text;
    },
    get writes() {
      return writes;
    },
  };
}

function unreadableInput(acquired: { count: number }): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      acquired.count += 1;
      throw new Error("input must not be acquired");
    },
  };
}

test("A9A-CG7-T1 manual-report-preview-requires-exact-stdin-authorization", async () => {
  for (const args of [[], ["--stdin", "--stdin"], ["--stdin", "--unknown"], ["x"]]) {
    const acquired = { count: 0 };
    const collector = outputCollector();
    const status = await runHarnessEvaluationReportPreviewCliV1({
      args,
      input: unreadableInput(acquired),
      output: collector.output,
    });

    assert.equal(acquired.count, 0);
    assert.equal(status, 1);
    assert.equal(collector.writes, 1);
    const result = JSON.parse(collector.text) as { code: string; automaticInterventionAllowed: boolean };
    assert.equal(result.code, args.length === 0 ? "preview_disabled" : "invalid_arguments");
    assert.equal(result.automaticInterventionAllowed, false);
  }
});

test("A9A-CG8-T1 manual-report-preview-bounds-and-redacts-stdin", async () => {
  const valid = encoder.encode(JSON.stringify(evidence()));
  const split = outputCollector();
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({
      args: ["--stdin"],
      input: chunks(valid.subarray(0, 31), valid.subarray(31)),
      output: split.output,
    }),
    0,
  );
  const result = JSON.parse(split.text) as {
    code: string;
    report: { verdict: string; automaticInterventionAllowed: boolean };
  };
  assert.equal(result.code, "evaluated");
  assert.equal(result.report.verdict, "healthy");
  assert.equal(result.report.automaticInterventionAllowed, false);
  assert.equal(split.text.includes(hash("a")), false);

  const padded = encoder.encode(`${JSON.stringify(evidence())}${" ".repeat(65_536 - valid.byteLength)}`);
  assert.equal(padded.byteLength, 65_536);
  const exactlyAtLimit = outputCollector();
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({
      args: ["--stdin"],
      input: chunks(padded),
      output: exactlyAtLimit.output,
    }),
    0,
  );

  const cases: Array<[string, AsyncIterable<Uint8Array>]> = [
    ["input_too_large", chunks(new Uint8Array(65_537))],
    ["input_too_large", chunks(new Uint8Array([0xff]), new Uint8Array(65_536))],
    ["invalid_json", chunks(new Uint8Array())],
    ["invalid_json", chunks(new Uint8Array([0xef, 0xbb, 0xbf, ...valid]))],
    ["invalid_json", chunks(encoder.encode("{"))],
    ["invalid_json", chunks(encoder.encode(`${JSON.stringify(evidence())} trailing`))],
  ];
  for (const [code, input] of cases) {
    const collector = outputCollector();
    assert.equal(
      await runHarnessEvaluationReportPreviewCliV1({ args: ["--stdin"], input, output: collector.output }),
      1,
    );
    assert.equal((JSON.parse(collector.text) as { code: string }).code, code);
  }

  const erroringInput: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode("{");
      throw new Error("stream failure");
    },
  };
  const errorCollector = outputCollector();
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({
      args: ["--stdin"],
      input: erroringInput,
      output: errorCollector.output,
    }),
    1,
  );
  assert.equal((JSON.parse(errorCollector.text) as { code: string }).code, "internal_error");
});

test("A9A-CG9-T1 invalid-evidence-is-a-redacted-failure-not-an-invalid-report", async () => {
  const secret = "never-echo-A9A-cli-secret";
  const invalid = encoder.encode(JSON.stringify({ ...evidence(), [secret]: secret }));
  const collector = outputCollector();
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({
      args: ["--stdin"],
      input: chunks(invalid),
      output: collector.output,
    }),
    1,
  );
  assert.deepEqual(JSON.parse(collector.text), {
    schema: "harness_evaluation_report_preview_result_v1",
    mode: "manual_preview_only",
    ok: false,
    code: "invalid_evidence",
    automaticInterventionAllowed: false,
  });
  assert.equal(collector.text.includes(secret), false);
  assert.equal(collector.text.includes("harness_evaluation_report_v1"), false);
});

test("A9A-CG10-T1 manual-report-preview-emits-one-deterministic-line-and-fails-closed-on-output-errors", async () => {
  const valid = encoder.encode(JSON.stringify(evidence()));
  const first = outputCollector();
  const second = outputCollector();
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({ args: ["--stdin"], input: chunks(valid), output: first.output }),
    0,
  );
  assert.equal(
    await runHarnessEvaluationReportPreviewCliV1({ args: ["--stdin"], input: chunks(valid), output: second.output }),
    0,
  );
  assert.equal(first.writes, 1);
  assert.equal(first.text, second.text);
  assert.match(first.text, /^\{"schema":"harness_evaluation_report_preview_result_v1"/);
  assert.equal(first.text.split("\n").length, 2);

  let throwWrites = 0;
  const thrown = await runHarnessEvaluationReportPreviewCliV1({
    args: [],
    input: chunks(),
    output: {
      write() {
        throwWrites += 1;
        throw new Error("writer failure");
      },
    },
  });
  assert.equal(thrown, 1);
  assert.equal(throwWrites, 1);

  let callbackErrorWrites = 0;
  const callbackError = await runHarnessEvaluationReportPreviewCliV1({
    args: [],
    input: chunks(),
    output: {
      write(_line, callback) {
        callbackErrorWrites += 1;
        callback(new Error("writer callback failure"));
        return true;
      },
    },
  });
  assert.equal(callbackError, 1);
  assert.equal(callbackErrorWrites, 1);

  const smoke = spawnSync("npm", ["run", "--silent", "harness:evaluate-report-preview", "--", "--stdin"], {
    cwd: process.cwd(),
    input: JSON.stringify(evidence()),
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(smoke.stderr, "");
  assert.equal(smoke.stdout, first.text);
});
