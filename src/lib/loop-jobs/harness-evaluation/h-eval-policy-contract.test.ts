import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { evaluateHEvalPolicyV1, H_EVAL_POLICY_VERSION } from "./h-eval-policy-v1";

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
        cadence: "daily",
        scopeHash: hash("a"),
        periodHash: periodHash("daily", 1, 1_000, 2_000),
        periodOrdinal: 1,
        periodStartEpochMs: 1_000,
        periodEndEpochMs: 2_000,
      },
      scheduler: {
        scheduledRunCount: 1,
        onTimeCompletedRunCount: 1,
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
        acceptedFindingCount: 0,
        ignoredFindingCount: 0,
      },
      integrity: {
        privacyViolationCount: 0,
        dataLossDetected: false,
      },
    },
    previous: null,
  };
}

function assertFrozenDeeply(value: object) {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A3-CG1-T1 closed-h-eval-evidence-and-result-contract", async (t) => {
  await t.test("accepts only the closed aggregate evidence shape without mutating it", () => {
    assert.equal(H_EVAL_POLICY_VERSION, "v1");
    const input = evidence();
    const before = structuredClone(input);
    const result = evaluateHEvalPolicyV1(input);

    assert.deepEqual(input, before);
    assert.deepEqual(result, {
      schema: "h_eval_policy_result_v1",
      mode: "dormant_policy_only",
      identity: {
        policyVersion: "v1",
        cadence: "daily",
        scopeHash: hash("a"),
        periodHash: periodHash("daily", 1, 1_000, 2_000),
      },
      verdict: "supported",
      decisionStage: "provisional",
      decisionBasis: "current_aggregate_only",
      reasonCode: "eligible_window",
      automaticInterventionAllowed: false,
    });
    assertFrozenDeeply(result);
  });

  await t.test("fails closed without throwing, logging, or echoing rejected values", () => {
    const sentinel = "do-not-echo-secret-h-eval";
    const invalidInputs: unknown[] = [];

    invalidInputs.push({ ...evidence(), secret: sentinel });
    invalidInputs.push([]);
    invalidInputs.push(() => undefined);
    invalidInputs.push(new Date());

    for (const path of ["identity", "scheduler", "usage", "findings", "integrity"] as const) {
      const nestedExtra = evidence();
      (nestedExtra.current[path] as unknown as Record<string, unknown>).secret = sentinel;
      invalidInputs.push(nestedExtra);
    }

    const priorExtra = evidence();
    priorExtra.previous = {
      provenance: "caller_asserted_persisted",
      identity: {
        policyVersion: "v1",
        cadence: "daily",
        scopeHash: hash("a"),
        periodHash: periodHash("daily", 0, 0, 1_000),
        periodOrdinal: 0,
        periodStartEpochMs: 0,
        periodEndEpochMs: 1_000,
      },
      outcome: "supported",
      secret: sentinel,
    } as never;
    invalidInputs.push(priorExtra);

    const accessor = evidence();
    Object.defineProperty(accessor.current.scheduler, "scheduledRunCount", {
      enumerable: true,
      get() {
        return 1;
      },
    });
    invalidInputs.push(accessor);

    const withSymbol = evidence();
    Object.defineProperty(withSymbol.current, Symbol("secret"), { enumerable: true, value: sentinel });
    invalidInputs.push(withSymbol);

    const withNonEnumerable = evidence();
    Object.defineProperty(withNonEnumerable.current, "privateMetric", { enumerable: false, value: sentinel });
    invalidInputs.push(withNonEnumerable);

    const negativeZero = evidence();
    negativeZero.current.scheduler.scheduledRunCount = -0;
    invalidInputs.push(negativeZero);

    for (const invalidNumber of [NaN, Infinity, "1", new Number(1)]) {
      const malformedNumber = evidence();
      malformedNumber.current.scheduler.scheduledRunCount = invalidNumber as never;
      invalidInputs.push(malformedNumber);
    }

    const nestedDate = evidence();
    nestedDate.current.identity = new Date() as never;
    invalidInputs.push(nestedDate);

    const findingsOverflow = evidence();
    findingsOverflow.current.findings.acceptedFindingCount = Number.MAX_SAFE_INTEGER;
    findingsOverflow.current.findings.ignoredFindingCount = 1;
    invalidInputs.push(findingsOverflow);

    invalidInputs.push(new Proxy(evidence(), {
      ownKeys() {
        throw new Error(sentinel);
      },
    }));

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => calls.push(args);
    console.warn = (...args: unknown[]) => calls.push(args);
    console.error = (...args: unknown[]) => calls.push(args);
    try {
      for (const input of invalidInputs) {
        let result: ReturnType<typeof evaluateHEvalPolicyV1> | undefined;
        assert.doesNotThrow(() => {
          result = evaluateHEvalPolicyV1(input);
        });
        assert.deepEqual(result, {
          schema: "h_eval_policy_result_v1",
          mode: "dormant_policy_only",
          verdict: "inconclusive",
          decisionStage: "provisional",
          decisionBasis: "current_aggregate_only",
          reasonCode: "invalid_evidence",
          automaticInterventionAllowed: false,
        });
        assertFrozenDeeply(result as object);
        assert.equal(JSON.stringify(result).includes(sentinel), false);
      }
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
    assert.deepEqual(calls, []);
  });

  await t.test("does not mutate a caller-asserted previous snapshot", () => {
    const input = evidence();
    input.previous = {
      provenance: "caller_asserted_persisted",
      identity: {
        policyVersion: "v1",
        cadence: "daily",
        scopeHash: hash("a"),
        periodHash: periodHash("daily", 0, 0, 1_000),
        periodOrdinal: 0,
        periodStartEpochMs: 0,
        periodEndEpochMs: 1_000,
      },
      outcome: "supported",
    } as never;
    const before = structuredClone(input);
    const result = evaluateHEvalPolicyV1(input);

    assert.deepEqual(input, before);
    assert.equal(result.decisionStage, "final");
    assert.equal(result.decisionBasis, "current_and_caller_asserted_prior");
  });

  await t.test("allows a transparent Proxy but returns fresh independent frozen results", () => {
    const input = new Proxy(evidence(), {});
    const first = evaluateHEvalPolicyV1(input);
    const second = evaluateHEvalPolicyV1(input);

    assert.equal(first.reasonCode, "eligible_window");
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.identity, second.identity);
    assertFrozenDeeply(first);
    assertFrozenDeeply(second);
  });
});
