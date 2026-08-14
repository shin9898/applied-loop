import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { narratorFor, type NarratorEvent } from "./atlas-battle";

describe("narratorFor", () => {
  it("keeps the initial-display and applyVerdict paths in sync (regression: 2026-08-14 mismatch)", () => {
    const passLeftover: NarratorEvent = {
      kind: "verdict",
      verdict: "pass",
      weakCount: 2,
      leftoverOnPass: 2,
    };
    assert.equal(narratorFor(passLeftover), narratorFor({ ...passLeftover }));

    const gradingFailed: NarratorEvent = {
      kind: "verdict",
      verdict: "grading_failed",
      weakCount: 0,
      leftoverOnPass: 0,
    };
    // 同じ event なら常に同じ文言（呼び出し場所に関わらず）
    assert.equal(narratorFor(gradingFailed), narratorFor(gradingFailed));
    assert.match(narratorFor(gradingFailed), /認証切れ/);
  });

  it("differentiates pass with and without leftover weak aspects", () => {
    const withLeftover = narratorFor({
      kind: "verdict",
      verdict: "pass",
      weakCount: 0,
      leftoverOnPass: 1,
    });
    const clean = narratorFor({
      kind: "verdict",
      verdict: "pass",
      weakCount: 0,
      leftoverOnPass: 0,
    });
    assert.notEqual(withLeftover, clean);
    assert.match(withLeftover, /あとひと押し/);
  });

  it("differentiates retry with and without weak aspects", () => {
    const withWeak = narratorFor({
      kind: "verdict",
      verdict: "retry",
      weakCount: 1,
      leftoverOnPass: 0,
    });
    const noWeak = narratorFor({
      kind: "verdict",
      verdict: "retry",
      weakCount: 0,
      leftoverOnPass: 0,
    });
    assert.notEqual(withWeak, noWeak);
    assert.match(withWeak, /まず1観点を言い直す/);
  });

  it("keeps every non-verdict event under a short, deterministic message", () => {
    const events: NarratorEvent[] = [
      { kind: "poll_timeout" },
      { kind: "start_recall" },
      { kind: "start_micro" },
      { kind: "go_answer", hasMerged: true },
      { kind: "go_answer", hasMerged: false },
      { kind: "answer_empty" },
      { kind: "cast_accepted" },
      { kind: "accept_and_leave" },
      { kind: "accept_wait", hasOnAccepted: true },
      { kind: "accept_wait", hasOnAccepted: false },
      { kind: "flee" },
      { kind: "waiting_blocked" },
      { kind: "already_cleared" },
      { kind: "go_zukan", hasRelated: true, zukanHref: "/zukan" },
      { kind: "go_zukan", hasRelated: false, zukanHref: "/zukan" },
      { kind: "micro_step_cleared" },
      { kind: "poll_start" },
      { kind: "poll_still_waiting" },
      { kind: "retry_grading_start" },
      { kind: "retry_grading_failed" },
      { kind: "retry_grading_started" },
      { kind: "close_to_recall" },
      { kind: "park_start" },
      { kind: "park_done" },
      { kind: "park_failed" },
      { kind: "dismiss_start" },
      { kind: "dismiss_done" },
      { kind: "dismiss_failed" },
      { kind: "back_to_debrief" },
      { kind: "cancel_answer" },
    ];
    for (const event of events) {
      const text = narratorFor(event);
      assert.ok(text.length > 0, `${event.kind} must not be empty`);
      assert.equal(narratorFor(event), text, `${event.kind} must be deterministic`);
    }
  });

  it("drops the retired '採点の旅' / '裁きは別の座' flavor text everywhere except the single allowed spot", () => {
    const allEvents: NarratorEvent[] = [
      { kind: "poll_timeout" },
      { kind: "waiting_blocked" },
      { kind: "poll_still_waiting" },
      { kind: "retry_grading_started" },
      { kind: "cast_accepted" },
    ];
    for (const event of allEvents) {
      assert.doesNotMatch(narratorFor(event), /採点の旅/);
      assert.doesNotMatch(narratorFor(event), /裁きは別の座/);
    }
  });
});
