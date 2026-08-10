import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findWatchedForHarnessRepo,
  harnessRepoMatchesWatched,
  pickRateForWatched,
  watchedDisplayName,
} from "./harness-repo-match";

describe("harness-repo-match", () => {
  const watched = {
    path: "/Users/koki/Desktop/triplethree/triple-onboarding",
    label: "triple-onboarding",
  };

  it("matches basename and worktree prefixes", () => {
    assert.equal(harnessRepoMatchesWatched("triple-onboarding", watched), true);
    assert.equal(
      harnessRepoMatchesWatched("triple-onboarding-ui-remaining", watched),
      true,
    );
    assert.equal(harnessRepoMatchesWatched("triple-list", watched), false);
  });

  it("finds watched for harness repo", () => {
    const list = [
      watched,
      { path: "/Users/koki/tools/workbench", label: "workbench" },
    ];
    assert.equal(
      findWatchedForHarnessRepo("triple-onboarding-pr547", list)?.label,
      "triple-onboarding",
    );
    assert.equal(findWatchedForHarnessRepo("triple-list", list), null);
  });

  it("prefers exact rate over worktree", () => {
    const rates = [
      { repo: "triple-onboarding-ui-remaining", n: 1 },
      { repo: "triple-onboarding", n: 2 },
    ];
    assert.equal(pickRateForWatched(watched, rates)?.n, 2);
  });

  it("display name uses label then basename", () => {
    assert.equal(watchedDisplayName(watched), "triple-onboarding");
    assert.equal(
      watchedDisplayName({ path: "/tmp/foo/bar" }),
      "bar",
    );
  });
});
