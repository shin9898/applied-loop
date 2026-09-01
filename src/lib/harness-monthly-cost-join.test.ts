import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinHarnessMonthlyCosts } from "./harness-monthly-cost-join";
import {
  buildHarnessMonthlyReport,
  parseHarnessReportMonth,
  type HarnessMonthlyReportRow,
} from "./harness-monthly-report";

function row(overrides: Partial<HarnessMonthlyReportRow> = {}): HarnessMonthlyReportRow {
  return {
    harness: "codex",
    model: "gpt-5.6-sol",
    repo: "workbench",
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

describe("harness monthly cost join", () => {
  it("C-T1 matches DB model segments against cost entries and computes blended usd/M", () => {
    const report = buildReport([
      row({ model: "gpt-5.6-sol", tokensIn: 1_000_000 }),
      row({ model: "gpt-5.6-luna", tokensIn: 2_000_000 }),
    ]);

    const join = joinHarnessMonthlyCosts(report, [
      { model: "gpt-5.6-sol", costUSD: 10 },
      { model: "gpt-5.6-luna", costUSD: 1 },
    ]);

    const sol = join.entries.find((e) => e.model === "gpt-5.6-sol");
    assert.ok(sol);
    assert.equal(sol!.matched, true);
    assert.equal(sol!.totalInput, 1_000_000);
    assert.equal(sol!.blendedUsdPerMTokTotalInput, 10);

    const luna = join.entries.find((e) => e.model === "gpt-5.6-luna");
    assert.ok(luna);
    assert.equal(luna!.blendedUsdPerMTokTotalInput, 0.5);

    assert.deepEqual(join.unmatchedDbModels, []);
    assert.deepEqual(join.unmatchedCostModels, []);
    assert.equal(join.totalCostUSD, 11);
  });

  it("C-T2 lists DB-only and cost-only models as unmatched without crashing the join", () => {
    const report = buildReport([row({ model: "gpt-5.6-sol", tokensIn: 500_000 })]);

    const join = joinHarnessMonthlyCosts(report, [
      { model: "gpt-5.6-sol", costUSD: 5 },
      { model: "gpt-5.6-terra", costUSD: 2 },
    ]);

    assert.deepEqual(join.unmatchedCostModels, ["gpt-5.6-terra"]);
    const terra = join.entries.find((e) => e.model === "gpt-5.6-terra");
    assert.ok(terra);
    assert.equal(terra!.matched, false);
    assert.equal(terra!.totalInput, null);
    assert.equal(terra!.blendedUsdPerMTokTotalInput, null);
    assert.equal(join.totalCostUSD, 7);

    const reportWithUnpricedModel = buildReport([
      row({ model: "gpt-5.6-sol" }),
      row({ model: "claude-fable-5", harness: "claude", tokensIn: 10, cacheRead: 0, cacheCreate: 0, inputUncachedTokens: 10, cacheReadTokens: 0 }),
    ]);
    const joinWithUnpriced = joinHarnessMonthlyCosts(reportWithUnpricedModel, [
      { model: "gpt-5.6-sol", costUSD: 5 },
    ]);
    assert.deepEqual(joinWithUnpriced.unmatchedDbModels, ["claude-fable-5"]);
  });

  it("C-T3 leaves blended null when the matched model has no positive totalInput", () => {
    const report = buildReport([
      // excluded row (negative tokensIn) -> segment exists (0 supported runs) with totalInput=0.
      row({ tokensIn: -1, inputUncachedTokens: -1 }),
    ]);

    const join = joinHarnessMonthlyCosts(report, [{ model: "gpt-5.6-sol", costUSD: 3 }]);
    const sol = join.entries.find((e) => e.model === "gpt-5.6-sol");
    assert.ok(sol);
    assert.equal(sol!.matched, true);
    assert.equal(sol!.totalInput, 0);
    assert.equal(sol!.blendedUsdPerMTokTotalInput, null);
  });

  it("C-T4 rejects negative costUSD entries", () => {
    const report = buildReport([row()]);
    assert.throws(
      () => joinHarnessMonthlyCosts(report, [{ model: "gpt-5.6-sol", costUSD: -1 }]),
      /costUSD/,
    );
  });
});
