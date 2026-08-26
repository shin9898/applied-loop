import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHarnessEvaluationReportV1 } from "./harness-evaluation-report-v1";

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
        after: cacheObservation({ contextFingerprintHash: hash("d"), cacheReadRateBps: 9_150, freshInputTokensPerTurn: 105 }),
      },
    },
    ...overrides,
  };
}

function assertFrozenDeeply(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A9A-CG1 deterministic aggregate report keeps H-CYCLE, H-EVAL, and H-CACHE separate", () => {
  const input = evidence();
  const before = structuredClone(input);
  const report = buildHarnessEvaluationReportV1(input);

  assert.deepEqual(input, before);
  assert.deepEqual(report, {
    schema: "harness_evaluation_report_v1",
    mode: "manual_preview_only",
    automaticInterventionAllowed: false,
    verdict: "healthy",
    integrity: { stopCondition: "none" },
    cohorts: {
      hCycle: {
        policyVersion: "h_cycle_evidence_v1",
        verdict: "healthy",
        reasonCode: "supported",
        eligibleWindowCount: 2,
        requiredAdjacentWindows: 2,
      },
      hEval: {
        policyVersion: "v1",
        verdict: "healthy",
        reasonCode: "eligible_window",
        decisionStage: "final",
      },
      hCache: {
        usageSemanticsVersion: "harness-usage-v1",
        verdict: "healthy",
        reasonCode: "within_guardrail",
        metrics: {
          beforeSampleCount: 7,
          afterSampleCount: 7,
          cacheReadRateDeltaBps: -50,
          freshInputPerTurnDeltaBps: 500,
          cacheWriteTelemetry: "observed",
        },
      },
    },
    proposals: [],
  });
  assertFrozenDeeply(report);
});

test("A9A-CG2 stop conditions win and proposals are deterministic, redacted, and capped", () => {
  const input = evidence({
    integrity: {
      schema: "harness_evaluation_integrity_v1",
      privacyViolationCount: 1,
      dataLossDetected: true,
      duplicateDurableEffectCount: 1,
      recordIntegrityFailureCount: 1,
    },
    hCycle: {
      schema: "h_cycle_evaluation_aggregate_v1",
      policyVersion: "h_cycle_evidence_v1",
      policyStatus: "baseline_collecting",
      eligibleWindowCount: 0,
      requiredAdjacentWindows: 2,
      executionFence: "pending",
      recordReconcileFence: "pending",
    },
    hEval: {
      schema: "h_eval_report_cohort_v1",
      policyVersion: "v1",
      verdict: "inconclusive",
      decisionStage: "provisional",
      reasonCode: "usage_unavailable",
    },
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "unavailable",
        reasonCode: "mixed_cohort",
      },
    },
  });
  const report = buildHarnessEvaluationReportV1(input);

  assert.equal(report.verdict, "needs_attention");
  assert.deepEqual(report.integrity, { stopCondition: "privacy_violation" });
  assert.deepEqual(report.cohorts.hCycle, {
    policyVersion: "h_cycle_evidence_v1",
    verdict: "needs_attention",
    reasonCode: "execution_fence_pending",
    eligibleWindowCount: 0,
    requiredAdjacentWindows: 2,
  });
  assert.deepEqual(report.proposals, [
    { kind: "pause_and_investigate", priority: 1, reasonCode: "privacy_violation" },
    { kind: "complete_h_cycle_execution_fence", priority: 2, reasonCode: "execution_fence_pending" },
    { kind: "collect_h_cycle_observation", priority: 3, reasonCode: "h_cycle_baseline_missing" },
  ]);
  assert.equal(report.proposals.length, 3);
  assert.equal(JSON.stringify(report).includes(hash("a")), false);
});

test("A9A-CG3 treats C3b/C3c gaps as a prerequisite, never as periodic activation authority", () => {
  for (const [executionFence, recordReconcileFence, reasonCode] of [
    ["invalid", "complete", "execution_fence_invalid"],
    ["complete", "pending", "record_reconcile_pending"],
  ] as const) {
    const input = evidence({
      hCycle: {
        schema: "h_cycle_evaluation_aggregate_v1",
        policyVersion: "h_cycle_evidence_v1",
        policyStatus: "supported",
        eligibleWindowCount: 2,
        requiredAdjacentWindows: 2,
        executionFence,
        recordReconcileFence,
      },
    });
    const report = buildHarnessEvaluationReportV1(input);
    assert.equal(report.cohorts.hCycle.reasonCode, reasonCode);
    assert.equal(report.proposals[0]?.kind, "complete_h_cycle_execution_fence");
    assert.equal(report.automaticInterventionAllowed, false);
    assert.equal(JSON.stringify(report).includes("enable"), false);
  }
});

test("A9A-CG4 cache recommendations require a recorded matched cohort and keep insufficient evidence explicit", () => {
  const baselineOnly = buildHarnessEvaluationReportV1(evidence({
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "baseline_only",
        baseline: cacheObservation(),
      },
    },
  }));
  assert.equal(baselineOnly.cohorts.hCache.reasonCode, "baseline_only");
  assert.deepEqual(baselineOnly.proposals, [
    { kind: "collect_cache_baseline", priority: 4, reasonCode: "cache_baseline_only" },
  ]);
  assert.equal(baselineOnly.proposals.some((proposal) => proposal.kind === "review_stable_prefix"), false);

  const pending = buildHarnessEvaluationReportV1(evidence({
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "intervention_pending",
        interventionIdHash: hash("e"),
      },
    },
  }));
  assert.equal(pending.cohorts.hCache.reasonCode, "intervention_pending");
  assert.deepEqual(pending.proposals, [
    { kind: "record_and_reobserve", priority: 6, reasonCode: "intervention_window_pending" },
  ]);

  const regression = buildHarnessEvaluationReportV1(evidence({
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "matched",
        interventionIdHash: hash("c"),
        before: cacheObservation(),
        after: cacheObservation({ contextFingerprintHash: hash("d"), cacheReadRateBps: 9_000, freshInputTokensPerTurn: 106 }),
      },
    },
  }));
  assert.equal(regression.cohorts.hCache.reasonCode, "guardrail_regressed");
  assert.deepEqual(regression.proposals, [
    { kind: "review_stable_prefix", priority: 5, reasonCode: "cache_guardrail_regressed" },
  ]);
});

test("A9A-CG5 rejects invalid, accessor, mixed, and Proxy evidence without echoing it", () => {
  const sentinel = "never-echo-A9A-secret";
  const extra = { ...evidence(), [sentinel]: sentinel };
  const accessor = evidence();
  Object.defineProperty(accessor, "hCycle", {
    enumerable: true,
    get() {
      throw new Error(sentinel);
    },
  });
  const mismatchedCohort = evidence();
  mismatchedCohort.hCache.comparison.after.cohortKeyHash = hash("f");
  const transparentProxy = new Proxy(evidence(), {});

  for (const invalid of [extra, accessor, mismatchedCohort, transparentProxy]) {
    const report = buildHarnessEvaluationReportV1(invalid);
    assert.equal(report.verdict, "insufficient_evidence");
    assert.equal(report.cohorts.hCycle.reasonCode, "invalid_aggregate");
    assert.deepEqual(report.proposals, [
      { kind: "pause_and_investigate", priority: 1, reasonCode: "invalid_aggregate" },
    ]);
    assert.equal(JSON.stringify(report).includes(sentinel), false);
    assertFrozenDeeply(report);
  }
});

test("A9A-CG6 remains a pure manual report kernel", () => {
  const source = readFileSync(
    "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.ts",
    "utf8",
  );
  const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.equal(/^import\s/m.test(executableSource), false);
  assert.doesNotMatch(
    executableSource,
    /(?:Prisma|DATABASE_URL|process\.|launchd|launchctl|worker|setInterval|setTimeout|fetch\(|LLM|createLoopJobQueue|runOneDelivery)/,
  );
});
