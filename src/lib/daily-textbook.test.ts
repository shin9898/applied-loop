import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJumonContext,
  chapterHasLessonSlots,
  chaptersHaveDistinctCopy,
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  distillChecks,
  ensureChapterCopyDiversity,
  extractThemes,
  groupMaterialsIntoBandDrafts,
  JUMON_CONTEXT_MAX_CHARS,
  parseLessonSlots,
  TEXTBOOK_MAX_CHAPTERS,
  type ChapterDraft,
  type MaterialRow,
} from "./daily-textbook-shared";
import { buildPolishPrompt } from "./textbook-chapter-polish-shared";

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

function baseChapter(partial: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    index: 1,
    title: "同じ題",
    oneLiner: "同じひとこと",
    bodyPlain: "同じ本文",
    bodyDeep: "同じ",
    diagramKind: "silent_gap",
    diagramBad: "同じBAD",
    diagramOk: "同じOK",
    work: "同じwork",
    timing: "同じtiming",
    action: "同じaction",
    why: "同じwhy",
    practice: "同じpractice",
    consequence: "同じconsequence",
    alternative: "同じalt",
    evidence: [],
    materialIds: ["a"],
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
  it("fills lesson slots on every chapter (create == regenerate path)", () => {
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
    assert.ok(chaptersHaveLessonSlots(chapters));
    assert.ok(chaptersHaveDistinctCopy(chapters));
    for (const ch of chapters) {
      assert.ok(chapterHasLessonSlots(ch));
      const parsed = parseLessonSlots(ch.bodyDeep);
      assert.equal(parsed.why, ch.why);
      assert.equal(parsed.practice, ch.practice);
      assert.match(ch.bodyPlain, /いま進めていた改修/);
      assert.match(ch.bodyPlain, /ナレッジが溜まったタイミング/);
      assert.match(ch.bodyPlain, /とった対応/);
      assert.match(ch.bodyPlain, /その理由/);
      assert.match(ch.bodyPlain, /ベストプラクティス/);
      const order = [
        ch.bodyPlain.indexOf("いま進めていた改修"),
        ch.bodyPlain.indexOf("ナレッジが溜まったタイミング"),
        ch.bodyPlain.indexOf("とった対応"),
        ch.bodyPlain.indexOf("その理由"),
        ch.bodyPlain.indexOf("ベストプラクティス"),
      ];
      assert.ok(order.every((n) => n >= 0));
      assert.deepEqual(
        [...order].sort((a, b) => a - b),
        order,
        "narrative order in bodyPlain",
      );
    }
    const alpha = chapters.find((c) => c.materialIds.includes("a1"));
    const beta = chapters.find((c) => c.materialIds.includes("b1"));
    assert.ok(alpha && beta);
    assert.notEqual(alpha.work, beta.work);
    assert.notEqual(alpha.why, beta.why);
    assert.notEqual(alpha.practice, beta.practice);
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
    assert.ok(chaptersHaveLessonSlots(chapters));
    assert.ok(
      chaptersHaveDistinctCopy(chapters),
      "backlog-heavy days must not collapse to one template",
    );
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
    assert.ok(chaptersHaveLessonSlots(chapters));
  });

  it("keeps per-chapter overflow visible as a digest instead of silently dropping it", () => {
    const heavy = Array.from({ length: 12 }, (_, i) =>
      mat({
        id: `heavy${i}`,
        repo: "org/busy",
        summary: `feat(busy): change number ${i}`,
        receivedAt: new Date(`2026-08-10T0${i % 9}:00:00Z`),
      }),
    );
    const { chapters, droppedMaterialIds } =
      clusterMaterialsIntoChapters(heavy);
    assert.equal(chapters.length, 1);
    assert.ok(droppedMaterialIds.length > 0, "overflow beyond per-chapter cap still tracked as dropped");
    const chapter = chapters[0]!;
    assert.match(chapter.bodyPlain, /ほか \d+ 件は章の容量超過で畳んだ/);
    assert.match(chapter.bodyPlain, /捨ててはいない/);
  });
});

describe("groupMaterialsIntoBandDrafts", () => {
  it("groups materials by repo with a short digest and count", () => {
    const materials = [
      mat({ id: "a1", repo: "triple-report-infra", summary: "fix: cron retry" }),
      mat({ id: "a2", repo: "triple-report-infra", summary: "feat: add queue" }),
      mat({ id: "b1", repo: "workbench", summary: "chore: bump deps" }),
    ];
    const bands = groupMaterialsIntoBandDrafts(materials);
    assert.equal(bands.length, 2);
    const infra = bands.find((b) => b.repo === "triple-report-infra");
    assert.ok(infra);
    assert.equal(infra!.count, 2);
    assert.deepEqual(infra!.materialIds.sort(), ["a1", "a2"]);
    assert.match(infra!.digest, /cron retry/);
    const wb = bands.find((b) => b.repo === "workbench");
    assert.equal(wb!.count, 1);
  });

  it("returns empty array for no materials", () => {
    assert.deepEqual(groupMaterialsIntoBandDrafts([]), []);
  });
});

describe("ensureChapterCopyDiversity", () => {
  it("disambiguates identical template chapters including why/practice", () => {
    const same = baseChapter();
    const fixed = ensureChapterCopyDiversity([
      same,
      { ...same, index: 2, materialIds: ["b"] },
    ]);
    assert.ok(chaptersHaveDistinctCopy(fixed));
    assert.ok(chaptersHaveLessonSlots(fixed));
  });
});

describe("distillChecks", () => {
  it("keeps check count between 1 and 7 and asks slot-linked questions", () => {
    const { chapters } = clusterMaterialsIntoChapters([
      mat({ id: "1", repo: "a/a", summary: "fix(filter): announce counts" }),
      mat({ id: "2", repo: "b/b", summary: "ci: avoid npm cache stalls" }),
      mat({ id: "3", repo: "c/c", summary: "test(e2e): follow accessible name" }),
    ]);
    const checks = distillChecks(chapters);
    assert.ok(checks.length >= 3);
    assert.ok(checks.length <= 7);
    assert.ok(
      checks.some((c) => /なぜ|別案|結果|ベスト/.test(c.question)),
      "checks should reference lesson slots",
    );
  });
});

describe("buildJumonContext", () => {
  it("injects only one chapter with why snippet and stays under budget", () => {
    const ctx = buildJumonContext({
      dateKey: "2026-08-10",
      depth: "plain",
      chapter: {
        index: 2,
        title: "report の足跡",
        oneLiner: "ひとこと",
        work: "進めていた改修の説明",
        timing: "溜まったタイミング",
        action: "とった対応",
        why: "なぜこの選定をしたのかの説明文",
        practice: "ベストプラクティスの型",
        consequence: "従った結果",
        alternative: "別案",
        evidence: [
          { kind: "commit", label: "abc", ref: "deadbeef" },
          { kind: "doc", label: "doc", url: "https://example.com/doc" },
        ],
      },
    });
    assert.match(ctx, /章2/);
    assert.match(ctx, /ひとこと/);
    assert.match(ctx, /改修/);
    assert.match(ctx, /対応/);
    assert.match(ctx, /deadbeef|example\.com/);
    assert.ok(!ctx.includes("章1"));
    assert.ok(ctx.length <= JUMON_CONTEXT_MAX_CHARS);
  });
});

describe("buildPolishPrompt", () => {
  it("scopes to one chapter materials only", () => {
    const prompt = buildPolishPrompt({
      title: "tasks / sort",
      oneLiner: "核: fix sort",
      diagramKind: "generic",
      lessons: {
        work: "work-a",
        timing: "timing-a",
        action: "action-a",
        why: "why-a",
        practice: "practice-a",
        consequence: "cons-a",
        alternative: "alt-a",
      },
      diagramBad: "bad",
      diagramOk: "ok",
      evidence: [{ label: "c1", ref: "abc1234" }],
      materialSummaries: ["fix(tasks): harden sort", "refactor(tasks): shared"],
    });
    assert.match(prompt, /this chapter only/i);
    assert.match(prompt, /harden sort/);
    assert.match(prompt, /改修 → タイミング → 対応 → 理由/);
    assert.ok(!prompt.includes("日次全材料"));
    assert.ok(!prompt.includes("全章"));
    assert.ok(!prompt.includes("org/other-repo-secret"));
  });
});
