import type { HarnessMonthlyReport } from "./harness-monthly-report";

export type ModelCostEntry = Readonly<{ model: string; costUSD: number }>;

export type HarnessMonthlyCostJoinEntry = {
  model: string;
  costUSD: number;
  totalInput: number | null;
  blendedUsdPerMTokTotalInput: number | null;
  matched: boolean;
};

export type HarnessMonthlyCostJoin = {
  entries: HarnessMonthlyCostJoinEntry[];
  unmatchedDbModels: string[];
  unmatchedCostModels: string[];
  totalCostUSD: number;
};

function totalInputByModel(report: HarnessMonthlyReport): Map<string, number | null> {
  const totals = new Map<string, number | null>();
  for (const segment of report.modelSegments) {
    const existing = totals.has(segment.key) ? totals.get(segment.key)! : 0;
    const value = segment.totals.totalInput;
    if (existing === null || value === null) {
      totals.set(segment.key, null);
    } else {
      totals.set(segment.key, existing + value);
    }
  }
  return totals;
}

export function joinHarnessMonthlyCosts(
  report: HarnessMonthlyReport,
  costs: readonly ModelCostEntry[],
): HarnessMonthlyCostJoin {
  for (const cost of costs) {
    if (cost.costUSD < 0) {
      throw new RangeError(`costUSD must not be negative for model "${cost.model}"`);
    }
  }

  const dbTotals = totalInputByModel(report);
  const matchedModels = new Set<string>();

  const entries: HarnessMonthlyCostJoinEntry[] = costs.map((cost) => {
    const totalInput = dbTotals.has(cost.model) ? dbTotals.get(cost.model)! : null;
    const matched = dbTotals.has(cost.model);
    if (matched) matchedModels.add(cost.model);
    const blendedUsdPerMTokTotalInput =
      totalInput !== null && totalInput > 0
        ? (cost.costUSD / totalInput) * 1_000_000
        : null;
    return {
      model: cost.model,
      costUSD: cost.costUSD,
      totalInput,
      blendedUsdPerMTokTotalInput,
      matched,
    };
  });

  const unmatchedCostModels = entries
    .filter((entry) => !entry.matched)
    .map((entry) => entry.model);
  const unmatchedDbModels = [...dbTotals.keys()]
    .filter((model) => !matchedModels.has(model))
    .sort();

  const totalCostUSD = costs.reduce((total, cost) => total + cost.costUSD, 0);

  return { entries, unmatchedDbModels, unmatchedCostModels, totalCostUSD };
}
