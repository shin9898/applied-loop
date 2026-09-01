import type {
  HarnessMonthlyReport,
  HarnessMonthlySegment,
  HarnessMonthlyTotals,
} from "./harness-monthly-report";
import type { HarnessMonthlyCostJoin } from "./harness-monthly-cost-join";

function fmtInt(value: number | null): string {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

function fmtRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function fmtUsd(value: number): string {
  return value.toFixed(2);
}

function fmtUsdOrNa(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function totalsRow(totals: HarnessMonthlyTotals): string {
  return [
    totals.runs.toString(),
    fmtInt(totals.totalInput),
    fmtInt(totals.freshInput),
    fmtInt(totals.cacheRead),
    fmtRate(totals.cacheReuseRate),
    fmtInt(totals.tokensOut),
  ].join(" | ");
}

function renderHarnessSummarySection(report: HarnessMonthlyReport): string {
  const header =
    "| harness | runs | totalInput | freshInput | cacheRead | cache率 | tokensOut |\n" +
    "|---|---|---|---|---|---|---|";
  const rows = report.harnessSegments.map(
    (segment) => `| ${segment.harness} | ${totalsRow(segment.totals)} |`,
  );
  return ["## 1. harness別サマリ", "", header, ...rows].join("\n");
}

function renderSegmentTable(
  title: string,
  segments: readonly HarnessMonthlySegment<"model" | "repo">[],
  keyLabel: string,
): string {
  const header =
    `| ${keyLabel} | harness | runs | totalInput | freshInput | cacheRead | cache率 | tokensOut | avg/run |\n` +
    "|---|---|---|---|---|---|---|---|---|";
  const rows = segments.map(
    (segment) =>
      `| ${segment.key} | ${segment.harness} | ${totalsRow(segment.totals)} | ${fmtInt(segment.totals.avgTotalInputPerRun !== null ? Math.round(segment.totals.avgTotalInputPerRun) : null)} |`,
  );
  return [title, "", header, ...rows].join("\n");
}

function renderCostSection(
  title: string,
  costJoin: HarnessMonthlyCostJoin,
): string {
  const header =
    "| model | costUSD | totalInput | blended $/M | matched |\n" +
    "|---|---|---|---|---|";
  const rows = costJoin.entries.map(
    (entry) =>
      `| ${entry.model} | ${fmtUsd(entry.costUSD)} | ${fmtInt(entry.totalInput)} | ${fmtUsdOrNa(entry.blendedUsdPerMTokTotalInput)} | ${entry.matched ? "yes" : "no"} |`,
  );
  const notes = [
    `合計コスト: $${fmtUsd(costJoin.totalCostUSD)}`,
    `DBのみ(コスト情報なし): ${costJoin.unmatchedDbModels.length === 0 ? "なし" : costJoin.unmatchedDbModels.join(", ")}`,
    `コストのみ(DBに対応runなし): ${costJoin.unmatchedCostModels.length === 0 ? "なし" : costJoin.unmatchedCostModels.join(", ")}`,
  ];
  return [title, "", header, ...rows, "", ...notes].join("\n");
}

function renderDataQualitySection(report: HarnessMonthlyReport, sectionNumber: number): string {
  const dq = report.dataQuality;
  const lines = [
    `## ${sectionNumber}. データ品質ノート`,
    "",
    `queried=${report.summary.queried} supported=${report.summary.supported} excluded=${report.summary.excluded}`,
    `射影欠落行(旧collector期): ${dq.projectionMissing}`,
    `射影ドリフト検査済み行: ${dq.projectionDriftChecked} / 不一致: ${dq.projectionDriftMismatched}`,
    `model不明のrun数: ${dq.unknownModelRuns} / repo不明のrun数: ${dq.unknownRepoRuns}`,
  ];
  if (report.summary.calculationErrorCount > 0) {
    lines.push(`⚠️ calculationErrorCount=${report.summary.calculationErrorCount}(集計overflow検出)`);
  }
  if (Object.keys(report.summary.exclusionReasons).length > 0) {
    lines.push(`除外理由: ${JSON.stringify(report.summary.exclusionReasons)}`);
  }
  return lines.join("\n");
}

export function renderHarnessMonthlyReportMarkdown(
  report: HarnessMonthlyReport,
  costJoin?: HarnessMonthlyCostJoin,
): string {
  const sections = [
    `# Harness Report ${report.month}`,
    renderHarnessSummarySection(report),
    renderSegmentTable("## 2. モデル別 (totalInput降順)", report.modelSegments, "model"),
    renderSegmentTable("## 3. repo別 (上位10+その他、totalInput降順)", report.repoSegments, "repo"),
  ];
  let sectionNumber = 4;
  if (costJoin !== undefined) {
    sections.push(renderCostSection(`## ${sectionNumber}. コスト`, costJoin));
    sectionNumber += 1;
  }
  sections.push(renderDataQualitySection(report, sectionNumber));
  return `${sections.join("\n\n")}\n`;
}
