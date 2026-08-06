import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmptyPendingGatesMessage } from "./pending-gates-empty";

describe("buildEmptyPendingGatesMessage", () => {
  it("guides to get_gate_result when sample is submitted", () => {
    const msg = buildEmptyPendingGatesMessage({
      tutorialGateId: "tutorial-sample-gate",
      sampleSubmitted: true,
    });
    assert.match(msg, /提出済み/);
    assert.match(msg, /get_gate_result/);
    assert.match(msg, /tutorial-sample-gate/);
    assert.doesNotMatch(msg, /ありません。\n次の一手: request_gate/);
  });

  it("suggests request_gate when sample is not submitted", () => {
    const msg = buildEmptyPendingGatesMessage({
      tutorialGateId: "tutorial-sample-gate",
      sampleSubmitted: false,
    });
    assert.match(msg, /request_gate/);
    assert.doesNotMatch(msg, /提出済み/);
  });
});
