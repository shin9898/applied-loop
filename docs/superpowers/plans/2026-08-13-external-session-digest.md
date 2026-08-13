# 外部セッション・事後ダイジェスト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部ターミナル/VSCodeでのLLMセッション活動（学びの捕捉・しれん回答・要件登録・commit）を、Living Atlas側に「セッションダイジェスト」として事後整理し、にっきのとびら・ホームのストリップ・ちずマップの足あとピンの3箇所に段階的に反映する。

**Architecture:** 新規テーブルを作らず、既存の `HarnessRun`/`Capture`/`Gate`/`GoalLink`/`RequirementLink`/`DevEvent` を読み取り時に集約する純粋関数 `buildSessionDigest`（テスト可能）と、それを呼び出す server-only の `buildSessionDigestForDate`（DB問い合わせ層）に分離する。既存の日次章クラスタリング（`clusterMaterialsIntoChapters`）には一切触れない。3フェーズ（とびら→ストリップ→足あとピン）は同じ `SessionDigest` を使い回し、独立にリリース可能。

**Tech Stack:** Next.js (App Router) / TypeScript / Prisma (sqlite) / React (Server + Client Components) / node:test (`tsx --test`)

**Spec:** `docs/superpowers/specs/2026-08-13-external-session-digest-design.md`（v2、Fable独立レビュー反映済み）

## Global Constraints

- 新規テーブルは作らない（design doc「アーキテクチャ」節）
- 既存の `clusterMaterialsIntoChapters` / 日次章クラスタリングロジックには一切触れない
- 既存の PageFlip 本UI（`atlas-nikki-shelf.tsx` の月本棚・ページめくり体験）には一切触れない
- Capture / GoalLink / RequirementLink は repo を持たないため時間窓の重なりで近似マッチする。DevEvent（commit）/ Gate（しれん回答）は repo を直接持つため repo 一致で帰属させ、時間窓マッチより優先する
- 同一時間窓に複数の HarnessRun が重なった場合、対象の Capture 等は最も時間窓が短い（＝最も特定的な）HarnessRun に単一帰属させ、二重カウントしない
- 集約は repo 単位。個々の HarnessRun をそのまま列挙しない（情報量方針、Issue #3 と整合）
- 各 Phase 完了時に `npx tsc --noEmit` と `npm test`（既存106件+新規テスト）がグリーンであることを確認する

---

## Phase 1: にっきのとびら

### Task 1: session-digest-shared.ts 基盤（型・repo正規化・外部セッション判定）

**Files:**
- Create: `src/lib/session-digest-shared.ts`
- Test: `src/lib/session-digest-shared.test.ts`

**Interfaces:**
- Produces: `SystemKind`（`atlas-taxonomy.ts` から re-export）, `SessionDigest`, `SessionDigestByRepo`, `HarnessRunLike`, `CaptureLike`, `GateAnsweredLike`, `DevEventLike`, `GoalLinkLike`, `RequirementLinkLike` 型。`normalizeRepoKey(repo: string): string`、`repoKeysMatch(a: string, b: string): boolean`、`isExternalSession(run: {repo: string | null; tools: string | null}): boolean` 関数

- [ ] **Step 1: Write the failing test**

`src/lib/session-digest-shared.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRepoKey,
  repoKeysMatch,
  isExternalSession,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: FAIL — `Cannot find module './session-digest-shared'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/session-digest-shared.ts`:

```ts
/**
 * 外部セッション・事後ダイジェストの純関数・型 (クライアント可)。DB は session-digest.ts。
 */

export type { SystemKind } from "@/lib/atlas-taxonomy";
import type { SystemKind } from "@/lib/atlas-taxonomy";

export type HarnessRunLike = {
  sessionId: string;
  repo: string | null;
  startedAt: Date;
  endedAt: Date | null;
  tools: string | null;
};

export type CaptureLike = { title: string; capturedAt: Date };
export type GateAnsweredLike = { repo: string | null; answeredAt: Date };
export type DevEventLike = { repo: string; receivedAt: Date };
export type GoalLinkLike = { createdAt: Date };
export type RequirementLinkLike = { createdAt: Date };

export type SessionDigestByRepo = {
  repo: string;
  region: SystemKind | null;
  sessionCount: number;
  captureCount: number;
  /** Capture.title を最大3件、とびら展開部での想起手がかり用 */
  captureSamples: string[];
  gateAnsweredCount: number;
  goalLinkCount: number;
  requirementLinkCount: number;
  commitCount: number;
  sessions: { sessionId: string; startedAt: Date; endedAt: Date | null }[];
};

export type SessionDigest = {
  dateKey: string;
  sessionCount: number;
  repoCount: number;
  byRepo: SessionDigestByRepo[];
  /** HarnessRun.repo が null のセッション数 */
  unresolvedRepoSessionCount: number;
};

export function normalizeRepoKey(repo: string): string {
  return repo.trim().toLowerCase();
}

/** worktree 接頭辞（"{base}-..." / "{base}_..."）を親 repo へ折りたたんで一致判定する */
export function repoKeysMatch(a: string, b: string): boolean {
  const na = normalizeRepoKey(a);
  const nb = normalizeRepoKey(b);
  if (na === nb) return true;
  if (na.length >= 2 && (nb.startsWith(`${na}-`) || nb.startsWith(`${na}_`))) {
    return true;
  }
  if (nb.length >= 2 && (na.startsWith(`${nb}-`) || na.startsWith(`${nb}_`))) {
    return true;
  }
  return false;
}

type ToolUsage = { name?: string };

/**
 * v1ヒューリスティック: applied-loop 自身の repo で、かつ tools が
 * mcp__applied-loop__* のみ（他のツール呼び出しが皆無）なら、
 * アプリ内じゅもん（埋め込みターミナル）由来と判定して除外する。
 * launchd 定期便セッションの判別は将来課題（design doc「外部セッションの定義」参照）。
 */
export function isExternalSession(run: {
  repo: string | null;
  tools: string | null;
}): boolean {
  if (run.repo !== "applied-loop") return true;
  if (!run.tools) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.tools);
  } catch {
    return true;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return true;
  const onlyAppliedLoopMcp = (parsed as ToolUsage[]).every((t) =>
    t.name?.startsWith("mcp__applied-loop__"),
  );
  return !onlyAppliedLoopMcp;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: PASS（全8テスト）

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-digest-shared.ts src/lib/session-digest-shared.test.ts
git commit -m "feat: セッションダイジェストの型・repo正規化・外部セッション判定を追加"
```

---

### Task 2: buildSessionDigest — セッション集計とrepo直接アトリビューション（commit/しれん回答）

**Files:**
- Modify: `src/lib/session-digest-shared.ts`
- Test: `src/lib/session-digest-shared.test.ts`

**Interfaces:**
- Consumes: Task 1 の `repoKeysMatch`, `normalizeRepoKey`, 型群
- Produces: `buildSessionDigest(input: BuildSessionDigestInput): SessionDigest`（この Task では `harnessRuns`/`devEvents`/`gatesAnswered`/`regionByRepo` のみ扱う。Capture/GoalLink/RequirementLink は Task 3 で追加）

- [ ] **Step 1: Write the failing test**

`src/lib/session-digest-shared.test.ts` に追記:

```ts
import { buildSessionDigest } from "./session-digest-shared";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: FAIL — `buildSessionDigest is not a function`

- [ ] **Step 3: Write minimal implementation**

`src/lib/session-digest-shared.ts` に追記（ファイル末尾）:

```ts
export type BuildSessionDigestInput = {
  dateKey: string;
  harnessRuns: HarnessRunLike[];
  captures: CaptureLike[];
  gatesAnswered: GateAnsweredLike[];
  devEvents: DevEventLike[];
  goalLinks: GoalLinkLike[];
  requirementLinks: RequirementLinkLike[];
  /** normalizeRepoKey された repo をキーとする領の解決結果 */
  regionByRepo: Record<string, SystemKind | null>;
};

function newGroup(repo: string, regionByRepo: Record<string, SystemKind | null>): SessionDigestByRepo {
  return {
    repo,
    region: regionByRepo[normalizeRepoKey(repo)] ?? null,
    sessionCount: 0,
    captureCount: 0,
    captureSamples: [],
    gateAnsweredCount: 0,
    goalLinkCount: 0,
    requirementLinkCount: 0,
    commitCount: 0,
    sessions: [],
  };
}

export function buildSessionDigest(input: BuildSessionDigestInput): SessionDigest {
  const {
    dateKey,
    harnessRuns,
    captures,
    gatesAnswered,
    devEvents,
    goalLinks,
    requirementLinks,
    regionByRepo,
  } = input;

  const resolvedRuns = harnessRuns.filter(
    (r): r is HarnessRunLike & { repo: string } => Boolean(r.repo),
  );
  const unresolvedRepoSessionCount = harnessRuns.length - resolvedRuns.length;

  const groups: SessionDigestByRepo[] = [];
  function findOrCreateGroup(repo: string): SessionDigestByRepo {
    const existing = groups.find((g) => repoKeysMatch(g.repo, repo));
    if (existing) return existing;
    const g = newGroup(repo, regionByRepo);
    groups.push(g);
    return g;
  }

  for (const run of resolvedRuns) {
    const g = findOrCreateGroup(run.repo);
    g.sessionCount += 1;
    g.sessions.push({
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
  }

  for (const ev of devEvents) {
    const g = groups.find((g) => repoKeysMatch(g.repo, ev.repo));
    if (g) g.commitCount += 1;
  }

  for (const gate of gatesAnswered) {
    if (!gate.repo) continue;
    const g = groups.find((g) => repoKeysMatch(g.repo, gate.repo!));
    if (g) g.gateAnsweredCount += 1;
  }

  attributeByTimeWindow(groups, resolvedRuns, captures, goalLinks, requirementLinks);

  return {
    dateKey,
    sessionCount: resolvedRuns.length,
    repoCount: groups.length,
    byRepo: groups.sort((a, b) => b.sessionCount - a.sessionCount),
    unresolvedRepoSessionCount,
  };
}

// Task 3 で実装。この Task では no-op。
function attributeByTimeWindow(
  _groups: SessionDigestByRepo[],
  _runs: (HarnessRunLike & { repo: string })[],
  _captures: CaptureLike[],
  _goalLinks: GoalLinkLike[],
  _requirementLinks: RequirementLinkLike[],
): void {
  // Task 3 で実装
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: PASS（全10テスト）

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-digest-shared.ts src/lib/session-digest-shared.test.ts
git commit -m "feat: buildSessionDigestにセッション集計とrepo直接アトリビューションを追加"
```

---

### Task 3: buildSessionDigest — 時間窓アトリビューション（学び/目標/要件）

**Files:**
- Modify: `src/lib/session-digest-shared.ts`
- Test: `src/lib/session-digest-shared.test.ts`

**Interfaces:**
- Consumes: Task 2 の `buildSessionDigest`, `attributeByTimeWindow`（この Task で実装を差し替える）
- Produces: `attributeByTimeWindow` の完全実装（`buildSessionDigest` のシグネチャは変わらない）

- [ ] **Step 1: Write the failing test**

`src/lib/session-digest-shared.test.ts` に追記:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: FAIL — `captureCount` 等が全て 0（no-op 実装のため）

- [ ] **Step 3: Write minimal implementation**

`session-digest-shared.ts` の `attributeByTimeWindow` を差し替える:

```ts
function attributeByTimeWindow(
  groups: SessionDigestByRepo[],
  runs: (HarnessRunLike & { repo: string })[],
  captures: CaptureLike[],
  goalLinks: GoalLinkLike[],
  requirementLinks: RequirementLinkLike[],
): void {
  function findBestRun(timestamp: Date): (HarnessRunLike & { repo: string }) | null {
    let best: (HarnessRunLike & { repo: string }) | null = null;
    let bestDuration = Infinity;
    for (const run of runs) {
      const end = run.endedAt ?? run.startedAt;
      if (timestamp < run.startedAt || timestamp > end) continue;
      const duration = end.getTime() - run.startedAt.getTime();
      if (duration < bestDuration) {
        best = run;
        bestDuration = duration;
      }
    }
    return best;
  }

  function groupForRun(run: HarnessRunLike & { repo: string }): SessionDigestByRepo | undefined {
    return groups.find((g) => repoKeysMatch(g.repo, run.repo));
  }

  for (const c of captures) {
    const run = findBestRun(c.capturedAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (!g) continue;
    g.captureCount += 1;
    if (g.captureSamples.length < 3) g.captureSamples.push(c.title);
  }

  for (const gl of goalLinks) {
    const run = findBestRun(gl.createdAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (g) g.goalLinkCount += 1;
  }

  for (const rl of requirementLinks) {
    const run = findBestRun(rl.createdAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (g) g.requirementLinkCount += 1;
  }
}
```

`buildSessionDigest` 内の呼び出し行 `attributeByTimeWindow(groups, resolvedRuns, captures, goalLinks, requirementLinks);` はそのまま（シグネチャ変更なし）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/session-digest-shared.test.ts`
Expected: PASS（全13テスト）

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-digest-shared.ts src/lib/session-digest-shared.test.ts
git commit -m "feat: buildSessionDigestに時間窓アトリビューション(学び/目標/要件)を追加"
```

---

### Task 4: session-digest.ts（server-only、DB問い合わせ層）

**Files:**
- Create: `src/lib/session-digest.ts`

**Interfaces:**
- Consumes: Task 1-3 の `session-digest-shared.ts` 一式、`@/lib/db` の `prisma`、`@/lib/daily-textbook-shared` の `dayRangeFromDateKey`、`@/lib/atlas-taxonomy` の `classifySystem`
- Produces: `buildSessionDigestForDate(dateKey: string): Promise<SessionDigest>`（`session-digest-shared.ts` の型を re-export する）

この Task は DB 依存のため、既存の test runner（`tsx --test src/lib/*.test.ts`、DB モックなし）ではユニットテスト対象外とする。既存の `daily-textbook.ts` も同様に無テストの DB 層。動作確認は Task 6 完了後のブラウザ実機確認で行う。

- [ ] **Step 1: 実装を書く**

`src/lib/session-digest.ts`:

```ts
import "server-only";

import { prisma } from "@/lib/db";
import { dayRangeFromDateKey } from "@/lib/daily-textbook-shared";
import { classifySystem } from "@/lib/atlas-taxonomy";
import {
  buildSessionDigest,
  isExternalSession,
  normalizeRepoKey,
  type SessionDigest,
  type SystemKind,
} from "@/lib/session-digest-shared";

export * from "@/lib/session-digest-shared";

async function resolveRegionsByRepo(
  repos: string[],
): Promise<Record<string, SystemKind | null>> {
  const result: Record<string, SystemKind | null> = {};
  await Promise.all(
    repos.map(async (repo) => {
      const gates = await prisma.gate.findMany({
        where: { event: { repo } },
        select: { question: true, domain: true, targetConcept: true },
        take: 50,
        orderBy: { createdAt: "desc" },
      });
      if (gates.length === 0) {
        result[normalizeRepoKey(repo)] = null;
        return;
      }
      const counts = new Map<SystemKind, number>();
      for (const g of gates) {
        const kind = classifySystem({
          text: g.question,
          domain: g.domain,
          targetConcept: g.targetConcept,
        });
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      let best: SystemKind = "other";
      let bestCount = -1;
      for (const [kind, count] of counts) {
        if (count > bestCount) {
          best = kind;
          bestCount = count;
        }
      }
      result[normalizeRepoKey(repo)] = best;
    }),
  );
  return result;
}

export async function buildSessionDigestForDate(
  dateKey: string,
): Promise<SessionDigest> {
  const { start, end } = dayRangeFromDateKey(dateKey);

  const runsRaw = await prisma.harnessRun.findMany({
    where: { startedAt: { gte: start, lt: end } },
    select: {
      sessionId: true,
      repo: true,
      startedAt: true,
      endedAt: true,
      tools: true,
    },
  });
  const harnessRuns = runsRaw.filter(isExternalSession);

  const [captures, gatesRaw, devEvents, goalLinks, requirementLinks] =
    await Promise.all([
      prisma.capture.findMany({
        where: { capturedAt: { gte: start, lt: end } },
        select: { title: true, capturedAt: true },
      }),
      prisma.gate.findMany({
        where: { answeredAt: { gte: start, lt: end } },
        select: { answeredAt: true, event: { select: { repo: true } } },
      }),
      prisma.devEvent.findMany({
        where: { receivedAt: { gte: start, lt: end } },
        select: { repo: true, receivedAt: true },
      }),
      prisma.goalLink.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { createdAt: true },
      }),
      prisma.requirementLink.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { createdAt: true },
      }),
    ]);

  const gatesAnswered = gatesRaw.map((g) => ({
    repo: g.event?.repo ?? null,
    answeredAt: g.answeredAt!,
  }));

  const repos = [
    ...new Set(
      harnessRuns
        .map((r) => r.repo)
        .filter((r): r is string => Boolean(r)),
    ),
  ];
  const regionByRepo = await resolveRegionsByRepo(repos);

  return buildSessionDigest({
    dateKey,
    harnessRuns,
    captures,
    gatesAnswered,
    devEvents,
    goalLinks,
    requirementLinks,
    regionByRepo,
  });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラー（`src/lib/textbook-chapter-polish.ts:186`）のみ

- [ ] **Step 3: Commit**

```bash
git add src/lib/session-digest.ts
git commit -m "feat: buildSessionDigestForDateを追加（server-only DB問い合わせ層）"
```

---

### Task 5: AtlasSessionDigestDoor コンポーネント（とびら）

**Files:**
- Create: `src/components/living-atlas/atlas-session-digest.tsx`

**Interfaces:**
- Consumes: `SessionDigest` 型（`@/lib/session-digest-shared`）
- Produces: `AtlasSessionDigestDoor({ digest }: { digest: SessionDigest }): JSX.Element`

- [ ] **Step 1: 実装を書く**

`src/components/living-atlas/atlas-session-digest.tsx`:

```tsx
import type { SessionDigest } from "@/lib/session-digest-shared";

/** にっき日次詳細ページ冒頭の「とびら」。教科書 生成済み/未生成 どちらの分岐でも使う */
export function AtlasSessionDigestDoor({ digest }: { digest: SessionDigest }) {
  if (digest.sessionCount === 0) {
    return (
      <p className="atlas-journal__meta atlas-session-digest-door">
        まだ外部セッションの記録が無い。
      </p>
    );
  }

  const captureTotal = digest.byRepo.reduce((n, r) => n + r.captureCount, 0);
  const gateTotal = digest.byRepo.reduce((n, r) => n + r.gateAnsweredCount, 0);

  const summaryParts: string[] = [];
  if (captureTotal > 0) summaryParts.push(`学び +${captureTotal}`);
  if (gateTotal > 0) summaryParts.push(`しれん回答 +${gateTotal}`);

  return (
    <div className="atlas-session-digest-door">
      <p className="atlas-journal__meta">
        本日の外部セッション: {digest.sessionCount}件・{digest.repoCount} repo
        {summaryParts.length > 0 ? ` → ${summaryParts.join("・")}` : ""}
      </p>
      <details className="atlas-session-digest-door__details mt-1">
        <summary className="cursor-pointer text-[12px] text-[#9ec0ff]">
          くわしく見る
        </summary>
        <ul className="atlas-session-digest-door__list mt-1 list-none p-0">
          {digest.byRepo.map((r) => (
            <li key={r.repo} className="mb-2">
              <p className="m-0 text-[13px] leading-relaxed">
                {r.repo}: {r.sessionCount}セッション
                {r.captureCount > 0 ? `・学び+${r.captureCount}` : ""}
                {r.gateAnsweredCount > 0
                  ? `・しれん回答+${r.gateAnsweredCount}`
                  : ""}
              </p>
              {r.captureSamples.length > 0 ? (
                <ul className="atlas-session-digest-door__samples mt-0.5 list-none pl-3 text-[12px] text-[#c9c3a0]">
                  {r.captureSamples.map((title, i) => (
                    <li key={i}>「{title}」</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラーのみ

- [ ] **Step 3: Commit**

```bash
git add src/components/living-atlas/atlas-session-digest.tsx
git commit -m "feat: AtlasSessionDigestDoorコンポーネントを追加"
```

---

### Task 6: にっき詳細ページへの組み込み（Phase 1完成）

**Files:**
- Modify: `src/app/(app)/retro/[dateKey]/page.tsx`
- Modify: `src/components/living-atlas/atlas-daily-textbook.tsx`

**Interfaces:**
- Consumes: Task 4 の `buildSessionDigestForDate`、Task 5 の `AtlasSessionDigestDoor`

- [ ] **Step 1: page.tsx でダイジェストを取得して渡す**

`src/app/(app)/retro/[dateKey]/page.tsx` を編集:

```ts
import { notFound } from "next/navigation";
import { AtlasDailyTextbook } from "@/components/living-atlas/atlas-daily-textbook";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import {
  dayRangeFromDateKey,
  loadDailyTextbook,
} from "@/lib/daily-textbook";
import { buildSessionDigestForDate } from "@/lib/session-digest";
import { prisma } from "@/lib/db";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function RetroDatePage({
  params,
}: {
  params: Promise<{ dateKey: string }>;
}) {
  const { dateKey } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) notFound();

  const [textbook, streakDays, materialCount, sessionDigest] =
    await Promise.all([
      loadDailyTextbook(dateKey),
      loadStreakDays(),
      (() => {
        const { start, end } = dayRangeFromDateKey(dateKey);
        return prisma.devEvent.count({
          where: { receivedAt: { gte: start, lt: end } },
        });
      })(),
      buildSessionDigestForDate(dateKey),
    ]);

  return (
    <AtlasDailyTextbook
      dateKey={dateKey}
      textbook={textbook}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
      materialCountToday={materialCount}
      sessionDigest={sessionDigest}
    />
  );
}
```

- [ ] **Step 2: atlas-daily-textbook.tsx に sessionDigest prop を追加し、両分岐に挿入する**

`src/components/living-atlas/atlas-daily-textbook.tsx` を編集。まず import と props 型:

```tsx
import { AtlasSessionDigestDoor } from "@/components/living-atlas/atlas-session-digest";
import type { SessionDigest } from "@/lib/session-digest-shared";
```

`AtlasDailyTextbook` の props に追加（`materialCountToday` の直後）:

```tsx
export function AtlasDailyTextbook({
  dateKey,
  textbook,
  streakDays,
  wsToken,
  materialCountToday,
  sessionDigest,
}: {
  dateKey: string;
  textbook: TextbookView | null;
  streakDays?: number;
  wsToken: string | null;
  /** 未生成時の材料件数 */
  materialCountToday?: number;
  sessionDigest?: SessionDigest | null;
}) {
```

未生成分岐（`if (!textbook) { ... }`）の「材料: N 件」`<p>` の直後に挿入:

```tsx
              {typeof materialCountToday === "number" ? (
                <p className="atlas-journal__meta">
                  材料: {materialCountToday} 件
                  {materialCountToday === 0
                    ? "（commit 等を受け取ると増える）"
                    : ""}
                </p>
              ) : null}
              {sessionDigest ? (
                <AtlasSessionDigestDoor digest={sessionDigest} />
              ) : null}
```

生成済み分岐の「材料 N · 章 M」`<p className="atlas-journal__meta">` の直後（`{textbook.chapters.length > 0 ? (` の直前）に挿入:

```tsx
            <p className="atlas-journal__meta">
              材料 {textbook.materialCount} · 章 {textbook.chapterCount}
              {textbook.peakHour != null
                ? ` · ピーク ${textbook.peakHour}時台`
                : ""}
              {textbook.droppedMaterialIds.length > 0
                ? ` · 圧縮で畳んだ材料 ${textbook.droppedMaterialIds.length}`
                : ""}
            </p>
            {sessionDigest ? (
              <AtlasSessionDigestDoor digest={sessionDigest} />
            ) : null}
            {textbook.chapters.length > 0 ? (
```

- [ ] **Step 3: 型チェック・既存テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc は既知の無関係エラーのみ、テストは既存106件+新規13件（session-digest-shared）が全てPASS

- [ ] **Step 4: ブラウザ実機確認**

`npm run dev:all` が生きていることを `lsof -nP -iTCP:3100 -sTCP:LISTEN` で確認（無ければ起動）。ブラウザで以下を確認:
- `/retro`（本棚）から任意の日を開き、未生成の日は「材料: N件」の下、生成済みの日は「材料 N · 章 M」の下に「本日の外部セッション: …」または「まだ外部セッションの記録が無い。」が表示される
- 「くわしく見る」を開いてrepo別内訳・学びの抜粋が表示される
- コンソールエラーが無いことを `read_console_messages`（pattern: `error`, onlyErrors: true）で確認

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/retro/\[dateKey\]/page.tsx src/components/living-atlas/atlas-daily-textbook.tsx
git commit -m "feat: にっき詳細ページにセッションダイジェストのとびらを組み込む(Phase 1完成)"
```

---

## Phase 2: ホームのストリップ

### Task 7: load-atlas-data.ts の loadHomeProps に sessionDigest を追加

**Files:**
- Modify: `src/components/living-atlas/load-atlas-data.ts`
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`（`AtlasDashboardProps` 型のみ、このTaskでは表示しない）

**Interfaces:**
- Consumes: Task 4 の `buildSessionDigestForDate`
- Produces: `AtlasDashboardProps.sessionDigest?: SessionDigest | null`

- [ ] **Step 1: AtlasDashboardProps に型を追加**

`src/components/living-atlas/atlas-dashboard.tsx` の `AtlasDashboardProps` 型に追記（`textbookGuidance` の直後）:

```tsx
import type { SessionDigest } from "@/lib/session-digest-shared";

export type AtlasDashboardProps = {
  // ...既存フィールドはそのまま...
  textbookGuidance?: TextbookGuidance | null;
  sessionDigest?: SessionDigest | null;
};
```

- [ ] **Step 2: loadHomeProps でダイジェストを取得し返す**

`src/components/living-atlas/load-atlas-data.ts` の先頭 import 群に追加:

```ts
import { buildSessionDigestForDate } from "@/lib/session-digest";
```

`loadHomeProps` 関数内の `Promise.all([...])` 呼び出し（分割代入の配列は `growth` から `textbookGuide` までの10要素）を、以下のとおり11要素に変更する。分割代入側:

```ts
  const [
    growth,
    streakDays,
    pendingGate,
    pendingGateCount,
    pendingCaptureCount,
    openMisconceptionCount,
    weakRepos,
    systemStars,
    weaknesses,
    textbookGuide,
    sessionDigest,
  ] = await Promise.all([
```

`Promise.all` の配列本体は、既存の9個の Promise（`resolvedGrowthStats(now)` から `loadTextbookGuidanceForToday(dateKeyJST(now))` まで）はそのまま変更せず、末尾に1行だけ追加する:

```ts
    loadTextbookGuidanceForToday(dateKeyJST(now)),
    buildSessionDigestForDate(dateKeyJST(now)),
  ]);
```

（`loadTextbookGuidanceForToday(dateKeyJST(now)),` の行はこの関数に既に存在する最後の要素なので、その直後の `]);` の直前に `buildSessionDigestForDate(dateKeyJST(now)),` を1行挿入するだけでよい。それより前の8要素の Promise は一切変更しない）

関数末尾の `return { ... }` を以下に変更する（既存の全フィールドは変更せず、最後に `sessionDigest,` を1行追加するのみ）:

```ts
  return {
    resolvedTotal: growth.totalResolved,
    thisWeekDelta: growth.thisWeekDelta,
    streakDays,
    adventurer,
    systemStars,
    weaknesses,
    pendingGate: pendingGate
      ? {
          id: pendingGate.id,
          question: pendingGate.question,
          title: shortTitle(
            pendingGate.question,
            pendingGate.targetConcept ?? pendingGate.contextSummary,
          ),
          context: place?.label,
          domain: pendingGate.domain,
          system: system ? systemLabel(system) : undefined,
          systemKey: system ?? undefined,
          tags: pendingGate.targetConcept
            ? [pendingGate.targetConcept]
            : undefined,
        }
      : null,
    pendingGateCount,
    todos,
    textbookGuidance: textbookGuide.guidance,
    sessionDigest,
  };
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラーのみ

- [ ] **Step 4: Commit**

```bash
git add src/components/living-atlas/load-atlas-data.ts src/components/living-atlas/atlas-dashboard.tsx
git commit -m "feat: loadHomePropsにsessionDigestを追加"
```

---

### Task 8: AtlasSessionDigestStrip コンポーネント + ホーム画面組み込み（Phase 2完成）

**Files:**
- Modify: `src/components/living-atlas/atlas-session-digest.tsx`
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`

**Interfaces:**
- Consumes: Task 7 の `AtlasDashboardProps.sessionDigest`
- Produces: `AtlasSessionDigestStrip({ digest }: { digest: SessionDigest }): JSX.Element | null`

- [ ] **Step 1: AtlasSessionDigestStrip を追加**

`src/components/living-atlas/atlas-session-digest.tsx` に追記:

```tsx
import Link from "next/link";

const STRIP_MAX_CARDS = 4;

/** ホーム（ちず）のマップ直下・「いまの一手」CTAの下に置く横並びカード */
export function AtlasSessionDigestStrip({ digest }: { digest: SessionDigest }) {
  if (digest.sessionCount === 0) return null;

  const shown = digest.byRepo.slice(0, STRIP_MAX_CARDS);
  const overflow = digest.byRepo.length - shown.length;

  return (
    <div className="mt-3 border-t-2 border-[#002070] pt-3">
      <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
        ◆ きょうのきろく
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((r) => (
          <Link
            key={r.repo}
            href={`/retro/${digest.dateKey}`}
            className="dq-btn dq-btn-ghost !px-2.5 !py-1.5 text-left text-[11px] no-underline"
          >
            <span className="block">{r.repo}</span>
            <span className="block text-[10px] text-[#c9c3a0]">
              {r.sessionCount}セッション
              {r.captureCount > 0 ? `・学び+${r.captureCount}` : ""}
            </span>
          </Link>
        ))}
        {overflow > 0 ? (
          <span className="self-center text-[11px] text-[#c9c3a0]">
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: atlas-dashboard.tsx に組み込む**

import 追加:

```tsx
import { AtlasSessionDigestStrip } from "./atlas-session-digest";
```

`AtlasDashboard` 関数の props 分割代入（`textbookGuidance = null,` の直後、`}: AtlasDashboardProps) {` の直前）に `sessionDigest = null,` を追加する:

```tsx
  wsToken = null,
  setupDiagnosis = null,
  textbookGuidance = null,
  sessionDigest = null,
}: AtlasDashboardProps) {
```

「いまの一手」ブロックの直後・`</AtlasReveal>` の直前（マップ列を閉じる箇所）に挿入する:

```tsx
          <div className="mt-auto border-t-2 border-[#002070] pt-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
              ◆ いまの一手
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-normal leading-relaxed">
                  {primaryCta.title}
                </h2>
                <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                  {primaryCta.body}
                </p>
              </div>
              <Link href={primaryCta.href} className="dq-btn shrink-0">
                {primaryCta.label}
              </Link>
            </div>
          </div>
          {sessionDigest ? (
            <AtlasSessionDigestStrip digest={sessionDigest} />
          ) : null}
        </AtlasReveal>
```

（実装者は `atlas-dashboard.tsx` 内で「いまの一手」ブロックを閉じる `</div>` と、その直後にある `</AtlasReveal>` を実ファイルで確認し、両者の間に挿入すること。関数の分割代入部分にも `sessionDigest,` を追加する）

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラーのみ

- [ ] **Step 4: ブラウザ実機確認**

ホーム（`http://localhost:3100/`）を開き、外部セッションが記録されている日は「いまの一手」の下に「きょうのきろく」ストリップが表示され、カードをクリックすると `/retro/[今日の日付]` へ遷移し Phase 1 のとびらが開くことを確認する。セッション0件（またはタイムラグで未反映）の日はストリップ自体が非表示であることも確認する。

- [ ] **Step 5: Commit**

```bash
git add src/components/living-atlas/atlas-session-digest.tsx src/components/living-atlas/atlas-dashboard.tsx
git commit -m "feat: ホームにきょうのきろくストリップを追加(Phase 2完成)"
```

---

## Phase 3: 足あとピン

### Task 9: MapMarker の footprint 拡張

**Files:**
- Modify: `src/components/living-atlas/atlas-world-map.tsx`

**Interfaces:**
- Produces: `MapMarker.kind` に `"footprint"` を追加、`MapMarker.count?: number` を追加。`kind === "footprint"` のレンダリング分岐

- [ ] **Step 1: 型とレンダリング分岐を追加**

`MapMarker` 型を編集:

```tsx
export type MapMarker = {
  id: string;
  kind: "quest" | "clear" | "you" | "footprint";
  label: string;
  left: string;
  top: string;
  /** footprint のみ。同じ領に複数セッションがある場合の数字バッジ */
  count?: number;
  /** 指定時はクリックで直行（onSelect より優先） */
  href?: string;
};
```

`markers.map((m) => { ... })` 内の `pinBody` 分岐に `footprint` を追加（`m.kind === "you"` の分岐と `else` 分岐の間、既存の `else` 分岐を `quest`/`footprint`/デフォルトに広げる）:

```tsx
      {markers.map((m) => {
        const pinBody =
          m.kind === "you" ? (
            <span className="flex flex-col items-center gap-0.5">
              <span
                className={`atlas-self-avatar ${activeId === m.id ? "atlas-self-avatar--active" : ""}`}
                aria-hidden
              >
                <span className="atlas-self-avatar__frame atlas-self-avatar__frame--1" />
                <span className="atlas-self-avatar__frame atlas-self-avatar__frame--2" />
              </span>
              <span className="inline-block whitespace-nowrap border-[3px] border-white bg-[#001a8c] px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[9px] leading-none text-[#9ec0ff] shadow-[2px_2px_0_#000]">
                {m.label}
              </span>
            </span>
          ) : m.kind === "footprint" ? (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap border-[2px] border-[#5a6a8a] bg-[#0d2f70] px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[9px] leading-none text-[#9ec0ff] ${
                activeId === m.id ? "outline outline-2 outline-[#f0d25a]" : ""
              }`}
            >
              <span aria-hidden>👣</span>
              {m.count && m.count > 1 ? <span>×{m.count}</span> : null}
            </span>
          ) : (
            <>
              <span
                className={`inline-block whitespace-nowrap border-[3px] border-white px-1.5 py-1 font-[family-name:var(--font-pixel)] text-[10px] leading-none shadow-[3px_3px_0_#000] ${
                  m.kind === "quest"
                    ? "animate-[dq-bob_0.9s_steps(2)_infinite] bg-[#f0d25a] text-[#1a1000]"
                    : "bg-[#001a8c] text-[#3ecf5a]"
                } ${activeId === m.id ? "outline outline-2 outline-[#f0d25a]" : ""}`}
              >
                {m.label}
              </span>
              <span className="mx-auto block h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />
            </>
          );
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラーのみ

- [ ] **Step 3: Commit**

```bash
git add src/components/living-atlas/atlas-world-map.tsx
git commit -m "feat: MapMarkerにfootprint種別を追加"
```

---

### Task 10: ちずマップへの足あとピン組み込み + ストリップ連動（Phase 3完成）

**Files:**
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`
- Modify: `src/components/living-atlas/atlas-session-digest.tsx`

**Interfaces:**
- Consumes: Task 9 の `MapMarker`（`footprint`）、Task 8 の `AtlasSessionDigestStrip`、`SYSTEM_REGION_POS`/`FOG_REGION_POS`（`atlas-world-map.tsx`、既に `atlas-dashboard.tsx` にimport済み）
- Produces: マップ上の足あとピンとストリップ間の `activeRepo` 連動

- [ ] **Step 1: footprint マーカーを構築する**

`atlas-dashboard.tsx` 内、`questPos`/`mapMarkers` の定義（下記の既存コード）を次のように変更する。既存の `questPos` と `mapMarkers` の定義:

```tsx
  const questPos = pendingGate
    ? (SYSTEM_REGION_POS[pendingGate.systemKey ?? ""] ?? FOG_REGION_POS)
    : null;
  const mapMarkers: MapMarker[] = [
    { id: "you", kind: "you", label: "あなた", left: "22%", top: "64%" },
    ...(pendingGate && questPos
      ? [
          {
            id: "quest-1",
            kind: "quest" as const,
            label: "！",
            left: questPos.left,
            top: questPos.top,
            href: `/gates/${pendingGate.id}`,
          },
        ]
      : []),
  ];
```

これを、`questPos`/既存の `mapMarkers` 定義はそのまま残した上で、直後に footprint マーカーの構築と結合を追加する形に変更する:

```tsx
  const questPos = pendingGate
    ? (SYSTEM_REGION_POS[pendingGate.systemKey ?? ""] ?? FOG_REGION_POS)
    : null;
  const mapMarkers: MapMarker[] = [
    { id: "you", kind: "you", label: "あなた", left: "22%", top: "64%" },
    ...(pendingGate && questPos
      ? [
          {
            id: "quest-1",
            kind: "quest" as const,
            label: "！",
            left: questPos.left,
            top: questPos.top,
            href: `/gates/${pendingGate.id}`,
          },
        ]
      : []),
  ];

  const footprintMarkers: MapMarker[] = (sessionDigest?.byRepo ?? []).map(
    (r) => {
      const pos = r.region
        ? (SYSTEM_REGION_POS[r.region] ?? FOG_REGION_POS)
        : FOG_REGION_POS;
      return {
        id: `footprint-${r.repo}`,
        kind: "footprint" as const,
        label: r.repo,
        left: pos.left,
        top: pos.top,
        count: r.sessionCount,
      };
    },
  );
  const allMapMarkers: MapMarker[] = [...mapMarkers, ...footprintMarkers];
```

`<AtlasWorldMap markers={mapMarkers} ... />` の呼び出し箇所（下記、L446付近）の `markers={mapMarkers}` を `markers={allMapMarkers}` に変更する:

```tsx
            <AtlasWorldMap
              markers={allMapMarkers}
              activeId={activeId}
              onSelect={setActiveId}
              regionBrightness={regionBrightness}
            />
```

（この時点では `onSelect={setActiveId}` のまま。Step 2 で `handleMapSelect` に差し替える）

- [ ] **Step 2: クリック時にストリップをハイライトする状態を追加する**

`AtlasDashboard` 関数内（`activeId`/`setActiveId` の近く）に state を追加:

```tsx
  const [activeStripRepo, setActiveStripRepo] = useState<string | null>(null);
```

`AtlasWorldMap` の `onSelect` を拡張し、footprint マーカーが選ばれたときは `activeStripRepo` を設定してページ内スクロールはさせない（既存の `onSelect={setActiveId}` を、footprint の id かどうかで分岐する関数に差し替える）:

```tsx
  function handleMapSelect(id: string) {
    setActiveId(id);
    const repo = footprintMarkers.find((m) => m.id === id)?.label;
    if (repo) setActiveStripRepo(repo);
  }
```

Step 1 で変更した `<AtlasWorldMap markers={allMapMarkers} activeId={activeId} onSelect={setActiveId} regionBrightness={regionBrightness} />` の `onSelect={setActiveId}` を `onSelect={handleMapSelect}` に変更する:

```tsx
            <AtlasWorldMap
              markers={allMapMarkers}
              activeId={activeId}
              onSelect={handleMapSelect}
              regionBrightness={regionBrightness}
            />
```

- [ ] **Step 3: AtlasSessionDigestStrip にハイライト表示を追加する**

`atlas-session-digest.tsx` の `AtlasSessionDigestStrip` を編集し、`activeRepo` を受け取ってハイライトする:

```tsx
export function AtlasSessionDigestStrip({
  digest,
  activeRepo,
}: {
  digest: SessionDigest;
  activeRepo?: string | null;
}) {
  if (digest.sessionCount === 0) return null;

  const shown = digest.byRepo.slice(0, STRIP_MAX_CARDS);
  const overflow = digest.byRepo.length - shown.length;

  return (
    <div className="mt-3 border-t-2 border-[#002070] pt-3">
      <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
        ◆ きょうのきろく
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((r) => (
          <Link
            key={r.repo}
            href={`/retro/${digest.dateKey}`}
            className={`dq-btn dq-btn-ghost !px-2.5 !py-1.5 text-left text-[11px] no-underline ${
              activeRepo === r.repo ? "outline outline-2 outline-[#f0d25a]" : ""
            }`}
          >
            <span className="block">{r.repo}</span>
            <span className="block text-[10px] text-[#c9c3a0]">
              {r.sessionCount}セッション
              {r.captureCount > 0 ? `・学び+${r.captureCount}` : ""}
            </span>
          </Link>
        ))}
        {overflow > 0 ? (
          <span className="self-center text-[11px] text-[#c9c3a0]">
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

`atlas-dashboard.tsx` の呼び出し箇所を更新:

```tsx
          {sessionDigest ? (
            <AtlasSessionDigestStrip
              digest={sessionDigest}
              activeRepo={activeStripRepo}
            />
          ) : null}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 既知の無関係エラーのみ

- [ ] **Step 5: ブラウザ実機確認**

ホーム画面のマップに足あとピン（👣）が表示され、「！」ピンと視覚的に区別できることを確認する。ピンをクリックすると、ページ内の「きょうのきろく」ストリップの該当カードに金枠のハイライトが付くこと（ページ遷移しないこと）を確認する。regionBrightness による領の明度と足あとピンが同時に表示されても視認性が保たれることも確認する。

- [ ] **Step 6: 全体テスト・commit**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 既知の無関係エラーのみ、テスト全件PASS（既存106件+新規13件）

```bash
git add src/components/living-atlas/atlas-dashboard.tsx src/components/living-atlas/atlas-session-digest.tsx
git commit -m "feat: ちずマップに足あとピンを追加しストリップと連動させる(Phase 3完成)"
```

---

## 完了確認（全Phase）

- [ ] `npx tsc --noEmit -p .` — 既知の無関係エラー（`textbook-chapter-polish.ts:186`）のみ
- [ ] `npm test` — 全件PASS（既存106件 + `session-digest-shared.test.ts` 新規13件）
- [ ] ブラウザ実機で `/retro`、`/retro/[dateKey]`（生成済み・未生成の両方）、ホーム（`/`）を確認し、コンソールエラーが無いことを確認
- [ ] `git log` で本 Phase 分のコミットが commit 単位に分かれていることを確認（push は明示依頼があるまでしない）
