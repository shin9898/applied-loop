import {
  parseHarnessAuditWeek,
  type HarnessCacheAuditReport,
  type ValidHarnessAuditWeek,
} from "./harness-cache-audit";

type OptionErrorCode =
  | "missing_required_option"
  | "missing_option_value"
  | "unknown_option"
  | "duplicate_option"
  | "invalid_iso_week";

type ParsedOptions =
  | { ok: true; week: ValidHarnessAuditWeek; json: boolean }
  | { ok: false; code: OptionErrorCode };

export type HarnessCacheAuditCliDependencies = {
  query(week: ValidHarnessAuditWeek): Promise<HarnessCacheAuditReport>;
  stdout(text: string): void;
  stderr(text: string): void;
};

function parseOptions(args: readonly string[]): ParsedOptions {
  let weekValue: string | null = null;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument !== "--week") {
      return { ok: false, code: "unknown_option" };
    }
    if (weekValue !== null) {
      return { ok: false, code: "duplicate_option" };
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, code: "missing_option_value" };
    }
    weekValue = value;
    index += 1;
  }

  if (weekValue === null) {
    return { ok: false, code: "missing_required_option" };
  }
  const parsedWeek = parseHarnessAuditWeek(weekValue);
  if (!parsedWeek.ok) {
    return { ok: false, code: "invalid_iso_week" };
  }
  return { ok: true, week: parsedWeek, json };
}

function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(3)}%`;
}

export function renderHarnessCacheAuditHuman(
  report: HarnessCacheAuditReport,
): string {
  const lines = [
    `Harness cache audit: ${report.week}`,
    `Window: [${report.window.startInclusive}, ${report.window.endExclusive}) ${report.window.timezone}`,
    `Semantics: ${report.semanticsVersion}`,
    `Summary: queried=${report.summary.queried} supported=${report.summary.supported} excluded=${report.summary.excluded} calculationErrors=${report.summary.calculationErrorCount}`,
  ];

  for (const segment of report.segments) {
    lines.push(
      `Segment: ${segment.harness} provider=${segment.provider} semantics=${segment.semanticsVersion}`,
      `  Counts: supported=${segment.supportedCount} excluded=${segment.excludedCount}`,
      `  Exclusion reasons: ${JSON.stringify(segment.exclusionReasons)}`,
      `  Raw totals: ${JSON.stringify(segment.rawTotals)}`,
      `  Legacy denominator: ${String(segment.legacy.denominator)}`,
      `  Legacy cache-reuse rate: ${formatRate(segment.legacy.rate)}`,
      `  Normalized totals: ${JSON.stringify({
        totalInput: segment.normalized.totalInput,
        cacheRead: segment.normalized.cacheRead,
        cacheWrite: segment.normalized.cacheWrite,
        freshInput: segment.normalized.freshInput,
      })}`,
      `  Normalized cache-reuse rate: ${formatRate(segment.normalized.rate)}`,
      `  Calculation errors: ${JSON.stringify(segment.calculationErrors)}`,
    );
  }

  for (const segment of report.unsupportedSegments) {
    lines.push(
      `Unsupported: harness=${segment.harness} reason=${segment.reason} count=${segment.count}`,
    );
  }
  lines.push(`Exclusion reasons: ${JSON.stringify(report.summary.exclusionReasons)}`);
  return `${lines.join("\n")}\n`;
}

function fail(
  dependencies: HarnessCacheAuditCliDependencies,
  code: OptionErrorCode | "query_failed" | "aggregate_overflow",
): 1 {
  dependencies.stderr(`error: ${code}\n`);
  return 1;
}

export async function runHarnessCacheAuditCli(
  args: readonly string[],
  dependencies: HarnessCacheAuditCliDependencies,
): Promise<number> {
  const options = parseOptions(args);
  if (!options.ok) {
    return fail(dependencies, options.code);
  }

  let report: HarnessCacheAuditReport;
  try {
    report = await dependencies.query(options.week);
  } catch {
    return fail(dependencies, "query_failed");
  }

  dependencies.stdout(
    options.json ? `${JSON.stringify(report)}\n` : renderHarnessCacheAuditHuman(report),
  );
  if (report.summary.calculationErrorCount > 0) {
    return fail(dependencies, "aggregate_overflow");
  }
  return 0;
}
