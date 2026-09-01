import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHarnessMonthlyReport,
  parseHarnessReportMonth,
  type HarnessMonthlyReportRow,
} from "./harness-monthly-report";

function row(overrides: Partial<HarnessMonthlyReportRow> = {}): HarnessMonthlyReportRow {
  return {
    harness: "claude",
    model: "claude-sonnet-5",
    repo: "workbench",
    turns: 1,
    tokensOut: 100,
    tokensIn: 10,
    cacheRead: 30,
    cacheCreate: 10,
    usageSemanticsVersion: "harness-usage-v1",
    inputUncachedTokens: 10,
    cacheReadTokens: 30,
    ...overrides,
  };
}

describe("harness monthly report month parsing", () => {
  it("M1-T1 parses calendar months into exact half-open JST windows", () => {
    assert.deepEqual(parseHarnessReportMonth("2026-08"), {
      ok: true,
      month: "2026-08",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2026-07-31T15:00:00.000Z",
        endExclusive: "2026-08-31T15:00:00.000Z",
      },
    });
    assert.deepEqual(parseHarnessReportMonth("2026-12"), {
      ok: true,
      month: "2026-12",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2026-11-30T15:00:00.000Z",
        endExclusive: "2026-12-31T15:00:00.000Z",
      },
    });
    // leap-year February: the window must still roll over to March 1st correctly.
    assert.deepEqual(parseHarnessReportMonth("2028-02"), {
      ok: true,
      month: "2028-02",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2028-01-31T15:00:00.000Z",
        endExclusive: "2028-02-29T15:00:00.000Z",
      },
    });

    for (const month of ["2026-13", "2026-00", "not-a-month", "2026-1", "2026"]) {
      assert.deepEqual(parseHarnessReportMonth(month), {
        ok: false,
        reason: "invalid_month",
      });
    }
  });
});

describe("harness monthly report build", () => {
  it("M2-T1 groups by harness/model/repo with (unknown) fallback and matches normalizeHarnessUsage output", () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const report = buildHarnessMonthlyReport(parsedMonth, [
      row({ model: "claude-sonnet-5", repo: "workbench" }),
      row({ model: "claude-sonnet-5", repo: "workbench" }),
      row({ model: null, repo: null, turns: 2, tokensOut: 5, tokensIn: 1, cacheRead: 0, cacheCreate: 0, inputUncachedTokens: 1, cacheReadTokens: 0 }),
      row({
        harness: "codex",
        model: "gpt-5.6-sol",
        repo: "workbench",
        turns: 1,
        tokensOut: 50,
        tokensIn: 100,
        cacheRead: 80,
        cacheCreate: 0,
        inputUncachedTokens: 20,
        cacheReadTokens: 80,
      }),
    ]);

    assert.equal(report.month, "2026-08");
    assert.equal(report.semanticsVersion, "harness-usage-v1");

    // harness segments: claude aggregates 3 supported rows, codex aggregates 1.
    const claudeHarnessSeg = report.harnessSegments.find(
      (s) => s.harness === "claude" && s.key === "claude",
    );
    assert.ok(claudeHarnessSeg);
    assert.equal(claudeHarnessSeg!.totals.runs, 3);
    assert.equal(claudeHarnessSeg!.totals.totalInput, 10 + 30 + 10 + 10 + 30 + 10 + 1 + 0 + 0);

    // model segments: "(unknown)" bucket present for the null-model claude row.
    const unknownModel = report.modelSegments.find((s) => s.key === "(unknown)");
    assert.ok(unknownModel);
    assert.equal(unknownModel!.harness, "claude");
    assert.equal(unknownModel!.totals.runs, 1);

    const solModel = report.modelSegments.find((s) => s.key === "gpt-5.6-sol");
    assert.ok(solModel);
    assert.equal(solModel!.harness, "codex");
    assert.equal(solModel!.totals.runs, 1);
    assert.equal(solModel!.totals.totalInput, 100); // codex totalInput = tokensIn
    assert.equal(solModel!.totals.cacheWrite, null);
    assert.equal(solModel!.totals.freshInput, 20);

    // repo segments: "(unknown)" bucket for the null-repo row.
    const unknownRepo = report.repoSegments.find((s) => s.key === "(unknown)");
    assert.ok(unknownRepo);
    assert.equal(unknownRepo!.totals.runs, 1);

    assert.equal(report.summary.queried, 4);
    assert.equal(report.summary.supported, 4);
    assert.equal(report.summary.excluded, 0);
  });

  it("M2-T2 accounts excluded rows (invalid, no_sample) per segment and in the report summary", () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const report = buildHarnessMonthlyReport(parsedMonth, [
      row({ tokensIn: -1, cacheRead: 0, cacheCreate: 0, inputUncachedTokens: -1, cacheReadTokens: 0 }),
      row({
        harness: "codex",
        model: "gpt-5.6-sol",
        tokensIn: 0,
        cacheRead: 0,
        cacheCreate: 0,
        inputUncachedTokens: 0,
        cacheReadTokens: 0,
      }),
      row({ model: "claude-sonnet-5" }),
    ]);

    assert.equal(report.summary.queried, 3);
    assert.equal(report.summary.supported, 1);
    assert.equal(report.summary.excluded, 2);
    assert.deepEqual(report.summary.exclusionReasons, {
      negative_input: 1,
      zero_total: 1,
    });

    const claudeHarnessSeg = report.harnessSegments.find((s) => s.key === "claude");
    assert.ok(claudeHarnessSeg);
    assert.equal(claudeHarnessSeg!.excludedCount, 1);
    assert.deepEqual(claudeHarnessSeg!.exclusionReasons, { negative_input: 1 });

    const codexHarnessSeg = report.harnessSegments.find((s) => s.key === "codex");
    assert.ok(codexHarnessSeg);
    assert.equal(codexHarnessSeg!.excludedCount, 1);
    assert.equal(codexHarnessSeg!.totals.runs, 0);
  });

  it("M2-T3 nulls overflowing totals and reports aggregate_overflow calculation errors", () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const max = Number.MAX_SAFE_INTEGER;
    const report = buildHarnessMonthlyReport(parsedMonth, [
      row({ tokensIn: max, cacheRead: 0, cacheCreate: 0, inputUncachedTokens: max, cacheReadTokens: 0 }),
      row({ tokensIn: max, cacheRead: 0, cacheCreate: 0, inputUncachedTokens: max, cacheReadTokens: 0 }),
    ]);

    const claudeHarnessSeg = report.harnessSegments.find((s) => s.key === "claude");
    assert.ok(claudeHarnessSeg);
    assert.equal(claudeHarnessSeg!.totals.totalInput, null);
    assert.equal(claudeHarnessSeg!.totals.ordinaryNonReadInput, null);
    assert.ok(
      claudeHarnessSeg!.calculationErrors.some((e) => e.field === "totals.totalInput"),
    );
    assert.ok(
      claudeHarnessSeg!.calculationErrors.some(
        (e) => e.field === "totals.ordinaryNonReadInput",
      ),
    );
  });

  it("M2-T4 detects projection drift between raw recomputation and persisted projection columns", () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const report = buildHarnessMonthlyReport(parsedMonth, [
      // matches: projection is consistent with raw recomputation.
      row({ inputUncachedTokens: 10, cacheReadTokens: 30 }),
      // mismatched: persisted projection disagrees with raw recomputation.
      row({ inputUncachedTokens: 999, cacheReadTokens: 30 }),
      // missing projection: legacy row collected before the projection existed.
      row({ usageSemanticsVersion: null, inputUncachedTokens: null, cacheReadTokens: null }),
    ]);

    assert.equal(report.dataQuality.projectionMissing, 1);
    assert.equal(report.dataQuality.projectionDriftChecked, 2);
    assert.equal(report.dataQuality.projectionDriftMismatched, 1);
  });

  it("M2-T5 counts unknown model/repo runs and caps repo segments to top 10 + (その他) per harness", () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const rows: HarnessMonthlyReportRow[] = [];
    for (let i = 0; i < 12; i += 1) {
      rows.push(
        row({
          repo: `repo-${i}`,
          tokensIn: 10 + i, // distinct totalInput per repo so ranking is deterministic
          inputUncachedTokens: 10 + i,
        }),
      );
    }
    rows.push(row({ model: null, repo: null }));

    const report = buildHarnessMonthlyReport(parsedMonth, rows);

    assert.equal(report.dataQuality.unknownModelRuns, 1);
    assert.equal(report.dataQuality.unknownRepoRuns, 1);

    const claudeRepoSegments = report.repoSegments.filter((s) => s.harness === "claude");
    // 12 distinct repos + 1 null-repo "(unknown)" = 13 keys; capped to top 10 + 1 "(その他)".
    const nonOtherSegments = claudeRepoSegments.filter((s) => s.key !== "(その他)");
    assert.equal(nonOtherSegments.length, 10);
    const otherSegment = claudeRepoSegments.find((s) => s.key === "(その他)");
    assert.ok(otherSegment);
    assert.equal(otherSegment!.totals.runs, 3);

    // sorted by totalInput descending overall.
    for (let i = 1; i < report.repoSegments.length; i += 1) {
      const prev = report.repoSegments[i - 1].totals.totalInput;
      const cur = report.repoSegments[i].totals.totalInput;
      if (prev !== null && cur !== null) {
        assert.ok(prev >= cur);
      }
    }
  });
});
