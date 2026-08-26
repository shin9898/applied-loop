import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  composeHarnessEvaluationWindowPreviewV1,
  runHarnessEvaluationWindowPreviewCliV1,
} from "./harness-evaluation-window-preview-cli";

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

function source(overrides: Record<string, unknown> = {}) {
  return {
    schema: "harness_evaluation_source_evidence_v1",
    integrity: {
      schema: "harness_evaluation_integrity_v1",
      privacyViolationCount: 0,
      dataLossDetected: false,
      duplicateDurableEffectCount: 0,
      recordIntegrityFailureCount: 0,
    },
    hCycle: {
      schema: "h_cycle_evaluation_source_v1",
      policy: {
        schema: "h_cycle_evidence_policy_v1",
        policyVersion: "h_cycle_evidence_v1",
        status: "supported",
        requiredAdjacentWindows: 2,
        evaluatedWeekKeys: ["2026-W34", "2026-W35"],
      },
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
    hEval: {
      schema: "h_eval_policy_cohort_input_v1",
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

function request(
  cohort: "h_cycle" | "h_eval" | "h_cache" = "h_eval",
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "harness_evaluation_window_preview_request_v1",
    cohort,
    policyVersion: cohort === "h_cycle" ? "h_cycle_evidence_v1" : cohort === "h_cache" ? "harness-usage-v1" : "v1",
    scopeHash: hash("e"),
    cadence: "weekly",
    periodOrdinal: 1,
    periodStartEpochMs: 1_000,
    periodEndEpochMs: 2_000,
    source: source(),
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
    get text() { return text; },
    get writes() { return writes; },
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

test("A9D3-CG1 requires exact stdin authorization before reading source evidence", async () => {
  for (const args of [[], ["--stdin", "--stdin"], ["--stdin", "--unknown"], ["x"]]) {
    const acquired = { count: 0 };
    const collector = outputCollector();
    const status = await runHarnessEvaluationWindowPreviewCliV1({
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

test("A9D3-CG2 composes source evidence into one deterministic opaque window", async () => {
  const valid = encoder.encode(JSON.stringify(request("h_eval")));
  const first = outputCollector();
  const second = outputCollector();
  assert.equal(
    await runHarnessEvaluationWindowPreviewCliV1({
      args: ["--stdin"],
      input: chunks(valid.subarray(0, 29), valid.subarray(29)),
      output: first.output,
    }),
    0,
  );
  assert.equal(
    await runHarnessEvaluationWindowPreviewCliV1({ args: ["--stdin"], input: chunks(valid), output: second.output }),
    0,
  );
  assert.equal(first.text, second.text);
  const result = JSON.parse(first.text) as {
    schema: string;
    code: string;
    window: Record<string, unknown>;
  };
  assert.equal(result.schema, "harness_evaluation_window_preview_result_v1");
  assert.equal(result.code, "evaluated");
  assert.equal(result.window.schema, "harness_evaluation_window_source_v1");
  assert.equal(result.window.cohort, "h_eval");
  assert.equal(result.window.outcome, "supported");
  assert.equal(result.window.decisionStage, "final");
  assert.equal(first.text.includes("2026-W34"), false);
  assert.equal(first.text.includes(hash("a")), false);
  assert.equal(Object.isFrozen(composeHarnessEvaluationWindowPreviewV1(request())), true);
});

test("A9D3-CG3 keeps H-CYCLE/H-EVAL/H-CACHE separate and fails closed", () => {
  for (const cohort of ["h_cycle", "h_eval", "h_cache"] as const) {
    const result = composeHarnessEvaluationWindowPreviewV1(request(cohort));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.window.cohort, cohort);
  }

  const invalidCases: Array<[string, unknown]> = [
    ["invalid_request", { ...request(), unexpected: "raw" }],
    ["invalid_window", request("h_eval", { scopeHash: "2026-W35" })],
    ["invalid_window", request("h_eval", { policyVersion: "harness-usage-v1" })],
    ["invalid_source_evidence", { ...request(), source: { ...source(), secret: "never-echo-A9D3-secret" } }],
    ["integrity_stop_condition", request("h_eval", {
      source: source({ integrity: {
        schema: "harness_evaluation_integrity_v1",
        privacyViolationCount: 1,
        dataLossDetected: false,
        duplicateDurableEffectCount: 0,
        recordIntegrityFailureCount: 0,
      } }),
    })],
  ];
  for (const [code, value] of invalidCases) {
    const result = composeHarnessEvaluationWindowPreviewV1(value);
    assert.deepEqual(result, {
      schema: "harness_evaluation_window_preview_result_v1",
      mode: "manual_preview_only",
      ok: false,
      code,
      automaticInterventionAllowed: false,
    });
    assert.equal(JSON.stringify(result).includes("never-echo-A9D3-secret"), false);
  }
});

test("A9D3-CG4 bounds input, emits one line, and never gains runtime authority", async () => {
  const valid = encoder.encode(JSON.stringify(request()));
  const padded = encoder.encode(`${JSON.stringify(request())}${" ".repeat(65_536 - valid.byteLength)}`);
  const atLimit = outputCollector();
  assert.equal(
    await runHarnessEvaluationWindowPreviewCliV1({ args: ["--stdin"], input: chunks(padded), output: atLimit.output }),
    0,
  );
  assert.equal(atLimit.writes, 1);
  assert.equal(atLimit.text.split("\n").length, 2);

  for (const input of [chunks(new Uint8Array(65_537)), chunks(new Uint8Array()), chunks(encoder.encode("{"))]) {
    const collector = outputCollector();
    assert.equal(
      await runHarnessEvaluationWindowPreviewCliV1({ args: ["--stdin"], input, output: collector.output }),
      1,
    );
    const code = (JSON.parse(collector.text) as { code: string }).code;
    assert.equal(code === "input_too_large" || code === "invalid_json", true);
  }

  let thrownWrites = 0;
  assert.equal(
    await runHarnessEvaluationWindowPreviewCliV1({
      args: [],
      input: chunks(),
      output: {
        write() {
          thrownWrites += 1;
          throw new Error("writer failure");
        },
      },
    }),
    1,
  );
  assert.equal(thrownWrites, 1);

  const sourceCode = readFileSync("src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-preview-cli.ts", "utf8");
  const executableSource = sourceCode.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(executableSource, /(?:DATABASE_URL|PrismaClient|launchd|launchctl|setInterval|setTimeout|fetch\(|createLoopJobQueue|runOneDelivery|process\.env|LLM)/i);
});

test("A9D3-CG5 exposes one manual script and the real stdin entrypoint is deterministic", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(
    packageJson.scripts["harness:evaluate-window-preview"],
    "tsx src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-preview-main.ts",
  );
  assert.equal(
    Object.keys(packageJson.scripts).filter((key) => key.includes("evaluate-window-preview")).length,
    1,
  );
  const smoke = spawnSync("npm", ["run", "--silent", "harness:evaluate-window-preview", "--", "--stdin"], {
    cwd: process.cwd(),
    input: JSON.stringify(request("h_cache")),
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(smoke.stderr, "");
  const output = JSON.parse(smoke.stdout) as { window: { cohort: string; outcome: string } };
  assert.equal(output.window.cohort, "h_cache");
  assert.equal(output.window.outcome, "supported");
});
