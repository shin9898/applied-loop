import assert from "node:assert/strict";
import test from "node:test";

import {
  projectHarnessUsageEvidence,
  type HarnessUsageEvidence,
} from "./harness-usage-evidence";

function evidence(overrides: Partial<HarnessUsageEvidence> = {}): HarnessUsageEvidence {
  return {
    inputTotalTokens: null,
    inputUncachedTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
    usageNormalizationReason: null,
    ...overrides,
  };
}

test("A5-CG1-T1 projects provider-aware usage evidence without mutating raw counters", () => {
  const claudeRaw = Object.freeze({
    harness: "claude",
    tokensIn: 10,
    cacheRead: 30,
    cacheCreate: 10,
  });
  const claudeBefore = { ...claudeRaw };
  assert.deepEqual(
    projectHarnessUsageEvidence(claudeRaw),
    evidence({
      inputTotalTokens: 50,
      inputUncachedTokens: 10,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    }),
  );
  assert.deepEqual(claudeRaw, claudeBefore);

  assert.deepEqual(
    projectHarnessUsageEvidence({
      harness: "codex",
      tokensIn: 100,
      cacheRead: 80,
      cacheCreate: 0,
    }),
    evidence({
      inputTotalTokens: 100,
      inputUncachedTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: null,
    }),
  );
});

test("A5-CG1-T2 makes zero, invalid, and unsupported telemetry distinguishable from legacy null", () => {
  assert.deepEqual(
    projectHarnessUsageEvidence({
      harness: "claude",
      tokensIn: 0,
      cacheRead: 0,
      cacheCreate: 0,
    }),
    evidence({
      inputTotalTokens: 0,
      inputUncachedTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      usageNormalizationStatus: "no_sample",
      usageNormalizationReason: "zero_total",
    }),
  );

  assert.deepEqual(
    projectHarnessUsageEvidence({
      harness: "codex",
      tokensIn: 0,
      cacheRead: 0,
      cacheCreate: 0,
    }),
    evidence({
      inputTotalTokens: 0,
      inputUncachedTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: null,
      usageNormalizationStatus: "no_sample",
      usageNormalizationReason: "zero_total",
    }),
  );

  assert.deepEqual(
    projectHarnessUsageEvidence({
      harness: "codex",
      tokensIn: 10,
      cacheRead: 11,
      cacheCreate: 0,
    }),
    evidence({
      usageNormalizationStatus: "invalid",
      usageNormalizationReason: "cache_read_exceeds_total",
    }),
  );

  assert.deepEqual(
    projectHarnessUsageEvidence({
      harness: "codex",
      tokensIn: 10,
      cacheRead: 0,
      cacheCreate: 1,
    }),
    evidence({
      usageNormalizationStatus: "unsupported",
      usageNormalizationReason: "unsupported_usage_semantics",
    }),
  );
});
