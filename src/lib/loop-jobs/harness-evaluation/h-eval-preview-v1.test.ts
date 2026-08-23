import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createHEvalSchedulePayloadV1 } from "./h-eval-job-contract-v1";
import {
  fenceAndProjectHEvalPolicyResultV1,
  runHEvalPreviewV1,
} from "./h-eval-preview-v1";

const hash = (character: string) => character.repeat(64);

function periodHash(cadence: string, ordinal: number, start: number, end: number): string {
  return createHash("sha256")
    .update(JSON.stringify(["h_eval_period_v1", "v1", cadence, ordinal, start, end]), "utf8")
    .digest("hex");
}

function jobIdentity() {
  return {
    policyVersion: "v1",
    cadence: "daily",
    scopeHash: hash("a"),
    periodHash: periodHash("daily", 1, 1_000, 2_000),
    periodOrdinal: 1,
    periodStartEpochMs: 1_000,
    periodEndEpochMs: 2_000,
  };
}

function evidence() {
  return {
    schema: "h_eval_evidence_v1",
    current: {
      identity: jobIdentity(),
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

function request() {
  return {
    schema: "h_eval_preview_request_v1",
    jobIdentity: jobIdentity(),
    evidence: evidence(),
  };
}

test("A4-CG1-T1 closed-preview-request-envelope", () => {
  const input = request();
  const before = structuredClone(input);
  const result = runHEvalPreviewV1(input);

  assert.deepEqual(input, before);
  assert.deepEqual(result, {
    schema: "h_eval_preview_result_v1",
    mode: "dormant_preview_only",
    ok: true,
    code: "evaluated",
    automaticInterventionAllowed: false,
    policy: {
      verdict: "supported",
      decisionStage: "provisional",
      reasonCode: "eligible_window",
    },
  });

  const sentinel = "never-echo-preview-secret";
  const invalidInputs: unknown[] = [
    { ...request(), extra: sentinel },
    { schema: "h_eval_preview_request_v1", jobIdentity: jobIdentity() },
    [],
    new Date(),
  ];
  const accessor = request();
  Object.defineProperty(accessor, "jobIdentity", {
    enumerable: true,
    get() {
      return jobIdentity();
    },
  });
  invalidInputs.push(accessor);
  invalidInputs.push(new Proxy(request(), {
    ownKeys() {
      throw new Error(sentinel);
    },
  }));

  for (const invalid of invalidInputs) {
    const failed = runHEvalPreviewV1(invalid);
    assert.deepEqual(failed, {
      schema: "h_eval_preview_result_v1",
      mode: "dormant_preview_only",
      ok: false,
      code: "invalid_request",
      automaticInterventionAllowed: false,
    });
    assert.equal(JSON.stringify(failed).includes(sentinel), false);
  }
});

function assertFrozenDeeply(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A4-CG2-T1 pinned-A3-delegation-and-identity-fence", () => {
  const scheduled = createHEvalSchedulePayloadV1(jobIdentity());
  assert.equal(scheduled.ok, true);
  if (!scheduled.ok) return;

  const policyIdentity = {
    policyVersion: scheduled.payload.policyVersion,
    cadence: scheduled.payload.cadence,
    scopeHash: scheduled.payload.scopeHash,
    periodHash: scheduled.payload.periodHash,
  };
  const tuples = [
    ["rejected", "final", "privacy_violation"],
    ["rejected", "final", "data_loss"],
    ["rejected", "final", "duplicate_finding"],
    ["rejected", "final", "budget_exhausted"],
    ["inconclusive", "provisional", "usage_unavailable"],
    ["rejected", "provisional", "evaluation_job_stalled"],
    ["rejected", "final", "evaluation_job_stalled"],
    ["rejected", "provisional", "low_precision"],
    ["rejected", "final", "low_precision"],
    ["inconclusive", "provisional", "no_scheduled_runs"],
    ["inconclusive", "provisional", "on_time_slo_missed"],
    ["supported", "provisional", "eligible_window"],
    ["supported", "final", "eligible_window"],
  ] as const;

  for (const [verdict, decisionStage, reasonCode] of tuples) {
    const result = fenceAndProjectHEvalPolicyResultV1(scheduled.payload, {
      identity: policyIdentity,
      verdict,
      decisionStage,
      reasonCode,
    });
    assert.deepEqual(result, {
      schema: "h_eval_preview_result_v1",
      mode: "dormant_preview_only",
      ok: true,
      code: "evaluated",
      automaticInterventionAllowed: false,
      policy: { verdict, decisionStage, reasonCode },
    });
    assertFrozenDeeply(result);
  }

  const identityGetterMustNotRun = {
    reasonCode: "invalid_evidence",
  } as Record<string, unknown>;
  Object.defineProperty(identityGetterMustNotRun, "identity", {
    enumerable: true,
    get() {
      throw new Error("identity must not be read after invalid_evidence");
    },
  });
  assert.equal(
    fenceAndProjectHEvalPolicyResultV1(scheduled.payload, identityGetterMustNotRun).code,
    "invalid_evidence",
  );
  assert.equal(fenceAndProjectHEvalPolicyResultV1(scheduled.payload, {}).code, "identity_mismatch");

  for (const field of ["policyVersion", "cadence", "scopeHash", "periodHash"] as const) {
    const changed = { ...policyIdentity, [field]: field === "cadence" ? "weekly" : hash("z") };
    const result = fenceAndProjectHEvalPolicyResultV1(scheduled.payload, {
      identity: changed,
      verdict: "supported",
      decisionStage: "provisional",
      reasonCode: "eligible_window",
    });
    assert.equal(result.code, "identity_mismatch");
    assert.equal("policy" in result, false);
  }

  const disallowed = fenceAndProjectHEvalPolicyResultV1(scheduled.payload, {
    identity: policyIdentity,
    verdict: "supported",
    decisionStage: "final",
    reasonCode: "privacy_violation",
  });
  assert.equal(disallowed.code, "internal_error");
  assert.equal("policy" in disallowed, false);

  const coercionSentinel = "never-coerce-or-copy-policy-object";
  const coercingVerdict = {
    [Symbol.toPrimitive]() {
      return "supported";
    },
    toJSON() {
      return coercionSentinel;
    },
  };
  for (const [verdict, decisionStage, reasonCode] of [
    [coercingVerdict, "provisional", "eligible_window"],
    [new String("supported"), "provisional", "eligible_window"],
    ["supported", new String("provisional"), "eligible_window"],
    ["supported", "provisional", new String("eligible_window")],
  ] as const) {
    const result = fenceAndProjectHEvalPolicyResultV1(scheduled.payload, {
      identity: policyIdentity,
      verdict,
      decisionStage,
      reasonCode,
    });
    assert.equal(result.code, "internal_error");
    assert.equal("policy" in result, false);
    assert.equal(JSON.stringify(result).includes(coercionSentinel), false);
    assertFrozenDeeply(result);
  }

  const production = runHEvalPreviewV1(request());
  assert.equal(production.code, "evaluated");
  assert.equal(production.ok, true);

  const malformedJob = request();
  malformedJob.jobIdentity.scopeHash = "not-a-hash";
  assert.equal(runHEvalPreviewV1(malformedJob).code, "invalid_job_identity");
});

test("A4-CG3-T1 hostile-direct-kernel-objects", () => {
  assert.equal(runHEvalPreviewV1(new Proxy(request(), {})).code, "evaluated");

  const sentinel = "never-echo-hostile-kernel-secret";
  const rootAccessor = request();
  Object.defineProperty(rootAccessor, "evidence", {
    enumerable: true,
    get() {
      throw new Error(sentinel);
    },
  });
  const throwingRoot = new Proxy(request(), {
    getPrototypeOf() {
      throw new Error(sentinel);
    },
  });
  const jobAccessor = request();
  Object.defineProperty(jobAccessor.jobIdentity, "scopeHash", {
    enumerable: true,
    get() {
      throw new Error(sentinel);
    },
  });
  const evidenceAccessor = request();
  Object.defineProperty(evidenceAccessor.evidence.current.scheduler, "scheduledRunCount", {
    enumerable: true,
    get() {
      throw new Error(sentinel);
    },
  });
  const jobTrap = request();
  jobTrap.jobIdentity = new Proxy(jobTrap.jobIdentity, {
    ownKeys() {
      throw new Error(sentinel);
    },
  });
  const evidenceTrap = request();
  evidenceTrap.evidence = new Proxy(evidenceTrap.evidence, {
    ownKeys() {
      throw new Error(sentinel);
    },
  });

  const cases: Array<[unknown, string]> = [
    [rootAccessor, "invalid_request"],
    [throwingRoot, "invalid_request"],
    [jobAccessor, "invalid_job_identity"],
    [jobTrap, "invalid_job_identity"],
    [evidenceAccessor, "invalid_evidence"],
    [evidenceTrap, "invalid_evidence"],
  ];
  for (const [input, code] of cases) {
    const result = runHEvalPreviewV1(input);
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal("policy" in result, false);
  }
});
