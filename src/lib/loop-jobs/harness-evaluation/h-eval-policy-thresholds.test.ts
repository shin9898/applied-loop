import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { evaluateHEvalPolicyV1 } from "./h-eval-policy-v1";

const hash = (character: string) => character.repeat(64);

function periodHash(cadence: string, ordinal: number, start: number, end: number) {
  return createHash("sha256")
    .update(JSON.stringify(["h_eval_period_v1", "v1", cadence, ordinal, start, end]), "utf8")
    .digest("hex");
}

function evidence() {
  return {
    schema: "h_eval_evidence_v1",
    current: {
      identity: {
        policyVersion: "v1",
        cadence: "weekly",
        scopeHash: hash("a"),
        periodHash: periodHash("weekly", 4, 4_000, 5_000),
        periodOrdinal: 4,
        periodStartEpochMs: 4_000,
        periodEndEpochMs: 5_000,
      },
      scheduler: {
        scheduledRunCount: 100,
        onTimeCompletedRunCount: 99,
        eventualIncompleteRunCount: 0,
      },
      usage: {
        attribution: "observed",
        budgetScope: "global",
        budgetWeekKeyHash: hash("c"),
        llmCalls: 5,
        freshInputTokens: 50_000,
      },
      findings: {
        duplicateFindingCount: 0,
        acceptedFindingCount: 2,
        ignoredFindingCount: 2,
      },
      integrity: {
        privacyViolationCount: 0,
        dataLossDetected: false,
      },
    },
    previous: null,
  };
}

function reason(input: unknown) {
  return evaluateHEvalPolicyV1(input).reasonCode;
}

test("A3-CG2-T1 h-eval-v1-thresholds-and-precedence", async (t) => {
  await t.test("uses exact ES2017-safe boundaries without granting intervention authority", () => {
    const onTimePass = evidence();
    assert.equal(reason(onTimePass), "eligible_window");

    const onTimeMiss = evidence();
    onTimeMiss.current.scheduler.onTimeCompletedRunCount = 98;
    assert.equal(reason(onTimeMiss), "on_time_slo_missed");

    const nonRoundPass = evidence();
    nonRoundPass.current.scheduler.scheduledRunCount = 101;
    nonRoundPass.current.scheduler.onTimeCompletedRunCount = 100;
    assert.equal(reason(nonRoundPass), "eligible_window");

    const callsOver = evidence();
    callsOver.current.usage.llmCalls = 6;
    assert.equal(reason(callsOver), "budget_exhausted");

    const tokensOver = evidence();
    tokensOver.current.usage.freshInputTokens = 50_001;
    assert.equal(reason(tokensOver), "budget_exhausted");

    const lowPrecision = evidence();
    lowPrecision.current.findings.acceptedFindingCount = 1;
    lowPrecision.current.findings.ignoredFindingCount = 3;
    assert.equal(reason(lowPrecision), "low_precision");

    const maxSafePass = evidence();
    const maximum = Number.MAX_SAFE_INTEGER;
    maxSafePass.current.scheduler.scheduledRunCount = maximum;
    maxSafePass.current.scheduler.onTimeCompletedRunCount = maximum - Math.floor(maximum / 100);
    assert.equal(reason(maxSafePass), "eligible_window");

    const maxSafeMiss = evidence();
    maxSafeMiss.current.scheduler.scheduledRunCount = maximum;
    maxSafeMiss.current.scheduler.onTimeCompletedRunCount = maximum - Math.floor(maximum / 100) - 1;
    assert.equal(reason(maxSafeMiss), "on_time_slo_missed");

    for (const input of [onTimePass, onTimeMiss, nonRoundPass, callsOver, tokensOver, lowPrecision, maxSafePass, maxSafeMiss]) {
      assert.equal(evaluateHEvalPolicyV1(input).automaticInterventionAllowed, false);
    }
  });

  await t.test("applies the complete immediate, unavailable, ordinary, and inconclusive precedence order", () => {
    const invalidBeforePrivacy = evidence() as Record<string, unknown>;
    (invalidBeforePrivacy.current as { integrity: { privacyViolationCount: number } }).integrity.privacyViolationCount = 1;
    invalidBeforePrivacy.extra = "invalid-first";
    assert.equal(reason(invalidBeforePrivacy), "invalid_evidence");

    const privacy = evidence();
    privacy.current.integrity.privacyViolationCount = 1;
    privacy.current.integrity.dataLossDetected = true;
    privacy.current.findings.duplicateFindingCount = 1;
    privacy.current.usage.llmCalls = 6;
    assert.equal(reason(privacy), "privacy_violation");

    const dataLoss = evidence();
    dataLoss.current.integrity.dataLossDetected = true;
    dataLoss.current.findings.duplicateFindingCount = 1;
    dataLoss.current.usage.llmCalls = 6;
    assert.equal(reason(dataLoss), "data_loss");

    const duplicate = evidence();
    duplicate.current.findings.duplicateFindingCount = 1;
    duplicate.current.usage.llmCalls = 6;
    assert.equal(reason(duplicate), "duplicate_finding");

    const budget = evidence();
    budget.current.usage.llmCalls = 6;
    budget.current.scheduler.eventualIncompleteRunCount = 1;
    assert.equal(reason(budget), "budget_exhausted");

    const unavailable = evidence();
    unavailable.current.usage = { attribution: "unavailable" } as never;
    unavailable.current.scheduler.eventualIncompleteRunCount = 1;
    unavailable.current.findings.acceptedFindingCount = 1;
    unavailable.current.findings.ignoredFindingCount = 3;
    assert.equal(reason(unavailable), "usage_unavailable");

    const stalled = evidence();
    stalled.current.scheduler.eventualIncompleteRunCount = 1;
    stalled.current.scheduler.onTimeCompletedRunCount = 98;
    stalled.current.findings.acceptedFindingCount = 1;
    stalled.current.findings.ignoredFindingCount = 3;
    assert.equal(reason(stalled), "evaluation_job_stalled");

    const noScheduled = evidence();
    noScheduled.current.scheduler = {
      scheduledRunCount: 0,
      onTimeCompletedRunCount: 0,
      eventualIncompleteRunCount: 0,
    };
    assert.equal(reason(noScheduled), "no_scheduled_runs");
  });

  await t.test("covers every validly representable simultaneous-condition precedence pair", () => {
    type Condition =
      | "invalid_evidence"
      | "privacy_violation"
      | "data_loss"
      | "duplicate_finding"
      | "budget_exhausted"
      | "usage_unavailable"
      | "evaluation_job_stalled"
      | "low_precision"
      | "no_scheduled_runs"
      | "on_time_slo_missed";
    const conditions: readonly Condition[] = [
      "invalid_evidence",
      "privacy_violation",
      "data_loss",
      "duplicate_finding",
      "budget_exhausted",
      "usage_unavailable",
      "evaluation_job_stalled",
      "low_precision",
      "no_scheduled_runs",
      "on_time_slo_missed",
    ];
    const incompatible = new Set([
      "budget_exhausted|usage_unavailable",
      "evaluation_job_stalled|no_scheduled_runs",
      "no_scheduled_runs|on_time_slo_missed",
    ]);
    const keyFor = (left: Condition, right: Condition) => [left, right].sort().join("|");
    const apply = (input: ReturnType<typeof evidence>, condition: Condition) => {
      switch (condition) {
        case "invalid_evidence":
          (input as unknown as Record<string, unknown>).unexpected = "invalid";
          break;
        case "privacy_violation":
          input.current.integrity.privacyViolationCount = 1;
          break;
        case "data_loss":
          input.current.integrity.dataLossDetected = true;
          break;
        case "duplicate_finding":
          input.current.findings.duplicateFindingCount = 1;
          break;
        case "budget_exhausted":
          input.current.usage.llmCalls = 6;
          break;
        case "usage_unavailable":
          input.current.usage = { attribution: "unavailable" } as never;
          break;
        case "evaluation_job_stalled":
          input.current.scheduler.eventualIncompleteRunCount = 1;
          break;
        case "low_precision":
          input.current.findings.acceptedFindingCount = 1;
          input.current.findings.ignoredFindingCount = 3;
          break;
        case "no_scheduled_runs":
          input.current.scheduler = {
            scheduledRunCount: 0,
            onTimeCompletedRunCount: 0,
            eventualIncompleteRunCount: 0,
          };
          break;
        case "on_time_slo_missed":
          input.current.scheduler.onTimeCompletedRunCount = 98;
          break;
      }
    };

    let testedPairs = 0;
    for (let leftIndex = 0; leftIndex < conditions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < conditions.length; rightIndex += 1) {
        const left = conditions[leftIndex];
        const right = conditions[rightIndex];
        if (incompatible.has(keyFor(left, right))) continue;
        const input = evidence();
        apply(input, left);
        apply(input, right);
        const result = evaluateHEvalPolicyV1(input);
        assert.equal(result.reasonCode, left, `${left} before ${right}`);
        assert.equal(result.automaticInterventionAllowed, false, `${left} before ${right}`);
        testedPairs += 1;
      }
    }
    assert.equal(testedPairs, 42);

    const unavailableAndBudget = evidence();
    unavailableAndBudget.current.usage = { attribution: "unavailable", llmCalls: 6 } as never;
    assert.equal(reason(unavailableAndBudget), "invalid_evidence");

    const zeroScheduledAndStalled = evidence();
    zeroScheduledAndStalled.current.scheduler = {
      scheduledRunCount: 0,
      onTimeCompletedRunCount: 0,
      eventualIncompleteRunCount: 1,
    };
    assert.equal(reason(zeroScheduledAndStalled), "invalid_evidence");

    const zeroScheduledAndOnTimeMiss = evidence();
    zeroScheduledAndOnTimeMiss.current.scheduler = {
      scheduledRunCount: 0,
      onTimeCompletedRunCount: 1,
      eventualIncompleteRunCount: 0,
    };
    assert.equal(reason(zeroScheduledAndOnTimeMiss), "invalid_evidence");
  });
});
