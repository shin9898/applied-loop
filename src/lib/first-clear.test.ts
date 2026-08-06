import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TUTORIAL_GATE_ID } from "./tutorial-constants";

describe("first-clear constants", () => {
  it("tutorial gate id is stable", () => {
    assert.equal(TUTORIAL_GATE_ID, "tutorial-sample-gate");
  });
});
