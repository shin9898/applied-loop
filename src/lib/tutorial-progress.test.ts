import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTutorialProgress } from "./tutorial-progress";

const base = {
  tokenOk: true,
  sampleSubmitted: true,
  llmTrack: "cursor" as const,
  llmStepDone: true,
  hookOk: false,
  hookSkipped: false,
  completedAt: null as string | null,
};

describe("computeTutorialProgress", () => {
  it("starts at token when essentials missing", () => {
    const r = computeTutorialProgress({
      ...base,
      tokenOk: false,
      sampleSubmitted: false,
      llmTrack: null,
      llmStepDone: false,
    });
    assert.equal(r.currentStepId, "token");
    assert.equal(r.tutorialReady, false);
  });

  it("advances to sample_gate after token", () => {
    const r = computeTutorialProgress({
      ...base,
      sampleSubmitted: false,
      llmTrack: null,
      llmStepDone: false,
    });
    assert.equal(r.currentStepId, "sample_gate");
  });

  it("advances to llm_pick after sample", () => {
    const r = computeTutorialProgress({
      ...base,
      llmTrack: null,
      llmStepDone: false,
    });
    assert.equal(r.currentStepId, "llm_pick");
  });

  it("advances to llm_call after pick", () => {
    const r = computeTutorialProgress({
      ...base,
      llmStepDone: false,
    });
    assert.equal(r.currentStepId, "llm_call");
  });

  it("shows hook when core done but not completed", () => {
    const r = computeTutorialProgress({ ...base });
    assert.equal(r.currentStepId, "hook");
    assert.equal(r.tutorialReady, false);
    assert.equal(r.shouldPersistCompletedAt, false);
  });

  it("ready when hook skipped", () => {
    const r = computeTutorialProgress({
      ...base,
      hookSkipped: true,
    });
    assert.equal(r.currentStepId, "done");
    assert.equal(r.tutorialReady, true);
    assert.equal(r.shouldPersistCompletedAt, true);
  });

  it("ready when hook installed", () => {
    const r = computeTutorialProgress({
      ...base,
      hookOk: true,
    });
    assert.equal(r.currentStepId, "done");
    assert.equal(r.tutorialReady, true);
  });

  it("done when completedAt already set", () => {
    const r = computeTutorialProgress({
      ...base,
      hookSkipped: true,
      completedAt: "2026-08-06T00:00:00.000Z",
    });
    assert.equal(r.currentStepId, "done");
    assert.equal(r.tutorialReady, true);
    assert.equal(r.shouldPersistCompletedAt, false);
  });
});
