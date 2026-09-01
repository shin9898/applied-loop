import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderHarnessMonthlyReportMarkdown } from "./harness-monthly-report-render";
import { joinHarnessMonthlyCosts } from "./harness-monthly-cost-join";
import {
  buildHarnessMonthlyReport,
  parseHarnessReportMonth,
  type HarnessMonthlyReportRow,
} from "./harness-monthly-report";

function row(overrides: Partial<HarnessMonthlyReportRow> = {}): HarnessMonthlyReportRow {
  return {
    harness: "codex",
    model: "model-a",
    repo: "sample-repo",
    turns: 1,
    tokensOut: 100,
    tokensIn: 1_000_000,
    cacheRead: 0,
    cacheCreate: 0,
    usageSemanticsVersion: "harness-usage-v1",
    inputUncachedTokens: 1_000_000,
    cacheReadTokens: 0,
    ...overrides,
  };
}

function buildReport(rows: HarnessMonthlyReportRow[]) {
  const parsedMonth = parseHarnessReportMonth("2026-08");
  assert.equal(parsedMonth.ok, true);
  if (!parsedMonth.ok) throw new Error("unreachable");
  return buildHarnessMonthlyReport(parsedMonth, rows);
}

describe("harness monthly report markdown render", () => {
  it("R-T1 renders the five required sections for a populated month, without a cost section", () => {
    const report = buildReport([
      row({ model: "model-a", repo: "sample-repo" }),
      row({
        harness: "claude",
        model: "model-d",
        repo: "sample-repo",
        tokensIn: 10,
        cacheRead: 30,
        cacheCreate: 10,
        inputUncachedTokens: 10,
        cacheReadTokens: 30,
      }),
    ]);

    const markdown = renderHarnessMonthlyReportMarkdown(report);

    assert.match(markdown, /^# Harness Report 2026-08/);
    assert.match(markdown, /## 1\. harness別サマリ/);
    assert.match(markdown, /## 2\. モデル別/);
    assert.match(markdown, /## 3\. repo別/);
    assert.match(markdown, /## 4\. データ品質ノート/);
    // no cost section when costJoin is omitted.
    assert.doesNotMatch(markdown, /コスト/);
    assert.match(markdown, /model-a/);
    assert.match(markdown, /model-d/);
    assert.match(markdown, /sample-repo/);

    // Every Markdown table's header and data rows must carry the same column count.
    for (const line of markdown.split("\n")) {
      if (!line.startsWith("|")) continue;
      const columnCount = line.split("|").length;
      if (line.includes("---")) continue; // separator row, same shape by construction
      assert.ok(columnCount >= 2, `malformed table row: ${line}`);
    }
    const tableBlocks = markdown.split(/\n\n+/).filter((block) => block.startsWith("| "));
    for (const block of tableBlocks) {
      const rows = block.split("\n").filter((line) => line.startsWith("|"));
      const headerColumns = rows[0].split("|").length;
      for (const dataRow of rows.slice(2)) {
        assert.equal(
          dataRow.split("|").length,
          headerColumns,
          `column count mismatch in table row: ${dataRow}\nheader: ${rows[0]}`,
        );
      }
    }
  });

  it("R-T2 renders a cost section only when a costJoin is supplied", () => {
    const report = buildReport([row({ model: "model-a" })]);
    const costJoin = joinHarnessMonthlyCosts(report, [
      { model: "model-a", costUSD: 10 },
      { model: "model-c", costUSD: 2 },
    ]);

    const markdown = renderHarnessMonthlyReportMarkdown(report, costJoin);
    assert.match(markdown, /## \d\. コスト/);
    assert.match(markdown, /model-c/);
    assert.match(markdown, /10\.00/); // sol costUSD
  });

  it("R-T3 renders an empty month without throwing and reports queried=0", () => {
    const report = buildReport([]);
    const markdown = renderHarnessMonthlyReportMarkdown(report);
    assert.match(markdown, /# Harness Report 2026-08/);
    assert.match(markdown, /queried=0|0 件/);
  });
});
