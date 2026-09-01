import { renderHarnessMonthlyReportMarkdown } from "./harness-monthly-report-render";
import {
  joinHarnessMonthlyCosts,
  type HarnessMonthlyCostJoin,
  type ModelCostEntry,
} from "./harness-monthly-cost-join";
import {
  parseHarnessReportMonth,
  type HarnessMonthlyReport,
  type ValidHarnessReportMonth,
} from "./harness-monthly-report";

type OptionErrorCode =
  | "missing_required_option"
  | "missing_option_value"
  | "unknown_option"
  | "duplicate_option"
  | "invalid_month";

type ParsedOptions =
  | {
      ok: true;
      month: ValidHarnessReportMonth;
      json: boolean;
      costsJsonPath: string | null;
    }
  | { ok: false; code: OptionErrorCode };

export type HarnessMonthlyReportCliDependencies = {
  query(month: ValidHarnessReportMonth): Promise<HarnessMonthlyReport>;
  readFile(path: string): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
};

function parseOptions(args: readonly string[]): ParsedOptions {
  let monthValue: string | null = null;
  let json = false;
  let costsJsonPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--month") {
      if (monthValue !== null) return { ok: false, code: "duplicate_option" };
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, code: "missing_option_value" };
      }
      monthValue = value;
      index += 1;
      continue;
    }
    if (argument === "--costs-json") {
      if (costsJsonPath !== null) return { ok: false, code: "duplicate_option" };
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, code: "missing_option_value" };
      }
      costsJsonPath = value;
      index += 1;
      continue;
    }
    return { ok: false, code: "unknown_option" };
  }

  if (monthValue === null) return { ok: false, code: "missing_required_option" };
  const parsedMonth = parseHarnessReportMonth(monthValue);
  if (!parsedMonth.ok) return { ok: false, code: "invalid_month" };
  return { ok: true, month: parsedMonth, json, costsJsonPath };
}

function fail(
  dependencies: HarnessMonthlyReportCliDependencies,
  code:
    | OptionErrorCode
    | "query_failed"
    | "costs_json_read_failed"
    | "costs_json_invalid"
    | "aggregate_overflow",
): 1 {
  dependencies.stderr(`error: ${code}\n`);
  return 1;
}

function parseCostEntries(text: string): ModelCostEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("costs json must be an array of {model, costUSD}");
  }
  return parsed.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { model?: unknown }).model !== "string" ||
      typeof (entry as { costUSD?: unknown }).costUSD !== "number"
    ) {
      throw new Error("invalid cost entry shape");
    }
    return {
      model: (entry as { model: string }).model,
      costUSD: (entry as { costUSD: number }).costUSD,
    };
  });
}

export async function runHarnessMonthlyReportCli(
  argv: readonly string[],
  dependencies: HarnessMonthlyReportCliDependencies,
): Promise<number> {
  const options = parseOptions(argv);
  if (!options.ok) {
    return fail(dependencies, options.code);
  }

  let report: HarnessMonthlyReport;
  try {
    report = await dependencies.query(options.month);
  } catch {
    return fail(dependencies, "query_failed");
  }

  let costJoin: HarnessMonthlyCostJoin | undefined;
  if (options.costsJsonPath !== null) {
    let text: string;
    try {
      text = await dependencies.readFile(options.costsJsonPath);
    } catch {
      return fail(dependencies, "costs_json_read_failed");
    }
    try {
      const costs = parseCostEntries(text);
      costJoin = joinHarnessMonthlyCosts(report, costs);
    } catch {
      return fail(dependencies, "costs_json_invalid");
    }
  }

  dependencies.stdout(
    options.json
      ? `${JSON.stringify({ report, costJoin: costJoin ?? null })}\n`
      : renderHarnessMonthlyReportMarkdown(report, costJoin),
  );

  if (report.summary.calculationErrorCount > 0) {
    return fail(dependencies, "aggregate_overflow");
  }
  return 0;
}
