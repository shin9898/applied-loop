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

function identity(cadence = "daily", ordinal = 2, start = 2_000, end = 3_000, scopeHash = hash("a")) {
  return {
    policyVersion: "v1",
    cadence,
    scopeHash,
    periodHash: periodHash(cadence, ordinal, start, end),
    periodOrdinal: ordinal,
    periodStartEpochMs: start,
    periodEndEpochMs: end,
  };
}

function evidence(previousOutcome: "supported" | "ordinary_rejected" | "immediate_rejected" | "inconclusive" = "supported") {
  return {
    schema: "h_eval_evidence_v1",
    current: {
      identity: identity(),
      scheduler: {
        scheduledRunCount: 100,
        onTimeCompletedRunCount: 99,
        eventualIncompleteRunCount: 0,
      },
      usage: {
        attribution: "observed",
        budgetScope: "global",
        budgetWeekKeyHash: hash("c"),
        llmCalls: 0,
        freshInputTokens: 0,
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
    previous: {
      provenance: "caller_asserted_persisted",
      identity: identity("daily", 1, 1_000, 2_000),
      outcome: previousOutcome,
    },
  };
}

test("A3-CG3-T1 canonical-two-window-promotion", async (t) => {
  await t.test("promotes only the same eligible supported outcome with a caller-asserted adjacent prior window", () => {
    const consecutive = evidence("supported");
    const result = evaluateHEvalPolicyV1(consecutive);
    assert.equal(result.verdict, "supported");
    assert.equal(result.reasonCode, "eligible_window");
    assert.equal(result.decisionStage, "final");
    assert.equal(result.decisionBasis, "current_and_caller_asserted_prior");

    const priorInconclusive = evidence("inconclusive");
    assert.equal(evaluateHEvalPolicyV1(priorInconclusive).decisionStage, "provisional");

    const scopeChanged = evidence("supported");
    scopeChanged.previous.identity.scopeHash = hash("d");
    assert.equal(evaluateHEvalPolicyV1(scopeChanged).decisionStage, "provisional");

    const cadenceChanged = evidence("supported");
    cadenceChanged.previous.identity = identity("weekly", 1, 1_000, 2_000);
    assert.equal(evaluateHEvalPolicyV1(cadenceChanged).decisionStage, "provisional");

    const gap = evidence("supported");
    gap.previous.identity = identity("daily", 1, 1_000, 1_999);
    assert.equal(evaluateHEvalPolicyV1(gap).decisionStage, "provisional");

    const overlap = evidence("supported");
    overlap.previous.identity = identity("daily", 1, 1_000, 2_001);
    assert.equal(evaluateHEvalPolicyV1(overlap).decisionStage, "provisional");

    const repeatedOrdinal = evidence("supported");
    repeatedOrdinal.previous.identity = identity("daily", 2, 1_000, 2_000);
    assert.equal(evaluateHEvalPolicyV1(repeatedOrdinal).decisionStage, "provisional");
  });

  await t.test("accepts every closed cadence only for same-cadence adjacency", () => {
    for (const cadence of ["daily", "weekly", "monthly", "intervention_7d", "intervention_14d"] as const) {
      const input = evidence("supported");
      input.current.identity = identity(cadence, 2, 2_000, 3_000);
      input.previous.identity = identity(cadence, 1, 1_000, 2_000);
      const result = evaluateHEvalPolicyV1(input);
      assert.equal(result.verdict, "supported", cadence);
      assert.equal(result.decisionStage, "final", cadence);
      assert.equal(result.decisionBasis, "current_and_caller_asserted_prior", cadence);
    }
  });

  await t.test("promotes ordinary rejection only after the matching ordinary prior and never promotes inconclusive", () => {
    const ordinaryRejected = evidence("ordinary_rejected");
    ordinaryRejected.current.scheduler.eventualIncompleteRunCount = 1;
    ordinaryRejected.current.scheduler.onTimeCompletedRunCount = 98;
    const rejectedResult = evaluateHEvalPolicyV1(ordinaryRejected);
    assert.equal(rejectedResult.verdict, "rejected");
    assert.equal(rejectedResult.reasonCode, "evaluation_job_stalled");
    assert.equal(rejectedResult.decisionStage, "final");
    assert.equal(rejectedResult.decisionBasis, "current_and_caller_asserted_prior");

    const wrongOutcome = evidence("supported");
    wrongOutcome.current.scheduler.eventualIncompleteRunCount = 1;
    wrongOutcome.current.scheduler.onTimeCompletedRunCount = 98;
    assert.equal(evaluateHEvalPolicyV1(wrongOutcome).decisionStage, "provisional");

    const immediatePrior = evidence("immediate_rejected");
    immediatePrior.current.scheduler.eventualIncompleteRunCount = 1;
    immediatePrior.current.scheduler.onTimeCompletedRunCount = 98;
    assert.equal(evaluateHEvalPolicyV1(immediatePrior).decisionStage, "provisional");

    const onTimeMiss = evidence("supported");
    onTimeMiss.current.scheduler.onTimeCompletedRunCount = 98;
    const inconclusive = evaluateHEvalPolicyV1(onTimeMiss);
    assert.equal(inconclusive.reasonCode, "on_time_slo_missed");
    assert.equal(inconclusive.decisionStage, "provisional");
    assert.equal(inconclusive.decisionBasis, "current_aggregate_only");
  });

  await t.test("fails closed for a cross-policy identity instead of treating it as a provisional comparison", () => {
    const previousVersionChanged = evidence("supported");
    previousVersionChanged.previous.identity.policyVersion = "v2";
    assert.equal(evaluateHEvalPolicyV1(previousVersionChanged).reasonCode, "invalid_evidence");

    const currentVersionChanged = evidence("supported");
    currentVersionChanged.current.identity.policyVersion = "v2";
    assert.equal(evaluateHEvalPolicyV1(currentVersionChanged).reasonCode, "invalid_evidence");
  });

  await t.test("keeps immediate stops final without pretending a prior input supplied operational evidence", () => {
    const immediate = evidence("immediate_rejected");
    immediate.current.integrity.dataLossDetected = true;
    const result = evaluateHEvalPolicyV1(immediate);

    assert.equal(result.reasonCode, "data_loss");
    assert.equal(result.decisionStage, "final");
    assert.equal(result.decisionBasis, "current_aggregate_only");
    assert.equal(result.automaticInterventionAllowed, false);
  });
});
