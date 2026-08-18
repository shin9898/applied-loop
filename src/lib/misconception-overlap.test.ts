import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkMisconceptionOverlap,
  computeLinkExistingNextReviewAt,
  decodeOverlapCheckLog,
  encodeOverlapCheckLog,
  isLinkableCandidate,
  selectInterruptCandidates,
  type MisconceptionForOverlap,
  type OverlapMatch,
} from "./misconception-overlap";

const RETRY_DELAY_MS = 72 * 3600 * 1000;

describe("computeLinkExistingNextReviewAt", () => {
  it("returns now+72h when current is null", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const result = computeLinkExistingNextReviewAt(null, now);
    assert.equal(result.getTime(), now.getTime() + RETRY_DELAY_MS);
  });

  it("pulls a far-future current value forward to now+72h", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const current = new Date(now.getTime() + 30 * 86400000); // 30日後
    const result = computeLinkExistingNextReviewAt(current, now);
    assert.equal(result.getTime(), now.getTime() + RETRY_DELAY_MS);
  });

  it("keeps a nearer-future current value unchanged", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const current = new Date(now.getTime() + 6 * 3600 * 1000); // 6時間後（72hより早い）
    const result = computeLinkExistingNextReviewAt(current, now);
    assert.equal(result.getTime(), current.getTime());
  });

  it("keeps an overdue (past) current value unchanged rather than pushing it out", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const current = new Date(now.getTime() - 3 * 86400000); // 3日前（期限切れ）
    const result = computeLinkExistingNextReviewAt(current, now);
    assert.equal(result.getTime(), current.getTime());
  });
});

describe("selectInterruptCandidates", () => {
  const base = (over: Partial<OverlapMatch>): OverlapMatch => ({
    id: "m1",
    concept: "concept",
    status: "open",
    relation: "duplicate",
    reason: "reason",
    ...over,
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(selectInterruptCandidates([]), []);
  });

  it("excludes unrelated matches", () => {
    const matches = [base({ relation: "unrelated" })];
    assert.deepEqual(selectInterruptCandidates(matches), []);
  });

  it("excludes refinement matches", () => {
    const matches = [base({ relation: "refinement" })];
    assert.deepEqual(selectInterruptCandidates(matches), []);
  });

  it("excludes duplicate matches against a resolved misconception", () => {
    const matches = [base({ relation: "duplicate", status: "resolved" })];
    assert.deepEqual(selectInterruptCandidates(matches), []);
  });

  it("includes duplicate matches against an open misconception", () => {
    const matches = [base({ relation: "duplicate", status: "open" })];
    assert.deepEqual(selectInterruptCandidates(matches), matches);
  });

  it("includes duplicate matches against a regressed misconception", () => {
    const matches = [base({ relation: "duplicate", status: "regressed" })];
    assert.deepEqual(selectInterruptCandidates(matches), matches);
  });

  it("filters a mixed list down to only the interrupting subset", () => {
    const keep = base({ id: "m-keep", relation: "duplicate", status: "open" });
    const matches = [
      base({ id: "m-refine", relation: "refinement", status: "open" }),
      keep,
      base({ id: "m-resolved", relation: "duplicate", status: "resolved" }),
      base({ id: "m-unrelated", relation: "unrelated", status: "open" }),
    ];
    assert.deepEqual(selectInterruptCandidates(matches), [keep]);
  });
});

describe("encodeOverlapCheckLog / decodeOverlapCheckLog", () => {
  it("round-trips a log", () => {
    const log = {
      comparedIds: ["a", "b"],
      matches: [
        {
          id: "a",
          concept: "concept a",
          status: "open",
          relation: "duplicate" as const,
          reason: "同じ内容",
        },
      ],
      checkedAt: "2026-08-18T00:00:00.000Z",
    };
    const encoded = encodeOverlapCheckLog(log);
    assert.equal(typeof encoded, "string");
    assert.deepEqual(decodeOverlapCheckLog(encoded), log);
  });

  it("returns null for null input", () => {
    assert.equal(decodeOverlapCheckLog(null), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(decodeOverlapCheckLog("{not json"), null);
  });
});

describe("checkMisconceptionOverlap", () => {
  const candidate = {
    title: "新しい誤解",
    note: "メモ",
    contextSummary: "文脈",
  };

  it("returns ok with empty matches without calling the LLM when there is nothing to compare", async () => {
    let calls = 0;
    const llm = async () => {
      calls += 1;
      return "{}";
    };
    const result = await checkMisconceptionOverlap(candidate, [], llm);
    assert.deepEqual(result, { ok: true, matches: [] });
    assert.equal(calls, 0);
  });

  it("normalizes valid LLM matches and drops hallucinated ids", async () => {
    const existing: MisconceptionForOverlap[] = [
      { id: "m1", concept: "既存1", status: "open", rootCause: null },
      { id: "m2", concept: "既存2", status: "resolved", rootCause: "knowledge" },
    ];
    const llm = async () =>
      JSON.stringify({
        matches: [
          { id: "m1", relation: "duplicate", reason: "同じ" },
          { id: "m2", relation: "refinement", reason: "精緻化" },
          { id: "does-not-exist", relation: "duplicate", reason: "hallucination" },
        ],
      });
    const result = await checkMisconceptionOverlap(candidate, existing, llm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.matches, [
      { id: "m1", concept: "既存1", status: "open", relation: "duplicate", reason: "同じ" },
      { id: "m2", concept: "既存2", status: "resolved", relation: "refinement", reason: "精緻化" },
    ]);
  });

  it("drops matches with an invalid relation value", async () => {
    const existing: MisconceptionForOverlap[] = [
      { id: "m1", concept: "既存1", status: "open", rootCause: null },
    ];
    const llm = async () =>
      JSON.stringify({
        matches: [{ id: "m1", relation: "totally-fake", reason: "x" }],
      });
    const result = await checkMisconceptionOverlap(candidate, existing, llm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.matches, []);
  });

  it("fails open (ok:false) when the LLM call throws", async () => {
    const existing: MisconceptionForOverlap[] = [
      { id: "m1", concept: "既存1", status: "open", rootCause: null },
    ];
    const llm = async () => {
      throw new Error("rate limited");
    };
    const result = await checkMisconceptionOverlap(candidate, existing, llm);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /rate limited/);
  });

  it("fails open (ok:false) when the LLM response is not valid JSON", async () => {
    const existing: MisconceptionForOverlap[] = [
      { id: "m1", concept: "既存1", status: "open", rootCause: null },
    ];
    const llm = async () => "sorry, I cannot help with that";
    const result = await checkMisconceptionOverlap(candidate, existing, llm);
    assert.equal(result.ok, false);
  });

  it("caps the compared set at 200 existing misconceptions", async () => {
    const existing: MisconceptionForOverlap[] = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`,
      concept: `既存${i}`,
      status: "open",
      rootCause: null,
    }));
    let seenPrompt = "";
    const llm = async (prompt: string) => {
      seenPrompt = prompt;
      return JSON.stringify({ matches: [] });
    };
    await checkMisconceptionOverlap(candidate, existing, llm);
    const idOccurrences = seenPrompt.match(/id:m\d+/g) ?? [];
    assert.equal(idOccurrences.length, 200);
  });
});

describe("isLinkableCandidate", () => {
  const logWith = (matches: OverlapMatch[]) =>
    encodeOverlapCheckLog({ comparedIds: matches.map((m) => m.id), matches, checkedAt: "2026-08-18T00:00:00.000Z" });

  it("accepts a duplicate × open candidate that was actually surfaced", () => {
    const log = logWith([
      { id: "m1", concept: "既存", status: "open", relation: "duplicate", reason: "同じ" },
    ]);
    assert.equal(isLinkableCandidate(log, "m1"), true);
  });

  it("accepts a duplicate × regressed candidate", () => {
    const log = logWith([
      { id: "m1", concept: "既存", status: "regressed", relation: "duplicate", reason: "同じ" },
    ]);
    assert.equal(isLinkableCandidate(log, "m1"), true);
  });

  it("rejects a refinement match (never surfaced as an interrupt candidate)", () => {
    const log = logWith([
      { id: "m1", concept: "既存", status: "open", relation: "refinement", reason: "精緻化" },
    ]);
    assert.equal(isLinkableCandidate(log, "m1"), false);
  });

  it("rejects a duplicate × resolved match (the back door this closes — ADR-0021 v1 scope)", () => {
    const log = logWith([
      { id: "m1", concept: "既存", status: "resolved", relation: "duplicate", reason: "同じ" },
    ]);
    assert.equal(isLinkableCandidate(log, "m1"), false);
  });

  it("rejects an id that never appeared in the log at all", () => {
    const log = logWith([
      { id: "m1", concept: "既存", status: "open", relation: "duplicate", reason: "同じ" },
    ]);
    assert.equal(isLinkableCandidate(log, "not-in-the-log"), false);
  });

  it("rejects when overlapCheckJson is null", () => {
    assert.equal(isLinkableCandidate(null, "m1"), false);
  });

  it("rejects when overlapCheckJson is malformed", () => {
    assert.equal(isLinkableCandidate("{not json", "m1"), false);
  });
});
