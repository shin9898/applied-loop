import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateHCycleEvidencePolicyV1,
  H_CYCLE_COHORT_KINDS_V1,
  projectHCycleEvidenceV1,
  type EvidenceRate,
  type HCycleEvidenceProjectionV1,
  type HCycleGateStateEventV1,
} from "./h-cycle-projection";

const at = (value: string) => new Date(value);

function period() {
  return {
    weekKey: "2026-W33",
    start: at("2026-08-09T15:00:00.000Z"),
    end: at("2026-08-16T15:00:00.000Z"),
    asOf: at("2026-08-16T15:00:00.000Z"),
  };
}

function failedGateInput(capture: Record<string, unknown> | null = null, followup: Record<string, unknown> | null = null) {
  return {
    period: period(),
    sourceRevisions: [
      {
        sourceKind: "daily" as const,
        textbookKey: "2026-08-10",
        source: "auto" as const,
        checkIndex: 0,
        sourceRevisionHash: "b".repeat(64),
        firstObservedAt: at("2026-08-10T00:10:00.000Z"),
        masteryEvents: [
          { mastery: "partial" as const, recordedAt: at("2026-08-10T00:20:00.000Z") },
        ],
      },
    ],
    promotions: [
      {
        gateId: "gate-2",
        sourceKind: "daily" as const,
        textbookKey: "2026-08-10",
        source: "auto" as const,
        checkIndex: 0,
        sourceRevisionHash: "b".repeat(64),
        originCreatedAt: at("2026-08-10T01:00:00.000Z"),
      },
    ],
    gateStateEvents: [
      { id: "failed-state-1", gateId: "gate-2", ordinal: 1, status: "answered" as const, recordedAt: at("2026-08-10T01:10:00.000Z") },
      { id: "failed-state-2", gateId: "gate-2", ordinal: 2, status: "grading" as const, recordedAt: at("2026-08-10T01:11:00.000Z") },
      { id: "failed-state-3", gateId: "gate-2", ordinal: 3, status: "failed" as const, recordedAt: at("2026-08-10T01:12:00.000Z") },
    ],
    failureCaptures: capture === null ? [] : [
      {
        id: "failure-capture-1",
        failedStateEventId: "failed-state-3",
        captureId: "capture-1",
        capturedAt: at("2026-08-10T01:13:00.000Z"),
        sourceTool: "gate",
        parsedGateId: "gate-2",
        status: "accepted" as const,
        reviewedAt: at("2026-08-10T01:14:00.000Z"),
        misconceptionId: "misconception-1",
        ...capture,
      },
    ],
    followupObservations: followup === null ? [] : [
      {
        id: "followup-1",
        failureCaptureId: "failure-capture-1",
        misconceptionId: "misconception-1",
        scheduledFor: at("2026-08-13T01:14:00.000Z"),
        observedAt: at("2026-08-10T01:15:00.000Z"),
        ...followup,
      },
    ],
  };
}

test("A7B-CG1-T1 reconstructs a historical Gate state from append-only events, not a later resubmit", () => {
  const common = {
    sourceRevisions: [
      {
        sourceKind: "daily" as const,
        textbookKey: "2026-08-10",
        source: "auto" as const,
        checkIndex: 0,
        sourceRevisionHash: "a".repeat(64),
        firstObservedAt: at("2026-08-10T00:10:00.000Z"),
        masteryEvents: [
          { mastery: "partial" as const, recordedAt: at("2026-08-10T00:20:00.000Z") },
        ],
      },
    ],
    promotions: [
      {
        gateId: "gate-1",
        sourceKind: "daily" as const,
        textbookKey: "2026-08-10",
        source: "auto" as const,
        checkIndex: 0,
        sourceRevisionHash: "a".repeat(64),
        originCreatedAt: at("2026-08-10T01:00:00.000Z"),
      },
    ],
    gateStateEvents: [
      { id: "state-1", gateId: "gate-1", ordinal: 1, status: "answered" as const, recordedAt: at("2026-08-10T01:10:00.000Z") },
      { id: "state-2", gateId: "gate-1", ordinal: 2, status: "grading" as const, recordedAt: at("2026-08-10T01:11:00.000Z") },
      { id: "state-3", gateId: "gate-1", ordinal: 3, status: "failed" as const, recordedAt: at("2026-08-10T01:12:00.000Z") },
      { id: "state-4", gateId: "gate-1", ordinal: 4, status: "answered" as const, recordedAt: at("2026-08-17T01:10:00.000Z") },
      { id: "state-5", gateId: "gate-1", ordinal: 5, status: "grading" as const, recordedAt: at("2026-08-17T01:11:00.000Z") },
      { id: "state-6", gateId: "gate-1", ordinal: 6, status: "passed" as const, recordedAt: at("2026-08-17T01:12:00.000Z") },
    ],
    failureCaptures: [],
    followupObservations: [],
  };

  const historical = projectHCycleEvidenceV1({
    ...common,
    period: {
      weekKey: "2026-W33",
      start: at("2026-08-09T15:00:00.000Z"),
      end: at("2026-08-16T15:00:00.000Z"),
      asOf: at("2026-08-16T15:00:00.000Z"),
    },
  });

  assert.deepEqual(historical.gradedPromotedGateRate, {
    status: "measured",
    numerator: 1,
    denominator: 1,
    ratio: 1,
  });
  assert.deepEqual(historical.evidenceClosureRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "missing_gate_capture",
  });
});

test("A7B-CG1-T2 measures a direct accepted Capture only when its follow-up observation is present", () => {
  const projection = projectHCycleEvidenceV1(failedGateInput({}, {}));

  assert.deepEqual(projection.failedTriageRate, {
    status: "measured",
    numerator: 1,
    denominator: 1,
    ratio: 1,
  });
  assert.deepEqual(projection.scheduledFollowupRate, {
    status: "measured",
    numerator: 1,
    denominator: 1,
    ratio: 1,
  });
  assert.deepEqual(projection.evidenceClosureRate, {
    status: "measured",
    numerator: 1,
    denominator: 1,
    ratio: 1,
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.evidenceClosureRate), true);
  assert.equal(projection.cohortKinds.failedTriageRate, "as_of_verified_failed_state_event");
});

test("A7B-CG1-T3 leaves pending and ignored failed-Capture paths incomplete instead of counting closure", () => {
  const pending = projectHCycleEvidenceV1(
    failedGateInput({ status: "pending", reviewedAt: null }, null),
  );
  assert.deepEqual(pending.failedTriageRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "pending_capture",
  });
  assert.deepEqual(pending.scheduledFollowupRate, {
    status: "not_applicable",
    numerator: 0,
    denominator: 0,
    reason: "zero_denominator",
  });
  assert.deepEqual(pending.evidenceClosureRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "pending_capture",
  });

  const ignored = projectHCycleEvidenceV1(
    failedGateInput({ status: "ignored", reviewedAt: at("2026-08-10T01:14:00.000Z"), misconceptionId: null }, null),
  );
  assert.deepEqual(ignored.failedTriageRate, {
    status: "measured",
    numerator: 1,
    denominator: 1,
    ratio: 1,
  });
  assert.deepEqual(ignored.evidenceClosureRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "ignored_capture",
  });
});

test("A7B-CG1-T4 preserves zero denominators as not_applicable", () => {
  const projection = projectHCycleEvidenceV1({
    period: period(),
    sourceRevisions: [],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  });

  for (const rate of [
    projection.selfAssessmentRate,
    projection.explicitPromotionRate,
    projection.answeredPromotedGateRate,
    projection.gradedPromotedGateRate,
    projection.failedTriageRate,
    projection.scheduledFollowupRate,
    projection.evidenceClosureRate,
  ]) {
    assert.deepEqual(rate, {
      status: "not_applicable",
      numerator: 0,
      denominator: 0,
      reason: "zero_denominator",
    });
  }
  assert.deepEqual(projection.actionableCheckCount, { status: "measured", count: 0 });
});

test("A7B-CG1-T7 rejects a week key that does not name the supplied JST week", () => {
  assert.throws(
    () => projectHCycleEvidenceV1({
      period: { ...period(), weekKey: "2026-W01" },
      sourceRevisions: [],
      promotions: [],
      gateStateEvents: [],
      failureCaptures: [],
      followupObservations: [],
    }),
    /invalid_h_cycle_period_week_key/,
  );
});

test("A7B-CG1-T8 keeps an observed revision in the self-assessment cohort when its mastery history is invalid", () => {
  const projection = projectHCycleEvidenceV1({
    period: period(),
    sourceRevisions: [
      {
        sourceKind: "daily",
        textbookKey: "2026-08-10",
        source: "auto",
        checkIndex: 0,
        sourceRevisionHash: "c".repeat(64),
        firstObservedAt: at("2026-08-10T00:10:00.000Z"),
        masteryEvents: [
          { mastery: "partial", recordedAt: at("2026-08-10T00:09:59.000Z") },
        ],
      },
    ],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  });

  assert.deepEqual(projection.selfAssessmentRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "invalid_mastery_event",
  });
  assert.equal(projection.diagnostics.invalid_mastery_event, 1);
});

test("A7B-CG1-T15 ignores evidence recorded after asOf, including malformed future rows", () => {
  const baseline = projectHCycleEvidenceV1(failedGateInput({}, {}));
  const input = failedGateInput({}, {});
  input.sourceRevisions.push({
    sourceKind: "unknown" as never,
    textbookKey: "2026-08-17",
    source: "unknown" as never,
    checkIndex: 0,
    sourceRevisionHash: "d".repeat(64),
    firstObservedAt: at("2026-08-17T00:10:00.000Z"),
    masteryEvents: [{ mastery: "unknown" as never, recordedAt: at("2026-08-17T00:11:00.000Z") }],
  });
  input.promotions.push({
    gateId: "future-gate",
    sourceKind: "unknown" as never,
    textbookKey: "2026-08-17",
    source: "unknown" as never,
    checkIndex: 0,
    sourceRevisionHash: "d".repeat(64),
    originCreatedAt: at("2026-08-17T01:00:00.000Z"),
  });
  input.gateStateEvents.push({
    id: "future-invalid-state",
    gateId: "future-gate",
    ordinal: 0,
    status: "unknown" as never,
    recordedAt: at("2026-08-17T01:01:00.000Z"),
  });

  assert.deepEqual(projectHCycleEvidenceV1(input), baseline);
});

test("A7B-CG1-T9 treats malformed direct Capture linkage as incomplete rather than a measured failure", () => {
  const projection = projectHCycleEvidenceV1(
    failedGateInput({ sourceTool: "manual", parsedGateId: null }, null),
  );

  assert.deepEqual(projection.failedTriageRate, {
    status: "incomplete",
    numerator: 0,
    denominator: 1,
    reason: "malformed_capture_mapping",
  });
  assert.equal(projection.diagnostics.malformed_failure_capture_mapping, 1);
});

test("A7B-CG1-T11 accepts same-millisecond transitions when ordinal preserves their order", () => {
  const input = failedGateInput();
  const same = at("2026-08-10T01:20:00.000Z");
  const projection = projectHCycleEvidenceV1({
    ...input,
    gateStateEvents: [
      { id: "same-1", gateId: "gate-2", ordinal: 1, status: "answered" as const, recordedAt: same },
      { id: "same-2", gateId: "gate-2", ordinal: 2, status: "grading" as const, recordedAt: same },
      { id: "same-3", gateId: "gate-2", ordinal: 3, status: "failed" as const, recordedAt: same },
    ],
  });

  assert.deepEqual(projection.gradedPromotedGateRate, { status: "measured", numerator: 1, denominator: 1, ratio: 1 });
  assert.deepEqual(projection.diagnostics, {});
});

test("A7B-CG1-T12 keeps self-grade, grading failure, and dismissal incomplete", () => {
  const history = (terminal: "grading_failed" | "self_graded_fail" | "dismissed") => {
    const base = failedGateInput();
    const events: HCycleGateStateEventV1[] = [
      { id: `${terminal}-1`, gateId: "gate-2", ordinal: 1, status: "answered" as const, recordedAt: at("2026-08-10T01:10:00.000Z") },
      { id: `${terminal}-2`, gateId: "gate-2", ordinal: 2, status: "grading" as const, recordedAt: at("2026-08-10T01:11:00.000Z") },
      { id: `${terminal}-3`, gateId: "gate-2", ordinal: 3, status: "grading_failed" as const, recordedAt: at("2026-08-10T01:12:00.000Z") },
    ];
    if (terminal !== "grading_failed") {
      events.push({
        id: `${terminal}-4`,
        gateId: "gate-2",
        ordinal: 4,
        status: terminal,
        recordedAt: at("2026-08-10T01:13:00.000Z"),
      });
    }
    return projectHCycleEvidenceV1({ ...base, gateStateEvents: events });
  };

  assert.deepEqual(history("grading_failed").gradedPromotedGateRate, {
    status: "incomplete", numerator: 0, denominator: 1, reason: "grading_failed",
  });
  assert.deepEqual(history("self_graded_fail").gradedPromotedGateRate, {
    status: "incomplete", numerator: 0, denominator: 1, reason: "self_graded_gate",
  });
  assert.deepEqual(history("dismissed").gradedPromotedGateRate, {
    status: "incomplete", numerator: 0, denominator: 1, reason: "non_evaluable_gate",
  });
});

test("A7B-CG1-T13 uses a strict [start, end) origin cohort and validates a JST year boundary", () => {
  const atEnd = failedGateInput();
  atEnd.promotions[0]!.originCreatedAt = at("2026-08-16T15:00:00.000Z");
  const projection = projectHCycleEvidenceV1(atEnd);
  assert.deepEqual(projection.gradedPromotedGateRate, {
    status: "not_applicable", numerator: 0, denominator: 0, reason: "zero_denominator",
  });

  assert.doesNotThrow(() => projectHCycleEvidenceV1({
    period: {
      weekKey: "2027-W01",
      start: at("2027-01-03T15:00:00.000Z"),
      end: at("2027-01-10T15:00:00.000Z"),
      asOf: at("2027-01-10T15:00:00.000Z"),
    },
    sourceRevisions: [],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  }));
});

const rate = (numerator: number, denominator: number): EvidenceRate => ({
  status: "measured",
  numerator,
  denominator,
  ratio: numerator / denominator,
});

function policyProjection(
  weekKey: string,
  start: string,
  options: {
    graded?: EvidenceRate;
    failedTriage?: EvidenceRate;
    scheduled?: EvidenceRate;
    closure?: EvidenceRate;
    diagnostics?: Record<string, number>;
  } = {},
): HCycleEvidenceProjectionV1 {
  const startDate = at(start);
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    schema: "h_cycle_evidence_projection_v1",
    policyVersion: "h_cycle_evidence_v1",
    period: { weekKey, start: startDate.toISOString(), end: endDate.toISOString(), asOf: endDate.toISOString() },
    cohortKinds: H_CYCLE_COHORT_KINDS_V1,
    selfAssessmentRate: rate(1, 1),
    actionableCheckCount: { status: "measured", count: 1 },
    explicitPromotionRate: rate(1, 1),
    answeredPromotedGateRate: rate(1, 1),
    gradedPromotedGateRate: options.graded ?? rate(1, 2),
    failedTriageRate: options.failedTriage ?? { status: "not_applicable", numerator: 0, denominator: 0, reason: "zero_denominator" },
    scheduledFollowupRate: options.scheduled ?? { status: "not_applicable", numerator: 0, denominator: 0, reason: "zero_denominator" },
    evidenceClosureRate: options.closure ?? rate(1, 2),
    diagnostics: options.diagnostics ?? {},
  };
}

test("A7B-CG1-T5 applies policy only after two adjacent eligible completed weeks", () => {
  const week33 = policyProjection("2026-W33", "2026-08-09T15:00:00.000Z");
  const week34 = policyProjection("2026-W34", "2026-08-16T15:00:00.000Z");

  assert.deepEqual(evaluateHCycleEvidencePolicyV1([week33]), {
    schema: "h_cycle_evidence_policy_v1",
    policyVersion: "h_cycle_evidence_v1",
    status: "baseline_collecting",
    requiredAdjacentWindows: 2,
    evaluatedWeekKeys: ["2026-W33"],
    reasons: ["fewer_than_two_completed_windows"],
  });
  assert.deepEqual(evaluateHCycleEvidencePolicyV1([week33, week34]), {
    schema: "h_cycle_evidence_policy_v1",
    policyVersion: "h_cycle_evidence_v1",
    status: "supported",
    requiredAdjacentWindows: 2,
    evaluatedWeekKeys: ["2026-W33", "2026-W34"],
    reasons: [],
  });
});

test("A7B-CG1-T6 gives incomplete evidence precedence over reject and rejects only measured thresholds", () => {
  const week33 = policyProjection("2026-W33", "2026-08-09T15:00:00.000Z");
  const incompleteWeek34 = policyProjection("2026-W34", "2026-08-16T15:00:00.000Z", {
    graded: { status: "incomplete", numerator: 1, denominator: 2, reason: "pending_gate" },
  });
  assert.equal(evaluateHCycleEvidencePolicyV1([week33, incompleteWeek34]).status, "inconclusive");

  const rejectedWeek34 = policyProjection("2026-W34", "2026-08-16T15:00:00.000Z", {
    graded: rate(0, 2),
  });
  assert.deepEqual(evaluateHCycleEvidencePolicyV1([week33, rejectedWeek34]), {
    schema: "h_cycle_evidence_policy_v1",
    policyVersion: "h_cycle_evidence_v1",
    status: "rejected",
    requiredAdjacentWindows: 2,
    evaluatedWeekKeys: ["2026-W33", "2026-W34"],
    reasons: [],
  });
});

test("A7B-CG1-T14 makes a zero-origin cohort inconclusive without mislabeling it as incomplete", () => {
  const notApplicable: EvidenceRate = {
    status: "not_applicable",
    numerator: 0,
    denominator: 0,
    reason: "zero_denominator",
  };
  const week33 = policyProjection("2026-W33", "2026-08-09T15:00:00.000Z", {
    graded: notApplicable,
    closure: notApplicable,
  });
  const week34 = policyProjection("2026-W34", "2026-08-16T15:00:00.000Z");
  assert.deepEqual(evaluateHCycleEvidencePolicyV1([week33, week34]), {
    schema: "h_cycle_evidence_policy_v1",
    policyVersion: "h_cycle_evidence_v1",
    status: "inconclusive",
    requiredAdjacentWindows: 2,
    evaluatedWeekKeys: ["2026-W33", "2026-W34"],
    reasons: ["zero_origin_cohort"],
  });
});

test("A7B-CG1-T10 keeps non-adjacent completed weeks in baseline collection", () => {
  const week33 = policyProjection("2026-W33", "2026-08-09T15:00:00.000Z");
  const week35 = policyProjection("2026-W35", "2026-08-23T15:00:00.000Z");

  assert.deepEqual(evaluateHCycleEvidencePolicyV1([week33, week35]), {
    schema: "h_cycle_evidence_policy_v1",
    policyVersion: "h_cycle_evidence_v1",
    status: "baseline_collecting",
    requiredAdjacentWindows: 2,
    evaluatedWeekKeys: ["2026-W33", "2026-W35"],
    reasons: ["no_adjacent_completed_windows"],
  });
});
