import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJumonContext,
  chaptersHaveDistinctCopy,
  clusterMaterialsIntoChapters,
  distillChecks,
  ensureChapterCopyDiversity,
  extractThemes,
  JUMON_CONTEXT_MAX_CHARS,
  TEXTBOOK_MAX_CHAPTERS,
  type ChapterDraft,
  type MaterialRow,
} from "./daily-textbook-shared";

function mat(
  partial: Partial<MaterialRow> & Pick<MaterialRow, "id" | "repo">,
): MaterialRow {
  return {
    kind: "commit",
    ref: partial.ref ?? `sha-${partial.id}`,
    summary: partial.summary ?? `work ${partial.id}`,
    skipReason: partial.skipReason ?? null,
    receivedAt: partial.receivedAt ?? new Date("2026-08-10T03:00:00Z"),
    ...partial,
  };
}

describe("extractThemes", () => {
  it("prefers conventional commit scopes", () => {
    const themes = extractThemes([
      "fix(observability): limit Datadog to production",
      "test(infra): enforce production-only observability",
      "Merge remote-tracking branch origin/main",
    ]);
    assert.ok(themes.includes("observability") || themes.includes("infra"));
    assert.ok(!themes.some((t) => /^merge/i.test(t)));
  });
});

describe("clusterMaterialsIntoChapters", () => {
  it("keeps backlog materials and writes distinct chapter copy", () => {
    const materials = [
      mat({
        id: "a1",
        repo: "org/alpha",
        skipReason: "backlog",
        summary: "fix(tasks): harden assignee sort",
      }),
      mat({
        id: "a2",
        repo: "org/alpha",
        summary: "refactor(tasks): shared sort buttons",
      }),
      mat({
        id: "b1",
        repo: "org/beta",
        summary: "fix(observability): preserve commit semantics",
      }),
    ];
    const { chapters, droppedMaterialIds } =
      clusterMaterialsIntoChapters(materials);
    assert.equal(chapters.length, 2);
    assert.equal(droppedMaterialIds.length, 0);
    assert.ok(chaptersHaveDistinctCopy(chapters));
    const alpha = chapters.find((c) => c.materialIds.includes("a1"));
    const beta = chapters.find((c) => c.materialIds.includes("b1"));
    assert.ok(alpha && beta);
    assert.match(alpha.bodyPlain, /harden assignee sort|shared sort buttons/);
    assert.match(beta.bodyPlain, /observability|commit semantics/);
  });

  it("stays distinct when every chapter is backlog (the 2026-08-10 failure mode)", () => {
    const materials = [
      mat({
        id: "1",
        repo: "onboarding",
        skipReason: "backlog",
        summary: "ci: avoid smoke setup-node cache stalls",
      }),
      mat({
        id: "2",
        repo: "pr541-final",
        skipReason: "backlog",
        summary: "fix(infra): limit Datadog rollout to production",
      }),
      mat({
        id: "3",
        repo: "ui-remaining",
        skipReason: "backlog",
        summary: "fix(tasks): fall back from invalid assignee deadlines",
      }),
      mat({
        id: "4",
        repo: "pr542",
        skipReason: "backlog",
        summary: "fix: announce filter counts consistently",
      }),
      mat({
        id: "5",
        repo: "knowledge",
        skipReason: "backlog",
        summary: "chore: accumulate knowledge from PR #543",
      }),
    ];
    const { chapters } = clusterMaterialsIntoChapters(materials);
    assert.equal(chapters.length, 5);
    assert.ok(
      chaptersHaveDistinctCopy(chapters),
      "backlog-heavy days must not collapse to one template",
    );
    // npm cache stalls must not be classified as prompt-cache / prefix
    const ci = chapters.find((c) => c.materialIds.includes("1"));
    assert.ok(ci);
    assert.notEqual(ci.diagramKind, "prefix");
  });

  it("drops overflow beyond chapter and per-chapter budgets with evidence ids", () => {
    const repos = Array.from({ length: TEXTBOOK_MAX_CHAPTERS + 2 }, (_, i) =>
      mat({
        id: `r${i}`,
        repo: `org/repo${i}`,
        summary: `feat(area${i}): work ${i}`,
      }),
    );
    const { chapters, droppedMaterialIds } =
      clusterMaterialsIntoChapters(repos);
    assert.equal(chapters.length, TEXTBOOK_MAX_CHAPTERS);
    assert.ok(droppedMaterialIds.length >= 2);
    assert.ok(chaptersHaveDistinctCopy(chapters));
  });
});

describe("ensureChapterCopyDiversity", () => {
  it("disambiguates identical template chapters", () => {
    const same: ChapterDraft = {
      index: 1,
      title: "同じ題",
      oneLiner: "同じひとこと",
      bodyPlain: "同じ本文",
      bodyDeep: "同じ",
      diagramKind: "silent_gap",
      diagramBad: "同じBAD",
      diagramOk: "同じOK",
      evidence: [],
      materialIds: ["a"],
    };
    const fixed = ensureChapterCopyDiversity([
      same,
      { ...same, index: 2, materialIds: ["b"] },
    ]);
    assert.ok(chaptersHaveDistinctCopy(fixed));
  });
});

describe("distillChecks", () => {
  it("keeps check count between 1 and 7 and mentions chapter titles", () => {
    const { chapters } = clusterMaterialsIntoChapters([
      mat({ id: "1", repo: "a/a", summary: "fix(filter): announce counts" }),
      mat({ id: "2", repo: "b/b", summary: "ci: avoid npm cache stalls" }),
      mat({ id: "3", repo: "c/c", summary: "test(e2e): follow accessible name" }),
    ]);
    const checks = distillChecks(chapters);
    assert.ok(checks.length >= 3);
    assert.ok(checks.length <= 7);
    assert.ok(checks.some((c) => c.question.includes(chapters[0]!.title)));
  });
});

describe("buildJumonContext", () => {
  it("injects only one chapter and stays under budget", () => {
    const ctx = buildJumonContext({
      dateKey: "2026-08-10",
      depth: "plain",
      chapter: {
        index: 2,
        title: "report の足跡",
        oneLiner: "ひとこと",
        evidence: [
          { kind: "commit", label: "abc", ref: "deadbeef" },
          { kind: "doc", label: "doc", url: "https://example.com/doc" },
        ],
      },
    });
    assert.match(ctx, /章2/);
    assert.match(ctx, /ひとこと/);
    assert.match(ctx, /deadbeef|example\.com/);
    assert.ok(!ctx.includes("章1"));
    assert.ok(ctx.length <= JUMON_CONTEXT_MAX_CHARS);
  });
});
