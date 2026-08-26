import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateHarnessEvaluationWindowsV1,
  normalizeHarnessEvaluationWindowV1,
} from "../../harness-evaluation-run-v1";
import { buildHarnessEvaluationReportV1 } from "./harness-evaluation-report-v1";
import { adaptHarnessEvaluationReportToWindowV1 } from "./harness-evaluation-window-adapter-v1";

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

function report(overrides: Record<string, unknown> = {}) {
  return buildHarnessEvaluationReportV1({
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
  });
}

function request(
  cohort: "h_cycle" | "h_eval" | "h_cache",
  value: unknown = report(),
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "harness_evaluation_window_adapter_request_v1",
    cohort,
    policyVersion: {
      h_cycle: "h_cycle_evidence_v1",
      h_eval: "v1",
      h_cache: "harness-usage-v1",
    }[cohort],
    scopeHash: hash("e"),
    cadence: "weekly",
    periodOrdinal: 1,
    periodStartEpochMs: 1_000,
    periodEndEpochMs: 2_000,
    report: value,
    ...overrides,
  };
}

test("A9D2-CG1 maps one closed H-EVAL report cohort into an opaque window", () => {
  const input = request("h_eval");
  const first = adaptHarnessEvaluationReportToWindowV1(input);
  const second = adaptHarnessEvaluationReportToWindowV1(input);

  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) return;
  assert.equal(first.code, "adapted");
  assert.equal(first.window.schema, "harness_evaluation_window_source_v1");
  assert.equal(first.window.cohort, "h_eval");
  assert.equal(first.window.outcome, "supported");
  assert.equal(first.window.decisionStage, "final");
  assert.match(normalizeHarnessEvaluationWindowV1(first.window)?.periodHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(first.window.scopeHash, hash("e"));
  assert.equal("report" in first.window, false);
  assert.equal(first.automaticInterventionAllowed, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.window), true);
});

test("A9D2-CG2 maps cohort-specific attention and evidence states conservatively", () => {
  const hCycleBaseline = adaptHarnessEvaluationReportToWindowV1(
    request("h_cycle", report({
      hCycle: {
        schema: "h_cycle_evaluation_aggregate_v1",
        policyVersion: "h_cycle_evidence_v1",
        policyStatus: "baseline_collecting",
        eligibleWindowCount: 1,
        requiredAdjacentWindows: 2,
        executionFence: "complete",
        recordReconcileFence: "complete",
      },
    })),
  );
  assert.equal(hCycleBaseline.ok, true);
  if (hCycleBaseline.ok) {
    assert.equal(hCycleBaseline.window.outcome, "inconclusive");
    assert.equal(hCycleBaseline.window.decisionStage, "provisional");
  }

  const hEvalRejected = adaptHarnessEvaluationReportToWindowV1(
    request("h_eval", report({
      hEval: {
        schema: "h_eval_report_cohort_v1",
        policyVersion: "v1",
        verdict: "rejected",
        decisionStage: "provisional",
        reasonCode: "evaluation_job_stalled",
      },
    })),
  );
  assert.equal(hEvalRejected.ok, true);
  if (hEvalRejected.ok) {
    assert.equal(hEvalRejected.window.outcome, "rejected");
    assert.equal(hEvalRejected.window.decisionStage, "provisional");
  }

  const hCacheRejected = adaptHarnessEvaluationReportToWindowV1(
    request("h_cache", report({
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
            cacheReadRateBps: 8_900,
            freshInputTokensPerTurn: 110,
          }),
        },
      },
    })),
  );
  assert.equal(hCacheRejected.ok, true);
  if (hCacheRejected.ok) {
    assert.equal(hCacheRejected.window.outcome, "rejected");
    assert.equal(hCacheRejected.window.decisionStage, "final");
  }
});

test("A9D2-CG3 fails closed for invalid windows, reports, integrity stops, and mixed request shapes", () => {
  const invalidCases: Array<[string, unknown]> = [
    ["invalid_request", { ...request("h_eval"), unexpected: "raw" }],
    ["invalid_window", request("h_eval", report(), { policyVersion: "harness-usage-v1" })],
    ["invalid_window", request("h_eval", report(), { scopeHash: "2026-W35" })],
    ["invalid_window", request("h_eval", report(), { periodEndEpochMs: 1_000 })],
    ["invalid_report", request("h_eval", { schema: "not-a-report" })],
    ["integrity_stop_condition", request("h_eval", report({
      integrity: {
        schema: "harness_evaluation_integrity_v1",
        privacyViolationCount: 1,
        dataLossDetected: false,
        duplicateDurableEffectCount: 0,
        recordIntegrityFailureCount: 0,
      },
    }))],
    ["invalid_cohort_aggregate", request("h_eval", buildHarnessEvaluationReportV1({}))],
  ];

  for (const [code, input] of invalidCases) {
    const result = adaptHarnessEvaluationReportToWindowV1(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
    assert.equal(result.automaticInterventionAllowed, false);
  }

  const secret = "prompt-secret /Users/private/answer-token";
  const proxied = new Proxy(request("h_eval"), {});
  const proxyResult = adaptHarnessEvaluationReportToWindowV1(proxied);
  assert.deepEqual(proxyResult, {
    schema: "harness_evaluation_window_adapter_result_v1",
    mode: "manual_preview_only",
    ok: false,
    code: "invalid_request",
    automaticInterventionAllowed: false,
  });
  const rawResult = adaptHarnessEvaluationReportToWindowV1(request("h_eval", report(), { scopeHash: secret }));
  assert.equal(rawResult.ok, false);
  assert.doesNotMatch(JSON.stringify(rawResult), /prompt-secret|\/Users\/private|answer-token/);
});

test("A9D2-CG4 detaches report input and has no execution or persistence authority", () => {
  const input = request("h_eval", structuredClone(report()));
  const result = adaptHarnessEvaluationReportToWindowV1(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  (input.report as { cohorts: unknown }).cohorts = null;
  assert.equal(result.window.outcome, "supported");

  const source = readFileSync("src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-adapter-v1.ts", "utf8");
  assert.doesNotMatch(source, /(?:DATABASE_URL|PrismaClient|launchd|launchctl|setInterval|setTimeout|fetch\(|process\.env|createLoopJobQueue|runOneDelivery|write\(|update\(|delete\()/i);
});

test("A9D2-CG5 supplies two adjacent manual windows to the A9-D1 classifier", () => {
  const first = adaptHarnessEvaluationReportToWindowV1(
    request("h_eval", report(), {
      periodOrdinal: 1,
      periodStartEpochMs: 1_000,
      periodEndEpochMs: 2_000,
    }),
  );
  const second = adaptHarnessEvaluationReportToWindowV1(
    request("h_eval", report(), {
      periodOrdinal: 2,
      periodStartEpochMs: 2_000,
      periodEndEpochMs: 3_000,
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const result = evaluateHarnessEvaluationWindowsV1({
    schema: "harness_evaluation_window_set_v1",
    windows: [first.window, second.window],
  });
  assert.deepEqual(
    {
      status: result.status,
      outcome: result.outcome,
      decisionStage: result.decisionStage,
      reasonCode: result.reasonCode,
      adjacentWindowCount: result.adjacentWindowCount,
    },
    {
      status: "eligible",
      outcome: "supported",
      decisionStage: "final",
      reasonCode: "eligible_window",
      adjacentWindowCount: 2,
    },
  );
  assert.equal(result.automaticInterventionAllowed, false);
});
