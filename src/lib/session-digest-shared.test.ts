import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRepoKey,
  repoKeysMatch,
  isExternalSession,
  isImplausibleSession,
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

  it("excludes very short, low-turn sessions (turns < 2 and duration < 5min) even in an external repo", () => {
    // 1ターン・2分の `claude -p`（launchd 定期便）は、どの repo で走っても数えない
    const startedAt = new Date("2026-08-13T01:00:00Z");
    assert.ok(
      !isExternalSession({
        repo: "triple-list",
        tools: null,
        turns: 1,
        startedAt,
        endedAt: new Date("2026-08-13T01:02:00Z"), // 2分後
      }),
    );
    assert.ok(
      !isExternalSession({
        repo: "triple-list",
        tools: null,
        turns: 0,
        startedAt,
        endedAt: new Date("2026-08-13T01:02:00Z"),
      }),
    );
  });

  it("keeps low-turn but long-duration sessions (fire-and-forget agentic runs)", () => {
    // turns: 1 でも6時間動いていれば cron 定期便ではなく実質的なセッション
    const startedAt = new Date("2026-08-13T01:00:00Z");
    assert.ok(
      isExternalSession({
        repo: "triple-list",
        tools: null,
        turns: 1,
        startedAt,
        endedAt: new Date("2026-08-13T07:00:00Z"), // 6時間後
      }),
    );
  });

  it("keeps low-turn sessions with unknown duration (open/in-progress sessions)", () => {
    // endedAt: null（進行中セッション）は duration 不明として「短い」と決めつけない
    assert.ok(
      isExternalSession({
        repo: "triple-list",
        tools: null,
        turns: 1,
        startedAt: new Date("2026-08-13T01:00:00Z"),
        endedAt: null,
      }),
    );
  });

  it("keeps multi-turn sessions in an external repo (and when turns is omitted)", () => {
    assert.ok(isExternalSession({ repo: "triple-list", tools: null, turns: 5 }));
    assert.ok(isExternalSession({ repo: "triple-list", tools: null, turns: 2 }));
    assert.ok(isExternalSession({ repo: "triple-list", tools: null }));
  });

  it("keeps multi-turn sessions with a plausible short-but-real duration (>=10s)", () => {
    assert.ok(
      isExternalSession({
        repo: "triple-list",
        tools: null,
        turns: 3,
      }),
    );
  });
});

describe("isImplausibleSession", () => {
  // 実測: turns=2 でも実長1ミリ秒のセッション（sessionId "privacy-probe-session"
  // という診断用と思われる疑似レコード）が isExternalSession の cron 判定
  // (turns<2) をすり抜けて表示され、さらに buildSessionDigest の時間窓
  // アトリビューションで「最も特定的な窓」として実在の18分セッションより優先され、
  // 正当な Capture の帰属を奪う実害が確認された。ターン数に関わらず、実測時間が
  // 極端に短いセッションは物理的にありえない収集ログの異常値として、集計対象からも
  // 時間窓判定の母集団からも完全に除く（isExternalSession の cron 判定とは別軸）
  it("flags sessions shorter than the implausible-duration floor regardless of turns", () => {
    assert.ok(
      isImplausibleSession({
        startedAt: new Date("2026-08-03T01:23:37.000Z"),
        endedAt: new Date("2026-08-03T01:23:37.001Z"), // 1ミリ秒後
      }),
    );
  });

  it("does not flag a plausible short-but-real duration (>=10s)", () => {
    assert.ok(
      !isImplausibleSession({
        startedAt: new Date("2026-08-03T01:23:37.000Z"),
        endedAt: new Date("2026-08-03T01:23:47.000Z"), // 10秒後
      }),
    );
  });

  it("does not flag a session with unknown duration (open/in-progress, or missing timestamps)", () => {
    assert.ok(
      !isImplausibleSession({
        startedAt: new Date("2026-08-03T01:23:37.000Z"),
        endedAt: null,
      }),
    );
    assert.ok(!isImplausibleSession({}));
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

    // 「1ms 遅い」も猶予時間内（Fix: 学びの反映ラグ許容）のため3件とも帰属する
    assert.equal(digest.byRepo[0].captureCount, 3);
    assert.deepEqual(digest.byRepo[0].captureSamples, [
      "開始ちょうど",
      "終了ちょうど",
      "1ms 遅い",
    ]);
  });

  it("attributes a capture within the post-session grace period (learning often logs a few minutes after session end)", () => {
    // 実データで実際に起きた事象: セッション終了3分後に Capture が発生し、
    // 猶予なしの窓では無帰属になっていた
    const digest = buildSessionDigest({
      dateKey: "2026-08-03",
      harnessRuns: [
        {
          sessionId: "s1",
          repo: "workbench",
          startedAt: new Date("2026-08-03T01:23:37Z"),
          endedAt: new Date("2026-08-03T01:25:00Z"),
          tools: null,
        },
      ],
      captures: [
        { title: "猶予内の学び", capturedAt: new Date("2026-08-03T01:28:00Z") }, // 3分後
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    assert.equal(digest.byRepo[0].captureCount, 1);
  });

  it("does not attribute a capture beyond the post-session grace period", () => {
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
        {
          title: "猶予を超えた学び",
          capturedAt: new Date("2026-08-13T02:30:00Z"), // 30分後（猶予10分を超過）
        },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    // セッション自体は集計されるが（repoCount=1）、猶予を超えた Capture は帰属しない
    assert.equal(digest.repoCount, 1);
    assert.equal(digest.byRepo[0].captureCount, 0);
  });

  it("still prefers the shorter (more specific) session for the tie-break even within the grace period of a longer one", () => {
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
        {
          title: "短いセッションの猶予内",
          capturedAt: new Date("2026-08-13T01:20:00Z"), // short 終了5分後、long の窓内でもある
        },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    const appliedLoop = digest.byRepo.find((r) => r.repo === "applied-loop")!;
    const tripleList = digest.byRepo.find((r) => r.repo === "triple-list");
    assert.equal(appliedLoop.captureCount, 1);
    assert.equal(tripleList?.captureCount ?? 0, 0);
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

  it("an implausibly-short session must not win the tie-break against a real, longer session (実データで確認した回帰)", () => {
    // 実データ再現: sessionId "privacy-probe-session" という実長1ミリ秒の
    // 疑似セッションが、実在する18分の外部セッションより「最も特定的」として
    // tie-break で優先され、正当な Capture が無帰属になっていた。
    // 実測時間が異常に短いセッションは harnessRuns/allRuns の両方から
    // 完全に除かれ、tie-break の候補にすら上がらないことを確認する
    const realSession = {
      sessionId: "workbench-real",
      repo: "workbench",
      startedAt: new Date("2026-08-03T01:06:42Z"),
      endedAt: new Date("2026-08-03T01:25:13Z"), // 約18分
      tools: null,
    };
    const implausibleSession = {
      sessionId: "privacy-probe-session",
      repo: "applied-loop",
      startedAt: new Date("2026-08-03T01:23:37.951Z"),
      endedAt: new Date("2026-08-03T01:23:37.952Z"), // 1ミリ秒後
      tools: null,
    };

    const digest = buildSessionDigest({
      dateKey: "2026-08-03",
      harnessRuns: [realSession, implausibleSession],
      allRuns: [realSession, implausibleSession],
      captures: [
        {
          title: "コンテキストの再利用率が先週より下がっている",
          capturedAt: new Date("2026-08-03T01:28:19.263Z"), // 実セッション終了3分後
        },
      ],
      gatesAnswered: [],
      devEvents: [],
      goalLinks: [],
      requirementLinks: [],
      regionByRepo: {},
    });

    // 異常値セッションは group を作らない（applied-loop の行が存在しない）
    assert.ok(!digest.byRepo.some((g) => g.repo === "applied-loop"));
    // Capture は実在の workbench セッションへ正しく帰属する
    const workbench = digest.byRepo.find((g) => g.repo === "workbench");
    assert.equal(workbench?.captureCount, 1);
  });
});
