import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TUTORIAL_GATE_ID,
  tutorialPastePrompt,
} from "./tutorial-constants";

describe("tutorialPastePrompt", () => {
  it("leads with list_pending_gates then morning_briefing", () => {
    for (const track of ["claude", "cursor", "codex", "jumon"] as const) {
      const p = tutorialPastePrompt(track);
      assert.match(p, /list_pending_gates/);
      assert.match(p, /morning_briefing/);
      assert.ok(
        p.indexOf("list_pending_gates") < p.indexOf("morning_briefing"),
        "list_pending_gates should come before morning_briefing",
      );
    }
  });

  it("keeps stable tutorial gate id", () => {
    assert.equal(TUTORIAL_GATE_ID, "tutorial-sample-gate");
  });
});
