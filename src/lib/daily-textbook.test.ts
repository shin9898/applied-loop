import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJumonContext,
  clusterMaterialsIntoChapters,
  distillChecks,
  JUMON_CONTEXT_MAX_CHARS,
  TEXTBOOK_MAX_CHAPTERS,
  type MaterialRow,
} from "./daily-textbook";

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

describe("clusterMaterialsIntoChapters", () => {
  it("groups by repo and keeps backlog materials in chapters", () => {
    const materials = [
      mat({ id: "a1", repo: "org/alpha", skipReason: "backlog" }),
      mat({ id: "a2", repo: "org/alpha" }),
      mat({ id: "b1", repo: "org/beta" }),
    ];
    const { chapters, droppedMaterialIds } =
      clusterMaterialsIntoChapters(materials);
    assert.equal(chapters.length, 2);
    assert.equal(droppedMaterialIds.length, 0);
    const alpha = chapters.find((c) => c.title.includes("alpha"));
    assert.ok(alpha);
    assert.equal(alpha.diagramKind, "silent_gap");
    assert.ok(alpha.materialIds.includes("a1"));
    assert.match(alpha.oneLiner, /材料として残った/);
  });

  it("drops overflow beyond chapter and per-chapter budgets with evidence ids", () => {
    const repos = Array.from({ length: TEXTBOOK_MAX_CHAPTERS + 2 }, (_, i) =>
      mat({ id: `r${i}`, repo: `org/repo${i}` }),
    );
    const { chapters, droppedMaterialIds } =
      clusterMaterialsIntoChapters(repos);
    assert.equal(chapters.length, TEXTBOOK_MAX_CHAPTERS);
    assert.ok(droppedMaterialIds.length >= 2);
  });
});

describe("distillChecks", () => {
  it("keeps check count between 1 and 7", () => {
    const { chapters } = clusterMaterialsIntoChapters([
      mat({ id: "1", repo: "a/a" }),
      mat({ id: "2", repo: "b/b" }),
      mat({ id: "3", repo: "c/c" }),
    ]);
    const checks = distillChecks(chapters);
    assert.ok(checks.length >= 3);
    assert.ok(checks.length <= 7);
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
