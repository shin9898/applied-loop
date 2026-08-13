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

  it("folds worktree suffix across a case difference", () => {
    assert.ok(repoKeysMatch("Applied-Loop", "applied-loop-feature-x"));
    assert.ok(repoKeysMatch("applied-loop_WT2", "Applied-Loop"));
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

  it("excludes app-internal sessions regardless of repo string casing", () => {
    const tools = JSON.stringify([
      { name: "mcp__applied-loop__answer_gate", kind: "mcp", calls: 1 },
    ]);
    assert.ok(!isExternalSession({ repo: "Applied-Loop", tools }));
    assert.ok(!isExternalSession({ repo: "  applied-loop  ", tools }));
  });

  it("excludes very short sessions (turns < 2) even in an external repo", () => {
    // 1ターンの `claude -p`（launchd 定期便）は、どの repo で走っても数えない
    assert.ok(!isExternalSession({ repo: "triple-list", tools: null, turns: 1 }));
    assert.ok(!isExternalSession({ repo: "triple-list", tools: null, turns: 0 }));
  });

  it("keeps multi-turn sessions in an external repo (and when turns is omitted)", () => {
    assert.ok(isExternalSession({ repo: "triple-list", tools: null, turns: 5 }));
    assert.ok(isExternalSession({ repo: "triple-list", tools: null, turns: 2 }));
    assert.ok(isExternalSession({ repo: "triple-list", tools: null }));
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

  it("keeps a region resolved from the worktree name when the canonical name has no entry", () => {
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
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      // 親名では引けない。worktree 名で解決済みの領域を捨ててはいけない
      regionByRepo: { "applied-loop-feature-x": "cache" },
    });

    const g = digest.byRepo[0];
    assert.equal(g.repo, "applied-loop");
    assert.equal(g.region, "cache");
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

  it("attributes captures to an open session (endedAt: null) when timestamp is after startedAt", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "open-session",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: null, // Open/in-progress session
          tools: null,
        },
      ],
      captures: [
        { title: "学びA", capturedAt: new Date("2026-08-13T02:00:00Z") }, // 1 hour after start
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    const g = digest.byRepo[0];
    assert.equal(g.captureCount, 1);
    assert.deepEqual(g.captureSamples, ["学びA"]);
  });

  it("prefers closed session over open session when both cover the same timestamp", () => {
    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [
        {
          sessionId: "open-long",
          repo: "triple-list",
          startedAt: new Date("2026-08-13T00:00:00Z"),
          endedAt: null, // Open session with infinite duration
          tools: null,
        },
        {
          sessionId: "closed-short",
          repo: "applied-loop",
          startedAt: new Date("2026-08-13T01:00:00Z"),
          endedAt: new Date("2026-08-13T01:30:00Z"), // Closed session: 30 min duration
          tools: null,
        },
      ],
      captures: [
        { title: "学びA", capturedAt: new Date("2026-08-13T01:15:00Z") },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    const appliedLoop = digest.byRepo.find((r) => r.repo === "applied-loop")!;
    const tripleList = digest.byRepo.find((r) => r.repo === "triple-list")!;
    // The closed session (30 min) should win over the open session (Infinity duration)
    assert.equal(appliedLoop.captureCount, 1);
    assert.equal(tripleList.captureCount, 0);
  });

  it("attributes a capture landing exactly on startedAt / endedAt (window is inclusive)", () => {
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
        { title: "開始ちょうど", capturedAt: new Date("2026-08-13T01:00:00Z") },
        { title: "終了ちょうど", capturedAt: new Date("2026-08-13T02:00:00Z") },
        { title: "1ms 遅い", capturedAt: new Date("2026-08-13T02:00:00.001Z") },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    assert.equal(digest.byRepo[0].captureCount, 2);
    assert.deepEqual(digest.byRepo[0].captureSamples, [
      "開始ちょうど",
      "終了ちょうど",
    ]);
  });

  it("drops (does not reassign) items whose most specific covering session is excluded", () => {
    // 除外セッション(applied-loop 内じゅもん等)の窓が最も特定的な時刻の Capture 等は、
    // より遠い外部セッションへ付け替えず、どこにも数えない。
    const externalRun = {
      sessionId: "external-long",
      repo: "triple-list",
      startedAt: new Date("2026-08-13T00:00:00Z"),
      endedAt: new Date("2026-08-13T04:00:00Z"),
      tools: null,
    };
    const excludedRun = {
      sessionId: "internal-short",
      repo: "applied-loop",
      startedAt: new Date("2026-08-13T01:00:00Z"),
      endedAt: new Date("2026-08-13T01:15:00Z"),
      tools: null,
    };
    const captures = [
      { title: "じゅもん中の学び", capturedAt: new Date("2026-08-13T01:10:00Z") },
    ];
    const goalLinks = [{ createdAt: new Date("2026-08-13T01:10:00Z") }];
    const requirementLinks = [{ createdAt: new Date("2026-08-13T01:10:00Z") }];

    const digest = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [externalRun],
      allRuns: [externalRun, excludedRun],
      captures,
      gatesAnswered: [],
      devEvents: [],
      goalLinks,
      requirementLinks,
      regionByRepo: {},
    });

    // 除外セッションは group を作らないし、外部セッションも加算されない
    assert.ok(!digest.byRepo.some((g) => g.repo === "applied-loop"));
    for (const g of digest.byRepo) {
      assert.equal(g.captureCount, 0);
      assert.deepEqual(g.captureSamples, []);
      assert.equal(g.goalLinkCount, 0);
      assert.equal(g.requirementLinkCount, 0);
    }

    // 対比: allRuns を渡さない（＝除外セッションが見えない）と、遠い外部セッションへ誤帰属する
    const naive = buildSessionDigest({
      dateKey: "2026-08-13",
      harnessRuns: [externalRun],
      captures,
      gatesAnswered: [],
      devEvents: [],
      goalLinks,
      requirementLinks,
      regionByRepo: {},
    });
    assert.equal(naive.byRepo[0].captureCount, 1);
  });
});
