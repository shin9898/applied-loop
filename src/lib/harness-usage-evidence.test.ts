import assert from "node:assert/strict";
import test from "node:test";

import {
  readSupportedStoredHarnessUsage,
  projectHarnessUsageEvidence,
  type HarnessUsageEvidence,
} from "./harness-usage-evidence";
import { aggregateRepoCacheReadRates } from "./harness-stats";

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

test("A5-CG1-T3 accepts only semantically consistent normalized stored evidence", () => {
  const supported = {
    inputTotalTokens: 100,
    inputUncachedTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: null,
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
  };
  assert.deepEqual(readSupportedStoredHarnessUsage(supported), {
    inputTotalTokens: 100,
    inputUncachedTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: null,
  });

  assert.equal(
    readSupportedStoredHarnessUsage({
      ...supported,
      inputUncachedTokens: 19,
    }),
    null,
  );
  assert.equal(
    readSupportedStoredHarnessUsage({
      ...supported,
      usageSemanticsVersion: "legacy",
    }),
    null,
  );
  assert.equal(
    readSupportedStoredHarnessUsage({
      ...supported,
      usageNormalizationStatus: "no_sample",
      inputTotalTokens: 0,
      inputUncachedTokens: 0,
      cacheReadTokens: 0,
    }),
    null,
  );
});

test("A9-D4 aggregates only normalized evidence and keeps Codex cache reads single-counted", () => {
  const now = new Date("2026-08-26T03:00:00.000Z");
  const supported = {
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
  } as const;
  const rates = aggregateRepoCacheReadRates(
    [
      {
        repo: "applied-loop",
        startedAt: new Date("2026-08-17T00:00:00.000Z"),
        inputTotalTokens: 100,
        inputUncachedTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        ...supported,
      },
      {
        repo: "applied-loop",
        startedAt: new Date("2026-08-25T00:00:00.000Z"),
        inputTotalTokens: 100,
        inputUncachedTokens: 50,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        ...supported,
      },
      {
        repo: "applied-loop",
        startedAt: new Date("2026-08-25T01:00:00.000Z"),
        inputTotalTokens: null,
        inputUncachedTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        usageSemanticsVersion: null,
        usageNormalizationStatus: null,
      },
      {
        repo: "raw-only",
        startedAt: new Date("2026-08-25T02:00:00.000Z"),
        inputTotalTokens: null,
        inputUncachedTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        usageSemanticsVersion: null,
        usageNormalizationStatus: null,
      },
    ],
    now,
    { minTokens: 1, take: 10 },
  );

  assert.deepEqual(rates, [
    {
      repo: "applied-loop",
      thisWeekRate: 0.4,
      lastWeekRate: 0.8,
      thisWeekTokens: 100,
      lastWeekTokens: 100,
      declineRatio: 0.5,
      insufficientThisWeek: false,
    },
  ]);
});
