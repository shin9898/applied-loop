import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHCacheEvaluationAggregateV1 } from "./harness-evaluation-cache-cohort-v1";
import { buildHarnessEvaluationEvidenceV1 } from "./harness-evaluation-evidence-v1";
import { buildHarnessEvaluationReportV1 } from "./harness-evaluation-report-v1";

const hash = (character: string) => character.repeat(64);

function cacheSample(overrides: Record<string, unknown> = {}) {
  return {
    schema: "h_cache_usage_sample_v1",
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
    inputTotalTokens: 100,
    inputUncachedTokens: 10,
    cacheReadTokens: 90,
    cacheWriteTokens: null,
    turns: 2,
    ...overrides,
  };
}

function cacheObservation(contextFingerprint: string, cacheReadTokens: number, inputUncachedTokens: number) {
  return {
    schema: "h_cache_cohort_observation_input_v1",
    cohort: {
      harness: "codex",
      model: "gpt-5.6",
      repo: "applied-loop",
      contextFingerprint,
      usageSemanticsVersion: "harness-usage-v1",
      collectorVersion: "harness-collector-v1",
    },
    samples: Array.from({ length: 7 }, () => cacheSample({ cacheReadTokens, inputUncachedTokens })),
  };
}

function hCache() {
  const beforeContextFingerprint = `sha256:${hash("b")}`;
  const afterContextFingerprint = `sha256:${hash("c")}`;
  return buildHCacheEvaluationAggregateV1({
    schema: "h_cache_evaluation_request_v1",
    baseline: cacheObservation(beforeContextFingerprint, 90, 10),
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint,
      afterContextFingerprint,
    },
    followup: cacheObservation(afterContextFingerprint, 95, 5),
  });
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
    hCache: hCache(),
    ...overrides,
  };
}

function assertFrozenDeeply(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A9A-EVIDENCE-CG1 composes three isolated aggregate cohorts into the report input", () => {
  const input = source();
  const before = structuredClone(input);
  const result = buildHarnessEvaluationEvidenceV1(input);

  assert.deepEqual(input, before);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.evidence.hCycle, {
    schema: "h_cycle_evaluation_aggregate_v1",
    policyVersion: "h_cycle_evidence_v1",
    policyStatus: "supported",
    eligibleWindowCount: 2,
    requiredAdjacentWindows: 2,
    executionFence: "complete",
    recordReconcileFence: "complete",
  });
  assert.deepEqual(result.evidence.hEval, {
    schema: "h_eval_report_cohort_v1",
    policyVersion: "v1",
    verdict: "supported",
    decisionStage: "final",
    reasonCode: "eligible_window",
  });
  assert.deepEqual(result.evidence.hCache, input.hCache);
  assert.notEqual(result.evidence.hCache, input.hCache);
  assertFrozenDeeply(result);

  const report = buildHarnessEvaluationReportV1(result.evidence);
  assert.equal(report.verdict, "healthy");
  assert.equal(report.cohorts.hCache.reasonCode, "within_guardrail");
  assert.deepEqual(report.proposals, []);
});

test("A9A-EVIDENCE-CG2 keeps nonterminal H-CYCLE status explicit and conservative", () => {
  const baseline = buildHarnessEvaluationEvidenceV1(source({
    hCycle: {
      schema: "h_cycle_evaluation_source_v1",
      policy: {
        schema: "h_cycle_evidence_policy_v1",
        policyVersion: "h_cycle_evidence_v1",
        status: "baseline_collecting",
        requiredAdjacentWindows: 2,
        evaluatedWeekKeys: ["2026-W35"],
      },
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
  }));
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.equal(baseline.evidence.hCycle.eligibleWindowCount, 1);
  const report = buildHarnessEvaluationReportV1(baseline.evidence);
  assert.equal(report.cohorts.hCycle.reasonCode, "baseline_collecting");
  assert.deepEqual(report.proposals, [
    { kind: "collect_h_cycle_observation", priority: 3, reasonCode: "h_cycle_baseline_missing" },
  ]);

  const inconclusive = buildHarnessEvaluationEvidenceV1(source({
    hCycle: {
      schema: "h_cycle_evaluation_source_v1",
      policy: {
        schema: "h_cycle_evidence_policy_v1",
        policyVersion: "h_cycle_evidence_v1",
        status: "inconclusive",
        requiredAdjacentWindows: 2,
        evaluatedWeekKeys: ["2026-W34", "2026-W35"],
      },
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
  }));
  assert.equal(inconclusive.ok, true);
  if (!inconclusive.ok) return;
  assert.equal(inconclusive.evidence.hCycle.eligibleWindowCount, 2);
  const inconclusiveReport = buildHarnessEvaluationReportV1(inconclusive.evidence);
  assert.equal(inconclusiveReport.cohorts.hCycle.reasonCode, "inconclusive");
  assert.equal(inconclusiveReport.cohorts.hCycle.verdict, "insufficient_evidence");
});

test("A9A-EVIDENCE-CG3 rejects malformed, extra, and Proxy source input without echoing it", () => {
  const secret = "never-echo-evidence-source-secret";
  const invalidPolicy = source({
    hCycle: {
      schema: "h_cycle_evaluation_source_v1",
      policy: {
        schema: "h_cycle_evidence_policy_v1",
        policyVersion: "h_cycle_evidence_v1",
        status: "supported",
        requiredAdjacentWindows: 2,
        evaluatedWeekKeys: ["2026-W34"],
      },
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
    [secret]: secret,
  });
  const invalidCache = source({ hCache: { schema: "h_cache_evaluation_aggregate_v1" } });
  for (const input of [invalidPolicy, invalidCache, new Proxy(source(), {})]) {
    const result = buildHarnessEvaluationEvidenceV1(input);
    assert.deepEqual(result, {
      schema: "harness_evaluation_evidence_build_result_v1",
      mode: "manual_preview_only",
      ok: false,
      code: "invalid_source_evidence",
      automaticInterventionAllowed: false,
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assertFrozenDeeply(result);
  }
});

test("A9A-EVIDENCE-CG4 remains a non-DB, non-authoritative deterministic boundary", () => {
  const sourceText = readFileSync(
    "src/lib/loop-jobs/harness-evaluation/harness-evaluation-evidence-v1.ts",
    "utf8",
  );
  const executableSource = sourceText.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(executableSource, /from "\.\/harness-evaluation-report-v1";/);
  assert.doesNotMatch(
    executableSource,
    /(?:Prisma|DATABASE_URL|process\.|worker|scheduler|launchd|createLoopJobQueue|runOneDelivery|fetch\(|LLM)/,
  );
  assert.deepEqual(buildHarnessEvaluationEvidenceV1(source()), buildHarnessEvaluationEvidenceV1(source()));
});
