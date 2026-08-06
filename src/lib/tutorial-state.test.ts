import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpCountsForLlmStep, type TutorialState } from "./tutorial-state";

describe("mcpCountsForLlmStep", () => {
  it("ignores MCP before llm pick", () => {
    const state: TutorialState = {
      llmTrack: "claude",
      llmTrackAt: "2026-08-06T12:00:00.000Z",
      mcpLastAt: "2026-08-06T11:00:00.000Z",
    };
    assert.equal(mcpCountsForLlmStep(state), false);
  });

  it("accepts MCP after llm pick", () => {
    const state: TutorialState = {
      llmTrack: "claude",
      llmTrackAt: "2026-08-06T12:00:00.000Z",
      mcpLastAt: "2026-08-06T12:01:00.000Z",
    };
    assert.equal(mcpCountsForLlmStep(state), true);
  });

  it("accepts explicit llmStepDone", () => {
    assert.equal(
      mcpCountsForLlmStep({ llmStepDone: true }),
      true,
    );
  });

  it("requires track+times without self-report", () => {
    assert.equal(mcpCountsForLlmStep({ mcpLastAt: "2026-08-06T12:00:00.000Z" }), false);
  });
});
