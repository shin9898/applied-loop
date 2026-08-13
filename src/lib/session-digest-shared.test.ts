import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRepoKey,
  repoKeysMatch,
  isExternalSession,
  buildSessionDigest,
} from "./session-digest-shared";

describe("normalizeRepoKey", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeRepoKey("  Applied-Loop  "), "applied-loop");
  });
});

describe("repoKeysMatch", () => {
  it("matches exact names case-insensitively", () => {
    assert.ok(repoKeysMatch("applied-loop", "Applied-Loop"));
  });

  it("folds worktree suffix to parent", () => {
    assert.ok(repoKeysMatch("applied-loop", "applied-loop-feature-x"));
    assert.ok(repoKeysMatch("applied-loop_wt2", "applied-loop"));
  });

  it("does not match unrelated repos", () => {
    assert.ok(!repoKeysMatch("applied-loop", "triple-list"));
  });
});

describe("isExternalSession", () => {
  it("treats sessions in other repos as external", () => {
    assert.ok(
      isExternalSession({ repo: "triple-list", tools: null }),
    );
  });

  it("excludes applied-loop sessions that only call applied-loop MCP tools", () => {
    const tools = JSON.stringify([
      { name: "mcp__applied-loop__capture_learning_candidate", kind: "mcp", calls: 1 },
      { name: "mcp__applied-loop__answer_gate", kind: "mcp", calls: 1 },
    ]);
    assert.ok(!isExternalSession({ repo: "applied-loop", tools }));
  });

  it("keeps applied-loop sessions that also use other tools (real dev work)", () => {
    const tools = JSON.stringify([
      { name: "mcp__applied-loop__capture_learning_candidate", kind: "mcp", calls: 1 },
      { name: "Edit", kind: "builtin", calls: 3 },
    ]);
    assert.ok(isExternalSession({ repo: "applied-loop", tools }));
  });

  it("treats unparsable tools JSON as external (fail open)", () => {
    assert.ok(isExternalSession({ repo: "applied-loop", tools: "not json" }));
  });
});

describe("buildSessionDigest — sessions and direct repo attribution", () => {
  it("groups sessions by repo and counts direct-repo commits/gates", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "s1",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T02:00:00Z"),
          tools: null,
        },
        {
          sessionId: "s2",
          repo: "applied-loop-feature-x",
          startedAt: new Date("2026-08-13T05:00:00Z"),
          endedAt: new Date("2026-08-13T05:30:00Z"),
          tools: null,
        },
      ],
      captures: [],
      gatesAnswered: [
        { repo: "applied-loop", answeredAt: new Date("2026-08-13T01:30:00Z") },
      ],
      devEvents: [
        { repo: "applied-loop", receivedAt: new Date("2026-08-13T01:45:00Z") },
      ],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: { "applied-loop": "harness" },
    });

    assert.equal(digest.sessionCount, 2);
    assert.equal(digest.repoCount, 1);
    const g = digest.byRepo[0];
    assert.equal(g.repo, "applied-loop");
    assert.equal(g.region, "harness");
    assert.equal(g.sessionCount, 2);
    assert.equal(g.commitCount, 1);
    assert.equal(g.gateAnsweredCount, 1);
  });

  it("counts sessions with null repo as unresolved, excluded from byRepo", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "s1",
          repo: null,
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: null,
          tools: null,
        },
      ],
      captures: [],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    assert.equal(digest.repoCount, 0);
    assert.equal(digest.unresolvedRepoSessionCount, 1);
    assert.equal(digest.sessionCount, 0);
  });

  it("canonicalizes repo name even when worktree session appears first", () => {
    // Regression test: same sessions as first test, but worktree-suffixed session first
    // to verify canonicalization is order-independent
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "s2",
          repo: "applied-loop-feature-x",
          startedAt: new Date("2026-08-13T05:00:00Z"),
          endedAt: new Date("2026-08-13T05:30:00Z"),
          tools: null,
        },
        {
          sessionId: "s1",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T02:00:00Z"),
          tools: null,
        },
      ],
      captures: [],
      gatesAnswered: [
        { repo: "applied-loop", answeredAt: new Date("2026-08-13T01:30:00Z") },
      ],
      devEvents: [
        { repo: "applied-loop", receivedAt: new Date("2026-08-13T01:45:00Z") },
      ],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: { "applied-loop": "harness" },
    });

    assert.equal(digest.sessionCount, 2);
    assert.equal(digest.repoCount, 1);
    const g = digest.byRepo[0];
    // Should canonicalize to the shorter (parent) repo name
    assert.equal(g.repo, "applied-loop");
    // Should resolve region using the canonical parent name, not the worktree
    assert.equal(g.region, "harness");
    assert.equal(g.sessionCount, 2);
    assert.equal(g.commitCount, 1);
    assert.equal(g.gateAnsweredCount, 1);
  });
});

describe("buildSessionDigest — time-window attribution", () => {
  it("attributes captures/goalLinks/requirementLinks to the overlapping session's repo", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "s1",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T02:00:00Z"),
          tools: null,
        },
      ],
      captures: [
        { title: "学びA", capturedAt: new Date("2026-08-13T01:30:00Z") },
        { title: "学びB(窓外)", capturedAt: new Date("2026-08-13T03:00:00Z") },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [{ createdAt: new Date("2026-08-13T01:10:00Z") }],
      requirementLinks: [{ createdAt: new Date("2026-08-13T01:50:00Z") }],
      regionByRepo: {},
    });

    const g = digest.byRepo[0];
    assert.equal(g.captureCount, 1);
    assert.deepEqual(g.captureSamples, ["学びA"]);
    assert.equal(g.goalLinkCount, 1);
    assert.equal(g.requirementLinkCount, 1);
  });

  it("attributes to the most specific (shortest) overlapping session when windows overlap", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "long",
          repo: "triple-list",
          startedAt: new Date("2026-08-13T00:00:00Z"),
          endedAt: new Date("2026-08-13T04:00:00Z"),
          tools: null,
        },
        {
          sessionId: "short",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T01:15:00Z"),
          tools: null,
        },
      ],
      captures: [
        { title: "重なり中の学び", capturedAt: new Date("2026-08-13T01:10:00Z") },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    const appliedLoop = digest.byRepo.find((r) => r.repo === "applied-loop")!;
    const tripleList = digest.byRepo.find((r) => r.repo === "triple-list")!;
    assert.equal(appliedLoop.captureCount, 1);
    assert.equal(tripleList.captureCount, 0);
  });

  it("caps captureSamples at 3 titles", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "s1",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T02:00:00Z"),
          tools: null,
        },
      ],
      captures: [1, 2, 3, 4].map((n) => ({
        title: `学び${n}`,
        capturedAt: new Date("2026-08-13T01:10:00Z"),
      })),
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    assert.equal(digest.byRepo[0].captureCount, 4);
    assert.equal(digest.byRepo[0].captureSamples.length, 3);
  });
});
