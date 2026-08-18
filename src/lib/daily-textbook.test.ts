import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJumonContext,
  buildOneLinerSentence,
  chapterDidSummary,
  chapterHasLessonSlots,
  chaptersHaveDistinctCopy,
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  dayDigest,
  distillChecks,
  distillSingleCheck,
  draftChapterFromRepo,
  ensureChapterCopyDiversity,
  extractThemes,
  groupMaterialsIntoBandDrafts,
  JUMON_CONTEXT_MAX_CHARS,
  COMPILED_INDEX_BASE,
  nextCompiledIndex,
  normalizeOneLinerForDisplay,
  parseLessonSlots,
  pickHeadlineSummary,
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
    incorporatedAt: partial.incorporatedAt ?? null,
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

describe("pickHeadlineSummary", () => {
  it("prefers feat/fix over chore even when chore is most recent", () => {
    const headline = pickHeadlineSummary([
      "chore: bump deps",
      "fix(my-copy): stop dropping retries",
      "docs: update readme",
    ]);
    assert.equal(headline, "fix(my-copy): stop dropping retries");
  });

  it("keeps the first (most recent) item when significance ties", () => {
    const headline = pickHeadlineSummary([
      "fix(my-copy): first thing",
      "fix(my-copy): second thing",
    ]);
    assert.equal(headline, "fix(my-copy): first thing");
  });

  it("returns undefined for an empty list", () => {
    assert.equal(pickHeadlineSummary([]), undefined);
  });
});

describe("buildOneLinerSentence", () => {
  it("turns a Japanese conventional commit into a frame + verbatim quote", () => {
    const s = buildOneLinerSentence(
      "fix(my-copy): cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加",
      "cron-discord-notify",
    );
    assert.match(s, /^my-copy/);
    assert.match(s, /直した/);
    assert.ok(
      s.includes(
        "「cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加」",
      ),
      s,
    );
    assert.ok(
      !s.includes("fix(my-copy):"),
      "conventional prefix should not leak into the quote",
    );
  });

  it("quotes an English commit verbatim without attempting translation", () => {
    const s = buildOneLinerSentence("add explicit returns to cic", "infra");
    assert.ok(s.includes("「add explicit returns to cic」"), s);
    assert.match(s, /^infra/);
  });

  it("falls back to the repo name when the commit has no conventional scope", () => {
    const s = buildOneLinerSentence(
      "docs: write the migration notes",
      "workbench",
    );
    assert.match(s, /^workbench/);
  });

  it("strips a bracket-style type tag from the quoted text", () => {
    const s = buildOneLinerSentence(
      "[Docs] Wave1 台帳: rehearsal DB bootstrap 完走 + PR #573 merge を反映",
      "infra",
    );
    assert.ok(
      s.includes("「Wave1 台帳: rehearsal DB bootstrap 完走 + PR #573 merge を反映」"),
      s,
    );
    assert.ok(!s.includes("[Docs]"));
  });
});

describe("normalizeOneLinerForDisplay", () => {
  it("passes the new frame+quote format through unchanged", () => {
    const s = "my-copyのほころびを直した。「cron週次・月次リトライ機構を追加」";
    assert.equal(normalizeOneLinerForDisplay(s, "my-copy"), s);
  });

  it("reformats a legacy 核: oneLiner on the fly", () => {
    const legacy =
      "核: fix(my-copy): cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加";
    const out = normalizeOneLinerForDisplay(legacy, "hermes / my-copy");
    assert.ok(!out.startsWith("核:"));
    assert.ok(
      out.includes(
        "「cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加」",
      ),
      out,
    );
  });

  it("drops the trailing ／ついでに clause from legacy oneLiners before quoting", () => {
    const legacy = "核: fix: main thing ／ ついでに docs: side note";
    const out = normalizeOneLinerForDisplay(legacy, "repo");
    assert.ok(out.includes("「main thing」"), out);
    assert.ok(!out.includes("side note"));
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

describe("distillSingleCheck", () => {
  it("asks a work+timing question scoped to one chapter", () => {
    const materials = [
      mat({ id: "c1", repo: "triple-report-infra", summary: "fix: retry cron" }),
    ];
    const chapter = draftChapterFromRepo(1, "triple-report-infra", materials, []);
    const check = distillSingleCheck(chapter);
    assert.equal(check.chapterIndex, chapter.index);
    assert.match(check.question, new RegExp(chapter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("draftChapterFromRepo oneLiner/title", () => {
  it("titles the chapter after the repo and headlines the most significant commit, not just the latest", () => {
    const materials = [
      mat({
        id: "m1",
        repo: "cron-discord-notify",
        summary: "chore: tidy imports",
        receivedAt: new Date("2026-08-17T09:00:00Z"),
      }),
      mat({
        id: "m2",
        repo: "cron-discord-notify",
        summary:
          "fix(my-copy): cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加",
        receivedAt: new Date("2026-08-17T08:00:00Z"),
      }),
    ];
    const chapter = draftChapterFromRepo(1, "cron-discord-notify", materials, []);
    assert.equal(chapter.title, "cron-discord-notify");
    assert.ok(
      chapter.oneLiner.includes(
        "「cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加」",
      ),
      chapter.oneLiner,
    );
    assert.ok(!chapter.oneLiner.startsWith("核:"));
  });
});

describe("dayDigest", () => {
  it("returns an empty string for no chapters", () => {
    assert.equal(dayDigest([]), "");
  });

  it("frames a single-chapter day around its already-diary-style oneLiner", () => {
    const out = dayDigest([
      {
        title: "my-copy",
        oneLiner: "my-copyのほころびを直した。「cron週次リトライを追加」",
      },
    ]);
    assert.match(out, /^この日は「my-copy」ひとすじの一日じゃった。/);
    assert.ok(out.includes("「cron週次リトライを追加」"));
  });

  it("reformats a legacy oneLiner instead of leaking raw commit text", () => {
    const out = dayDigest([
      {
        title: "goal-os",
        oneLiner:
          "核: docs(goal-os): require weekly wall-bounce before enrich (#24)",
      },
    ]);
    assert.ok(!out.includes("核:"));
    assert.ok(
      !/docs\(goal-os\):/.test(out),
      "conventional-commit prefix should not leak into the diary sentence",
    );
  });

  it("names every chapter once without repeating the headline chapter's title before the dash", () => {
    const out = dayDigest([
      {
        title: "hermes",
        oneLiner: "hermesのほころびを直した。「cronのリトライを追加」",
      },
      { title: "infra", oneLiner: "infraの説明を書いた。「台帳を整備」" },
    ]);
    assert.match(out, /「hermes」・「infra」/);
    assert.equal(
      out.split("「hermes」").length - 1,
      1,
      "the headline chapter's title should not be repeated before the dash",
    );
  });
});

describe("chapterDidSummary", () => {
  it("reformats a legacy oneLiner using the chapter title as the scope fallback", () => {
    const out = chapterDidSummary({
      oneLiner:
        "核: fix(my-copy): cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加",
      action: null,
      title: "hermes / my-copy",
    });
    assert.ok(!out.includes("核:"));
    assert.ok(
      out.includes(
        "「cron週次・月次リトライ機構を有効化し予算/タイムアウト上限を追加」",
      ),
      out,
    );
  });
});

describe("nextCompiledIndex", () => {
  // 自動生成分が取りうる index の天井。章は TEXTBOOK_MAX_CHAPTERS、
  // チェックは distillChecks の slice(0, 7) で閉じている。
  const AUTO_MAX_INDEX = Math.max(TEXTBOOK_MAX_CHAPTERS, 7);

  it("starts compiled numbering at the reserved base", () => {
    assert.equal(nextCompiledIndex(null), COMPILED_INDEX_BASE);
  });

  it("increments from the existing compiled max", () => {
    assert.equal(
      nextCompiledIndex(COMPILED_INDEX_BASE),
      COMPILED_INDEX_BASE + 1,
    );
    assert.equal(
      nextCompiledIndex(COMPILED_INDEX_BASE + 41),
      COMPILED_INDEX_BASE + 42,
    );
  });

  it("never returns into the auto range, even from a pre-base compiled row", () => {
    for (const legacy of [1, 3, TEXTBOOK_MAX_CHAPTERS, 7, 999]) {
      assert.ok(
        nextCompiledIndex(legacy) >= COMPILED_INDEX_BASE,
        `legacy ${legacy} leaked below the compiled base`,
      );
    }
  });

  it("stays above the auto ceilings so regenerated chapters cannot collide", () => {
    for (const existing of [null, 1, 3, 7, COMPILED_INDEX_BASE, 4200]) {
      assert.ok(
        nextCompiledIndex(existing) > AUTO_MAX_INDEX,
        `compiled index collided with the auto range from ${existing}`,
      );
    }
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

  it("asks the LLM for a diary-style oneLiner instead of copying commit jargon verbatim", () => {
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
      materialSummaries: ["fix(tasks): harden sort"],
    });
    assert.match(prompt, /\boneLiner\b/);
    assert.match(prompt, /そのまま(繰り返さない|引き写さない)/);
  });
});
