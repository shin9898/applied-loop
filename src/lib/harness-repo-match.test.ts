import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findWatchedForHarnessRepo,
  findWatchedForRepoPath,
  harnessRepoMatchesWatched,
  pickRateForWatched,
  repoPathIsUnderWatched,
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

  it("matches worktree repoPath even when the name has no relation to the watched repo", () => {
    // 共有 worktree プール（例: ~/Desktop/triplethree/worktrees/<task>）配下は、
    // ディレクトリ名が親 repo 名と無関係になる（2026-08-15 実データで確認）
    const sharedPoolWorktree =
      "/Users/koki/Desktop/triplethree/worktrees/report-line-messaging-infra-20260805";
    assert.equal(
      harnessRepoMatchesWatched("report-line-messaging-infra-20260805", watched),
      false,
    );
    assert.equal(repoPathIsUnderWatched(sharedPoolWorktree, watched), false);
    assert.equal(
      repoPathIsUnderWatched(
        "/Users/koki/Desktop/triplethree/triple-onboarding/nested",
        watched,
      ),
      true,
    );
    assert.equal(
      repoPathIsUnderWatched("/Users/koki/Desktop/triplethree/triple-onboarding", watched),
      true,
    );
    assert.equal(repoPathIsUnderWatched(null, watched), false);
  });

  it("finds watched by repoPath as a fallback for unrelated worktree names", () => {
    const list = [
      watched,
      { path: "/Users/koki/tools/workbench", label: "workbench" },
    ];
    assert.equal(
      findWatchedForRepoPath(
        "/Users/koki/Desktop/triplethree/triple-onboarding/sub",
        list,
      )?.label,
      "triple-onboarding",
    );
    assert.equal(
      findWatchedForRepoPath(
        "/Users/koki/Desktop/triplethree/worktrees/report-line-messaging-infra-20260805",
        list,
      ),
      null,
    );
  });
});
