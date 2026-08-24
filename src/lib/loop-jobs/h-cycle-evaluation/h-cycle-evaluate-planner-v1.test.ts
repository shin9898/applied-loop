import assert from "node:assert/strict";
import test from "node:test";

import { planHCycleEvaluateV1 } from "./h-cycle-evaluate-planner-v1";

function plan(input: {
  activationFloorWeekKey: string;
  recordedTargetWeekKeys: readonly string[];
  now: Date;
}) {
  const result = planHCycleEvaluateV1(input);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("planner rejected a valid fixture");
  return result.plan;
}

test("A8B2-CG4-T1 floor and due-window planner emit only the just-completed eligible week", () => {
  assert.equal(
    plan({
      activationFloorWeekKey: "2026-W33",
      recordedTargetWeekKeys: [],
      now: new Date("2026-08-16T23:14:59.999Z"),
    }),
    null,
  );

  const scheduled = plan({
    activationFloorWeekKey: "2026-W33",
    recordedTargetWeekKeys: [],
    now: new Date("2026-08-16T23:15:00.000Z"),
  });
  assert.notEqual(scheduled, null);
  if (scheduled === null) return;

  assert.equal(scheduled.targetWeekKey, "2026-W33");
  assert.equal(scheduled.previousWeekKey, "2026-W32");
  assert.equal(scheduled.scheduledFor.toISOString(), "2026-08-16T23:15:00.000Z");
  assert.equal(scheduled.triggerKind, "scheduled");
  assert.equal(scheduled.timeliness, "on_time");
  assert.deepEqual(scheduled.payload, {
    hypothesis: "h_cycle",
    cadence: "weekly",
    targetWeekKey: "2026-W33",
    policyVersion: "h_cycle_evidence_v1",
    projectionSchemaVersion: "h_cycle_evidence_preview_v1",
  });
  assert.deepEqual(
    scheduled.periods.map((period) => ({
      weekKey: period.weekKey,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      asOf: period.asOf.toISOString(),
    })),
    [
      {
        weekKey: "2026-W32",
        start: "2026-08-02T15:00:00.000Z",
        end: "2026-08-09T15:00:00.000Z",
        asOf: "2026-08-09T15:00:00.000Z",
      },
      {
        weekKey: "2026-W33",
        start: "2026-08-09T15:00:00.000Z",
        end: "2026-08-16T15:00:00.000Z",
        asOf: "2026-08-16T15:00:00.000Z",
      },
    ],
  );
});

test("A8B2-CG4-T2 catch-up chooses the oldest missing post-floor week and preserves lateness", () => {
  const catchUp = plan({
    activationFloorWeekKey: "2026-W33",
    recordedTargetWeekKeys: ["2026-W33", "2026-W35"],
    now: new Date("2026-09-06T15:20:00.000Z"),
  });
  assert.notEqual(catchUp, null);
  if (catchUp === null) return;
  assert.equal(catchUp.targetWeekKey, "2026-W34");
  assert.equal(catchUp.scheduledFor.toISOString(), "2026-08-23T23:15:00.000Z");
  assert.equal(catchUp.triggerKind, "catch_up");
  assert.equal(catchUp.timeliness, "catch_up");

  const noPreFloorBackfill = plan({
    activationFloorWeekKey: "2026-W35",
    recordedTargetWeekKeys: [],
    now: new Date("2026-09-06T15:20:00.000Z"),
  });
  assert.notEqual(noPreFloorBackfill, null);
  assert.equal(noPreFloorBackfill?.targetWeekKey, "2026-W35");
  assert.equal(noPreFloorBackfill?.triggerKind, "catch_up");
});

test("A8B2-CG4-T3 on-time threshold, ISO year boundary, and malformed planner input are fail-closed", () => {
  const onTimeAtBoundary = plan({
    activationFloorWeekKey: "2026-W33",
    recordedTargetWeekKeys: [],
    now: new Date("2026-08-16T23:20:00.000Z"),
  });
  assert.equal(onTimeAtBoundary?.timeliness, "on_time");

  const late = plan({
    activationFloorWeekKey: "2026-W33",
    recordedTargetWeekKeys: [],
    now: new Date("2026-08-16T23:20:00.001Z"),
  });
  assert.equal(late?.timeliness, "catch_up");
  assert.equal(late?.triggerKind, "catch_up");

  const yearBoundary = plan({
    activationFloorWeekKey: "2025-W52",
    recordedTargetWeekKeys: ["2025-W52"],
    now: new Date("2026-01-04T23:15:00.000Z"),
  });
  assert.equal(yearBoundary?.targetWeekKey, "2026-W01");
  assert.equal(yearBoundary?.previousWeekKey, "2025-W52");
  assert.equal(yearBoundary?.timeliness, "on_time");

  assert.deepEqual(
    planHCycleEvaluateV1({
      activationFloorWeekKey: "2026-W33",
      recordedTargetWeekKeys: ["2026-W54"],
      now: new Date("2026-08-16T23:15:00.000Z"),
    }),
    { ok: false, code: "invalid_planning_input" },
  );
  assert.deepEqual(
    planHCycleEvaluateV1({
      activationFloorWeekKey: "2026-W33",
      recordedTargetWeekKeys: [],
      now: new Date("invalid"),
    }),
    { ok: false, code: "invalid_planning_input" },
  );
  assert.deepEqual(
    planHCycleEvaluateV1({
      activationFloorWeekKey: "0001-W01",
      recordedTargetWeekKeys: [],
      now: new Date("2026-08-16T23:15:00.000Z"),
    }),
    { ok: false, code: "invalid_planning_input" },
  );
});
