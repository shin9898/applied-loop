import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDismissRecoveryNextReviewAt } from "./gate-dismiss-recovery";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("computeDismissRecoveryNextReviewAt", () => {
  it("recovers to now + delayMs when nextReviewAt was reset to null", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const result = computeDismissRecoveryNextReviewAt(null, now, 72 * HOUR_MS);
    assert.ok(result);
    assert.equal(result.getTime(), now.getTime() + 72 * HOUR_MS);
  });

  it("uses the given delay rather than a fixed one (stale sweep=72h vs explicit dismiss=14d)", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const result = computeDismissRecoveryNextReviewAt(null, now, 14 * DAY_MS);
    assert.ok(result);
    assert.equal(result.getTime(), now.getTime() + 14 * DAY_MS);
  });

  it("does not touch an already-scheduled nextReviewAt", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const existing = new Date("2026-08-25T00:00:00Z");
    const result = computeDismissRecoveryNextReviewAt(
      existing,
      now,
      72 * HOUR_MS,
    );
    assert.equal(result, null);
  });
});
