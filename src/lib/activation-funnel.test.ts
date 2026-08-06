import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVATION_STEPS,
  buildFunnelReport,
  type ActivationEvent,
} from "./activation-funnel";

describe("activation funnel G8", () => {
  it("tracks exactly 7 canonical steps", () => {
    assert.equal(ACTIVATION_STEPS.length, 7);
    assert.ok(ACTIVATION_STEPS.includes("first_supply"));
    assert.ok(ACTIVATION_STEPS.includes("zukan_viewed"));
    assert.ok(!ACTIVATION_STEPS.includes("hook_installed" as never));
  });

  it("reports missing steps and completed=false", () => {
    const events: ActivationEvent[] = [
      { step: "setup_opened", at: "2026-08-06T00:00:00.000Z" },
      { step: "sample_submitted", at: "2026-08-06T00:05:00.000Z" },
    ];
    const r = buildFunnelReport(events);
    assert.equal(r.completed, false);
    assert.ok(r.missing.includes("mcp_touched"));
    assert.ok(r.missing.includes("zukan_viewed"));
  });

  it("completed when all 7 present", () => {
    const at = "2026-08-06T00:00:00.000Z";
    const events: ActivationEvent[] = ACTIVATION_STEPS.map((step) => ({
      step,
      at,
    }));
    const r = buildFunnelReport(events);
    assert.equal(r.completed, true);
    assert.deepEqual(r.missing, []);
  });
});
