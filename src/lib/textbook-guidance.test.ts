import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countMastery,
  formatMasteryBriefingLine,
  resolveTextbookGuidance,
} from "./textbook-guidance";

describe("resolveTextbookGuidance", () => {
  it("prioritizes stuck to zukan", () => {
    const g = resolveTextbookGuidance({
      todayKey: "2026-08-10",
      yesterday: {
        dateKey: "2026-08-09",
        checks: [
          { mastery: "stuck" },
          { mastery: "partial" },
          { mastery: "clear" },
        ],
      },
      today: null,
    });
    assert.ok(g);
    assert.equal(g.kind, "stuck");
    assert.equal(g.href, "/zukan");
  });

  it("sends unanswered yesterday checks to retro before partial", () => {
    const g = resolveTextbookGuidance({
      todayKey: "2026-08-10",
      yesterday: {
        dateKey: "2026-08-09",
        checks: [{ mastery: null }, { mastery: "partial" }],
      },
      today: null,
    });
    assert.ok(g);
    assert.equal(g.kind, "unanswered");
    assert.equal(g.href, "/retro/2026-08-09");
  });

  it("routes partial to yesterday retro", () => {
    const g = resolveTextbookGuidance({
      todayKey: "2026-08-10",
      yesterday: {
        dateKey: "2026-08-09",
        checks: [{ mastery: "partial" }, { mastery: "clear" }],
      },
      today: null,
    });
    assert.ok(g);
    assert.equal(g.kind, "partial");
    assert.match(g.href, /\/retro\/2026-08-09/);
  });

  it("falls through to today textbook when yesterday clear", () => {
    const g = resolveTextbookGuidance({
      todayKey: "2026-08-10",
      yesterday: {
        dateKey: "2026-08-09",
        checks: [{ mastery: "clear" }, { mastery: "parked" }],
      },
      today: {
        dateKey: "2026-08-10",
        chapterCount: 3,
        checks: [{ mastery: null }],
      },
    });
    assert.ok(g);
    assert.equal(g.kind, "today_ready");
    assert.equal(g.href, "/retro/2026-08-10");
  });

  it("returns null when nothing to do", () => {
    const g = resolveTextbookGuidance({
      todayKey: "2026-08-10",
      yesterday: {
        dateKey: "2026-08-09",
        checks: [{ mastery: "clear" }],
      },
      today: {
        dateKey: "2026-08-10",
        chapterCount: 1,
        checks: [{ mastery: "clear" }],
      },
    });
    assert.equal(g, null);
  });
});

describe("countMastery / briefing", () => {
  it("formats briefing line", () => {
    const line = formatMasteryBriefingLine("2026-08-09", [
      { mastery: "clear" },
      { mastery: "stuck" },
      { mastery: null },
    ]);
    assert.ok(line);
    assert.match(line, /CLEAR 1/);
    assert.match(line, /stuck 1/);
    assert.match(line, /未確認 1/);
    assert.deepEqual(
      countMastery([{ mastery: "parked" }, { mastery: "partial" }]),
      {
        clear: 0,
        partial: 1,
        stuck: 0,
        parked: 1,
        unanswered: 0,
        total: 2,
      },
    );
  });
});
