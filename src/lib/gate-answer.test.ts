import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateGateAcceptability } from "./gate-answer";

const now = new Date("2026-08-05T00:00:00.000Z");

describe("evaluateGateAcceptability", () => {
  it("accepts pending due gates", () => {
    const r = evaluateGateAcceptability({
      status: "pending",
      nextReviewAt: null,
      now,
    });
    assert.equal(r.ok, true);
  });

  it("rejects already passed", () => {
    const r = evaluateGateAcceptability({
      status: "passed",
      nextReviewAt: null,
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "already_pass");
  });

  it("rejects while grading", () => {
    const r = evaluateGateAcceptability({
      status: "grading",
      nextReviewAt: null,
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "grading");
  });

  it("rejects not-yet-due", () => {
    const r = evaluateGateAcceptability({
      status: "pending",
      nextReviewAt: new Date("2026-08-06T00:00:00.000Z"),
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "not_due");
  });

  it("allows resubmit from failed", () => {
    const r = evaluateGateAcceptability({
      status: "failed",
      nextReviewAt: null,
      resubmit: true,
      now,
    });
    assert.equal(r.ok, true);
  });

  it("rejects failed without resubmit", () => {
    const r = evaluateGateAcceptability({
      status: "failed",
      nextReviewAt: null,
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "not_accepting");
  });
});
