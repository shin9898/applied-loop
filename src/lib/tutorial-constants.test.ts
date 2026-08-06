import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TUTORIAL_GATE_ID,
  tutorialPastePrompt,
} from "./tutorial-constants";

describe("tutorialPastePrompt", () => {
  it("embeds morning briefing instruction for all tracks", () => {
    for (const track of ["claude", "cursor", "codex", "jumon"] as const) {
      const p = tutorialPastePrompt(track);
      assert.match(p, /morning_briefing/);
      assert.match(p, /list_pending_gates|出題/);
    }
  });

  it("keeps stable tutorial gate id", () => {
    assert.equal(TUTORIAL_GATE_ID, "tutorial-sample-gate");
  });
});
