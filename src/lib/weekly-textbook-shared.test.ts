import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWeeklyLead,
  buildWeeklyTitle,
  lastCompletedWeekRangeJST,
  recentCompletedWeekRanges,
} from "./weekly-textbook-shared";

describe("lastCompletedWeekRangeJST", () => {
  it("returns the Monday-to-Monday range of the week before the current one", () => {
    // 2026-08-17 は月曜 (JST)。今週の月曜00:00の1つ前の週を返すはず。
    const now = new Date("2026-08-17T01:00:00Z"); // 2026-08-17 10:00 JST (月)
    const range = lastCompletedWeekRangeJST(now);
    assert.equal(range.weekKey, "2026-W33");
    assert.equal(range.start.toISOString(), "2026-08-09T15:00:00.000Z"); // 2026-08-10 00:00 JST (月)
    assert.equal(range.end.toISOString(), "2026-08-16T15:00:00.000Z"); // 2026-08-17 00:00 JST (月)
  });

  it("stays in the previous week even mid-week", () => {
    const now = new Date("2026-08-19T12:00:00Z"); // 水曜 JST
    const range = lastCompletedWeekRangeJST(now);
    assert.equal(range.weekKey, "2026-W33");
  });
});

describe("recentCompletedWeekRanges", () => {
  it("returns `count` distinct weeks, most recent first, excluding the current week", () => {
    const now = new Date("2026-08-17T01:00:00Z");
    const ranges = recentCompletedWeekRanges(now, 3);
    assert.equal(ranges.length, 3);
    assert.deepEqual(
      ranges.map((r) => r.weekKey),
      ["2026-W33", "2026-W32", "2026-W31"],
    );
  });
});

describe("buildWeeklyTitle / buildWeeklyLead", () => {
  it("builds a title with the weekKey", () => {
    assert.equal(buildWeeklyTitle("2026-W33"), "週のしょ — 2026-W33");
  });

  it("builds a lead distinguishing considered materials from kept materials", () => {
    assert.equal(
      buildWeeklyLead(12, 5, 3),
      "その週にまだ拾えていなかった材料 12 件のうち、5 件を 3 章にまとめた。",
    );
  });

  it("builds a lead for a week with zero uncaptured materials", () => {
    assert.equal(
      buildWeeklyLead(0, 0, 0),
      "その週、まだ拾えていない材料はなかった。",
    );
  });
});
