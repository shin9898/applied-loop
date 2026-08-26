import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHCacheEvaluationAggregateV1 } from "./harness-evaluation-cache-cohort-v1";
import { buildHarnessEvaluationReportV1 } from "./harness-evaluation-report-v1";

const hash = (character: string) => character.repeat(64);

function sample(overrides: Record<string, unknown> = {}) {
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

function observation(
  contextFingerprint = `sha256:${hash("b")}`,
  overrides: Record<string, unknown> = {},
) {
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
    samples: Array.from({ length: 7 }, () => sample()),
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schema: "h_cache_evaluation_request_v1",
    baseline: observation(),
    intervention: null,
    followup: null,
    ...overrides,
  };
}

function assertFrozenDeeply(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A9A-CACHE-CG1 builds a redacted baseline from one exact normalized cohort", () => {
  const input = request();
  const before = structuredClone(input);
  const result = buildHCacheEvaluationAggregateV1(input);

  assert.deepEqual(input, before);
  assert.equal(result.schema, "h_cache_evaluation_aggregate_v1");
  assert.equal(result.usageSemanticsVersion, "harness-usage-v1");
  assert.equal(result.comparison.status, "baseline_only");
  if (result.comparison.status !== "baseline_only") return;
  assert.deepEqual(
    {
      sampleCount: result.comparison.baseline.sampleCount,
      cacheReadRateBps: result.comparison.baseline.cacheReadRateBps,
      freshInputTokensPerTurn: result.comparison.baseline.freshInputTokensPerTurn,
      cacheWriteTelemetry: result.comparison.baseline.cacheWriteTelemetry,
    },
    {
      sampleCount: 7,
      cacheReadRateBps: 9_000,
      freshInputTokensPerTurn: 5,
      cacheWriteTelemetry: "unavailable",
    },
  );
  assert.match(result.comparison.baseline.cohortKeyHash, /^[0-9a-f]{64}$/);
  assert.equal(result.comparison.baseline.contextFingerprintHash, hash("b"));
  assert.equal(JSON.stringify(result).includes("gpt-5.6"), false);
  assert.equal(JSON.stringify(result).includes("applied-loop"), false);
  assertFrozenDeeply(result);
});

test("A9A-CACHE-CG2 permits a before/after comparison only for an explicit matched intervention", () => {
  const beforeFingerprint = `sha256:${hash("b")}`;
  const afterFingerprint = `sha256:${hash("c")}`;
  const result = buildHCacheEvaluationAggregateV1(request({
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint: beforeFingerprint,
      afterContextFingerprint: afterFingerprint,
    },
    followup: observation(afterFingerprint, {
      samples: Array.from({ length: 7 }, () => sample({
        inputUncachedTokens: 5,
        cacheReadTokens: 95,
      })),
    }),
  }));

  assert.equal(result.comparison.status, "matched");
  if (result.comparison.status !== "matched") return;
  assert.equal(result.comparison.interventionIdHash, hash("d"));
  assert.equal(result.comparison.before.cohortKeyHash, result.comparison.after.cohortKeyHash);
  assert.equal(result.comparison.before.contextFingerprintHash, hash("b"));
  assert.equal(result.comparison.after.contextFingerprintHash, hash("c"));
  assert.equal(result.comparison.after.cacheReadRateBps, 9_500);
  assert.equal(result.comparison.after.freshInputTokensPerTurn, 2);

  const pending = buildHCacheEvaluationAggregateV1(request({
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint: beforeFingerprint,
      afterContextFingerprint: afterFingerprint,
    },
  }));
  assert.deepEqual(pending.comparison, {
    schema: "h_cache_comparison_v1",
    status: "intervention_pending",
    interventionIdHash: hash("d"),
  });
});

test("A9A-CACHE-CG2b emits exactly the closed H-CACHE child accepted by the integrated report", () => {
  const beforeFingerprint = `sha256:${hash("b")}`;
  const afterFingerprint = `sha256:${hash("c")}`;
  const hCache = buildHCacheEvaluationAggregateV1(request({
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint: beforeFingerprint,
      afterContextFingerprint: afterFingerprint,
    },
    followup: observation(afterFingerprint, {
      samples: Array.from({ length: 7 }, () => sample({
        inputUncachedTokens: 5,
        cacheReadTokens: 95,
      })),
    }),
  }));
  const report = buildHarnessEvaluationReportV1({
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
    hCache,
  });

  assert.equal(report.verdict, "healthy");
  assert.equal(report.cohorts.hCache.reasonCode, "within_guardrail");
  assert.deepEqual(report.proposals, []);
});

test("A9A-CACHE-CG3 classifies missing, unavailable, malformed, and mixed evidence without inventing a comparison", () => {
  const cases: Array<[string, unknown]> = [
    ["no_cache_samples", request({ baseline: null })],
    ["usage_unavailable", request({
      baseline: observation(undefined, {
        samples: [sample({
          usageNormalizationStatus: "unsupported",
          inputTotalTokens: null,
          inputUncachedTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        })],
      }),
    })],
    ["invalid_normalization", request({
      baseline: observation(undefined, {
        samples: [sample({ inputUncachedTokens: 11 })],
      }),
    })],
    ["mixed_cohort", request({
      followup: observation(`sha256:${hash("c")}`),
    })],
  ];
  for (const [reasonCode, input] of cases) {
    const result = buildHCacheEvaluationAggregateV1(input);
    assert.deepEqual(result.comparison, {
      schema: "h_cache_comparison_v1",
      status: "unavailable",
      reasonCode,
    });
  }

  const beforeFingerprint = `sha256:${hash("b")}`;
  const afterFingerprint = `sha256:${hash("c")}`;
  const mismatched = buildHCacheEvaluationAggregateV1(request({
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint: beforeFingerprint,
      afterContextFingerprint: afterFingerprint,
    },
    followup: {
      ...observation(afterFingerprint),
      cohort: { ...observation(afterFingerprint).cohort, repo: "other-repo" },
    },
  }));
  assert.deepEqual(mismatched.comparison, {
    schema: "h_cache_comparison_v1",
    status: "unavailable",
    reasonCode: "mixed_cohort",
  });
});

test("A9A-CACHE-CG4 rejects extra keys and Proxy input without exposing raw labels", () => {
  const secret = "never-echo-cache-cohort-secret";
  const extra = request({
    baseline: observation(undefined, {
      cohort: { ...observation().cohort, model: secret },
      unexpected: true,
    }),
  });
  for (const value of [extra, new Proxy(request(), {})]) {
    const result = buildHCacheEvaluationAggregateV1(value);
    assert.deepEqual(result.comparison, {
      schema: "h_cache_comparison_v1",
      status: "unavailable",
      reasonCode: "invalid_normalization",
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assertFrozenDeeply(result);
  }
});

test("A9A-CACHE-CG5 remains a deterministic non-DB cohort boundary", () => {
  const source = readFileSync(
    "src/lib/loop-jobs/harness-evaluation/harness-evaluation-cache-cohort-v1.ts",
    "utf8",
  );
  const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(executableSource, /^import \{ createHash \} from "node:crypto";/m);
  assert.doesNotMatch(
    executableSource,
    /(?:Prisma|DATABASE_URL|process\.|worker|scheduler|launchd|createLoopJobQueue|runOneDelivery|fetch\(|LLM)/,
  );

  const first = buildHCacheEvaluationAggregateV1(request());
  const second = buildHCacheEvaluationAggregateV1(request());
  assert.deepEqual(first, second);
});
