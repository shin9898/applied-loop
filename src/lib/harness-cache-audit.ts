import {
  HARNESS_USAGE_SEMANTICS_VERSION,
  normalizeHarnessUsage,
  type HarnessUsageInput,
  type HarnessUsageNormalizationResult,
} from "./harness-usage-normalization";

const DAY_MS = 24 * 60 * 60 * 1_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export type HarnessAuditWindow = {
  timezone: "Asia/Tokyo";
  startInclusive: string;
  endExclusive: string;
};

export type ParsedHarnessAuditWeek =
  | { ok: true; week: string; window: HarnessAuditWindow }
  | { ok: false; reason: "invalid_iso_week" };

export type ValidHarnessAuditWeek = Extract<ParsedHarnessAuditWeek, { ok: true }>;

type KnownHarness = "claude" | "codex";
type Provider = "anthropic" | "openai";
type CalculationField =
  | "rawTotals.tokensIn"
  | "rawTotals.cacheRead"
  | "rawTotals.cacheCreate"
  | "legacy.denominator"
  | "normalized.totalInput"
  | "normalized.cacheRead"
  | "normalized.cacheWrite"
  | "normalized.freshInput";
type ExclusionReason = Exclude<
  HarnessUsageNormalizationResult,
  { status: "supported" }
>["reason"];

export type HarnessCacheAuditSegment = {
  harness: KnownHarness;
  provider: Provider;
  semanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  supportedCount: number;
  excludedCount: number;
  exclusionReasons: Partial<Record<ExclusionReason, number>>;
  rawTotals: {
    tokensIn: number | null;
    cacheRead: number | null;
    cacheCreate: number | null;
  };
  legacy: { denominator: number | null; rate: number | null };
  normalized: {
    totalInput: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    freshInput: number | null;
    rate: number | null;
  };
  calculationErrors: Array<{
    code: "aggregate_overflow";
    field: CalculationField;
  }>;
};

export type HarnessCacheAuditReport = {
  week: string;
  window: HarnessAuditWindow;
  semanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  segments: HarnessCacheAuditSegment[];
  unsupportedSegments: Array<{
    harness: string;
    reason: ExclusionReason;
    count: number;
  }>;
  summary: {
    queried: number;
    supported: number;
    excluded: number;
    exclusionReasons: Partial<Record<ExclusionReason, number>>;
    calculationErrorCount: number;
  };
};

type MutableSegment = {
  harness: KnownHarness;
  provider: Provider;
  supportedCount: number;
  excludedCount: number;
  exclusionReasons: Map<ExclusionReason, number>;
  rawTotals: {
    tokensIn: number | null;
    cacheRead: number | null;
    cacheCreate: number | null;
  };
  legacyDenominator: number | null;
  normalized: {
    totalInput: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    freshInput: number | null;
  };
};

const CALCULATION_FIELDS: readonly CalculationField[] = [
  "rawTotals.tokensIn",
  "rawTotals.cacheRead",
  "rawTotals.cacheCreate",
  "legacy.denominator",
  "normalized.totalInput",
  "normalized.cacheRead",
  "normalized.cacheWrite",
  "normalized.freshInput",
];

function utcCivilDate(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date.getTime();
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isoWeekday(timestamp: number): number {
  return new Date(timestamp).getUTCDay() || 7;
}

function weeksInIsoYear(year: number): 52 | 53 {
  const januaryFirst = isoWeekday(utcCivilDate(year, 0, 1));
  return januaryFirst === 4 || (januaryFirst === 3 && isLeapYear(year))
    ? 53
    : 52;
}

export function parseHarnessAuditWeek(week: string): ParsedHarnessAuditWeek {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (match === null) return { ok: false, reason: "invalid_iso_week" };

  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > weeksInIsoYear(year)) {
    return { ok: false, reason: "invalid_iso_week" };
  }

  const januaryFourth = utcCivilDate(year, 0, 4);
  const weekOneMonday = januaryFourth - (isoWeekday(januaryFourth) - 1) * DAY_MS;
  const startInclusive =
    weekOneMonday + (weekNumber - 1) * 7 * DAY_MS - JST_OFFSET_MS;

  return {
    ok: true,
    week,
    window: {
      timezone: "Asia/Tokyo",
      startInclusive: new Date(startInclusive).toISOString(),
      endExclusive: new Date(startInclusive + 7 * DAY_MS).toISOString(),
    },
  };
}

function isKnownHarness(harness: string): harness is KnownHarness {
  return harness === "claude" || harness === "codex";
}

function providerFor(harness: KnownHarness): Provider {
  return harness === "claude" ? "anthropic" : "openai";
}

function createSegment(harness: KnownHarness): MutableSegment {
  return {
    harness,
    provider: providerFor(harness),
    supportedCount: 0,
    excludedCount: 0,
    exclusionReasons: new Map(),
    rawTotals: { tokensIn: 0, cacheRead: 0, cacheCreate: 0 },
    legacyDenominator: 0,
    normalized: {
      totalInput: 0,
      cacheRead: 0,
      cacheWrite: harness === "claude" ? 0 : null,
      freshInput: 0,
    },
  };
}

function incrementReason(
  reasons: Map<ExclusionReason, number>,
  reason: ExclusionReason,
): void {
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedReasonRecord(
  reasons: Map<ExclusionReason, number>,
): Partial<Record<ExclusionReason, number>> {
  return Object.fromEntries(
    [...reasons.entries()].sort(([left], [right]) => lexicalCompare(left, right)),
  );
}

function checkedAggregateAdd(
  total: number | null,
  addend: number | null,
): number | null {
  if (total === null || addend === null) return null;
  if (addend > Number.MAX_SAFE_INTEGER - total) return null;
  return total + addend;
}

function rateOrNull(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function calculationValue(
  segment: MutableSegment,
  field: CalculationField,
): number | null {
  switch (field) {
    case "rawTotals.tokensIn":
      return segment.rawTotals.tokensIn;
    case "rawTotals.cacheRead":
      return segment.rawTotals.cacheRead;
    case "rawTotals.cacheCreate":
      return segment.rawTotals.cacheCreate;
    case "legacy.denominator":
      return segment.legacyDenominator;
    case "normalized.totalInput":
      return segment.normalized.totalInput;
    case "normalized.cacheRead":
      return segment.normalized.cacheRead;
    case "normalized.cacheWrite":
      return segment.normalized.cacheWrite;
    case "normalized.freshInput":
      return segment.normalized.freshInput;
  }
}

function calculationErrors(
  segment: MutableSegment,
): HarnessCacheAuditSegment["calculationErrors"] {
  return CALCULATION_FIELDS.filter((field) => {
    if (field === "normalized.cacheWrite" && segment.harness === "codex") {
      return false;
    }
    return calculationValue(segment, field) === null;
  }).map((field) => ({ code: "aggregate_overflow", field }));
}

export function buildHarnessCacheAuditReport(
  parsedWeek: ValidHarnessAuditWeek,
  rows: readonly HarnessUsageInput[],
): HarnessCacheAuditReport {
  const segments = new Map<KnownHarness, MutableSegment>();
  const unsupported = new Map<
    string,
    { harness: string; reason: ExclusionReason; count: number }
  >();
  const summaryReasons = new Map<ExclusionReason, number>();
  let supported = 0;

  for (const row of rows) {
    const result = normalizeHarnessUsage(row);
    if (!isKnownHarness(row.harness)) {
      if (result.status === "supported") {
        throw new Error("unknown harness normalized as supported");
      }
      const key = `${row.harness}\u0000${result.reason}`;
      const group = unsupported.get(key);
      if (group === undefined) {
        unsupported.set(key, { harness: row.harness, reason: result.reason, count: 1 });
      } else {
        group.count += 1;
      }
      incrementReason(summaryReasons, result.reason);
      continue;
    }

    let segment = segments.get(row.harness);
    if (segment === undefined) {
      segment = createSegment(row.harness);
      segments.set(row.harness, segment);
    }

    if (result.status !== "supported") {
      segment.excludedCount += 1;
      incrementReason(segment.exclusionReasons, result.reason);
      incrementReason(summaryReasons, result.reason);
      continue;
    }

    supported += 1;
    segment.supportedCount += 1;
    segment.rawTotals.tokensIn = checkedAggregateAdd(
      segment.rawTotals.tokensIn,
      row.tokensIn,
    );
    segment.rawTotals.cacheRead = checkedAggregateAdd(
      segment.rawTotals.cacheRead,
      row.cacheRead,
    );
    segment.rawTotals.cacheCreate = checkedAggregateAdd(
      segment.rawTotals.cacheCreate,
      row.cacheCreate,
    );
    const rowLegacyDenominator = checkedAggregateAdd(
      checkedAggregateAdd(row.tokensIn, row.cacheRead),
      row.cacheCreate,
    );
    segment.legacyDenominator = checkedAggregateAdd(
      segment.legacyDenominator,
      rowLegacyDenominator,
    );
    segment.normalized.totalInput = checkedAggregateAdd(
      segment.normalized.totalInput,
      result.totalInput,
    );
    segment.normalized.cacheRead = checkedAggregateAdd(
      segment.normalized.cacheRead,
      result.cacheRead,
    );
    if (segment.normalized.cacheWrite !== null && result.cacheWrite !== null) {
      segment.normalized.cacheWrite = checkedAggregateAdd(
        segment.normalized.cacheWrite,
        result.cacheWrite,
      );
    }
    segment.normalized.freshInput = checkedAggregateAdd(
      segment.normalized.freshInput,
      result.freshInput,
    );
  }

  const compatibleSegments = [...segments.values()]
    .sort((left, right) => lexicalCompare(left.harness, right.harness))
    .map<HarnessCacheAuditSegment>((segment) => {
      const legacyRate = rateOrNull(
        segment.rawTotals.cacheRead,
        segment.legacyDenominator,
      );
      const normalizedRate = rateOrNull(
        segment.normalized.cacheRead,
        segment.normalized.totalInput,
      );
      return {
        harness: segment.harness,
        provider: segment.provider,
        semanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
        supportedCount: segment.supportedCount,
        excludedCount: segment.excludedCount,
        exclusionReasons: sortedReasonRecord(segment.exclusionReasons),
        rawTotals: { ...segment.rawTotals },
        legacy: { denominator: segment.legacyDenominator, rate: legacyRate },
        normalized: { ...segment.normalized, rate: normalizedRate },
        calculationErrors: calculationErrors(segment),
      };
    });

  const excluded = rows.length - supported;
  const calculationErrorCount = compatibleSegments.reduce(
    (total, segment) => total + segment.calculationErrors.length,
    0,
  );
  return {
    week: parsedWeek.week,
    window: { ...parsedWeek.window },
    semanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    segments: compatibleSegments,
    unsupportedSegments: [...unsupported.values()].sort(
      (left, right) =>
        lexicalCompare(left.harness, right.harness) ||
        lexicalCompare(left.reason, right.reason),
    ),
    summary: {
      queried: rows.length,
      supported,
      excluded,
      exclusionReasons: sortedReasonRecord(summaryReasons),
      calculationErrorCount,
    },
  };
}
