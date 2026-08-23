import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import {
  projectHarnessUsageEvidence,
  type HarnessUsageEvidence,
} from "./harness-usage-evidence";

export const HARNESS_USAGE_BACKFILL_PLAN_VERSION =
  "harness-usage-backfill-plan-v1" as const;

export type HarnessUsageBackfillRow = Readonly<{
  harness: string;
  tokensIn: number;
  cacheRead: number;
  cacheCreate: number;
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageSemanticsVersion: string | null;
  usageNormalizationStatus: string | null;
  usageNormalizationReason: string | null;
}>;

export type HarnessUsageBackfillPlan = Readonly<{
  schemaVersion: typeof HARNESS_USAGE_BACKFILL_PLAN_VERSION;
  mode: "dry_run";
  source: Readonly<{
    totalRows: number;
    legacyUnprojectedRows: number;
    existingEvidenceRows: number;
  }>;
  proposal: Readonly<{
    wouldWriteRows: number;
    statusCounts: Readonly<{
      supported: number;
      no_sample: number;
      invalid: number;
      unsupported: number;
    }>;
    reasonCounts: Readonly<Record<string, number>>;
    derivedFieldChanges: Readonly<{
      inputTotalTokens: Readonly<{ nonNull: number; null: number }>;
      inputUncachedTokens: Readonly<{ nonNull: number; null: number }>;
      cacheReadTokens: Readonly<{ nonNull: number; null: number }>;
      cacheWriteTokens: Readonly<{ nonNull: number; null: number }>;
      usageSemanticsVersion: Readonly<{ nonNull: number; null: number }>;
      usageNormalizationStatus: Readonly<{ nonNull: number; null: number }>;
      usageNormalizationReason: Readonly<{ nonNull: number; null: number }>;
    }>;
  }>;
}>;

type EvidenceField = keyof HarnessUsageEvidence;
type DerivedFieldChanges = Record<EvidenceField, { nonNull: number; null: number }>;

const EVIDENCE_FIELDS = [
  "inputTotalTokens",
  "inputUncachedTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "usageSemanticsVersion",
  "usageNormalizationStatus",
  "usageNormalizationReason",
] as const satisfies readonly EvidenceField[];

function emptyDerivedFieldChanges(): DerivedFieldChanges {
  return {
    inputTotalTokens: { nonNull: 0, null: 0 },
    inputUncachedTokens: { nonNull: 0, null: 0 },
    cacheReadTokens: { nonNull: 0, null: 0 },
    cacheWriteTokens: { nonNull: 0, null: 0 },
    usageSemanticsVersion: { nonNull: 0, null: 0 },
    usageNormalizationStatus: { nonNull: 0, null: 0 },
    usageNormalizationReason: { nonNull: 0, null: 0 },
  };
}

const selection = {
  harness: true,
  tokensIn: true,
  cacheRead: true,
  cacheCreate: true,
  inputTotalTokens: true,
  inputUncachedTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  usageSemanticsVersion: true,
  usageNormalizationStatus: true,
  usageNormalizationReason: true,
} as const;

export type HarnessUsageBackfillFindManyArgs = Readonly<{
  select: typeof selection;
}>;

export type HarnessUsageBackfillQueryClient = Readonly<{
  harnessRun: Readonly<{
    findMany(args: HarnessUsageBackfillFindManyArgs): Promise<HarnessUsageBackfillRow[]>;
  }>;
  $disconnect(): Promise<void>;
}>;

function isLegacyUnprojected(row: HarnessUsageBackfillRow): boolean {
  return [
    row.inputTotalTokens,
    row.inputUncachedTokens,
    row.cacheReadTokens,
    row.cacheWriteTokens,
    row.usageSemanticsVersion,
    row.usageNormalizationStatus,
    row.usageNormalizationReason,
  ].every((value) => value === null);
}

/**
 * Builds a no-write plan from raw counters only. It deliberately omits ids,
 * repos, models, and sessions so the automation-safe report cannot become a
 * second telemetry store.
 */
export function buildHarnessUsageBackfillPlan(
  rows: readonly HarnessUsageBackfillRow[],
): HarnessUsageBackfillPlan {
  const statusCounts = {
    supported: 0,
    no_sample: 0,
    invalid: 0,
    unsupported: 0,
  };
  const reasonCounts: Record<string, number> = {};
  const derivedFieldChanges = emptyDerivedFieldChanges();
  let legacyUnprojectedRows = 0;

  for (const row of rows) {
    if (!isLegacyUnprojected(row)) continue;
    legacyUnprojectedRows += 1;
    const projected = projectHarnessUsageEvidence(row);
    statusCounts[projected.usageNormalizationStatus] += 1;
    for (const field of EVIDENCE_FIELDS) {
      derivedFieldChanges[field][projected[field] === null ? "null" : "nonNull"] += 1;
    }
    if (projected.usageNormalizationReason !== null) {
      reasonCounts[projected.usageNormalizationReason] =
        (reasonCounts[projected.usageNormalizationReason] ?? 0) + 1;
    }
  }

  const sortedReasonCounts = Object.fromEntries(
    Object.entries(reasonCounts).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    schemaVersion: HARNESS_USAGE_BACKFILL_PLAN_VERSION,
    mode: "dry_run",
    source: {
      totalRows: rows.length,
      legacyUnprojectedRows,
      existingEvidenceRows: rows.length - legacyUnprojectedRows,
    },
    proposal: {
      wouldWriteRows: legacyUnprojectedRows,
      statusCounts,
      reasonCounts: sortedReasonCounts,
      derivedFieldChanges,
    },
  };
}

export function createReadonlyHarnessUsageBackfillClient(
  url: string,
): HarnessUsageBackfillQueryClient {
  const adapter = new PrismaBetterSqlite3({
    url,
    readonly: true,
    fileMustExist: true,
  });
  return new PrismaClient({ adapter });
}

export async function queryHarnessUsageBackfill(
  client: HarnessUsageBackfillQueryClient,
): Promise<HarnessUsageBackfillPlan> {
  try {
    const rows = await client.harnessRun.findMany({ select: selection });
    return buildHarnessUsageBackfillPlan(rows);
  } finally {
    await client.$disconnect();
  }
}

export function queryReadonlyHarnessUsageBackfill(
  url: string,
): Promise<HarnessUsageBackfillPlan> {
  return queryHarnessUsageBackfill(createReadonlyHarnessUsageBackfillClient(url));
}

type CliOptionError = "missing_required_option" | "unknown_option" | "duplicate_option";

export type HarnessUsageBackfillCliDependencies = Readonly<{
  query(): Promise<HarnessUsageBackfillPlan>;
  stdout(text: string): void;
  stderr(text: string): void;
}>;

function parseCliOptions(args: readonly string[]): { ok: true } | { ok: false; code: CliOptionError } {
  let json = false;
  for (const argument of args) {
    if (argument !== "--json") return { ok: false, code: "unknown_option" };
    if (json) return { ok: false, code: "duplicate_option" };
    json = true;
  }
  return json ? { ok: true } : { ok: false, code: "missing_required_option" };
}

function fail(
  dependencies: HarnessUsageBackfillCliDependencies,
  code: CliOptionError | "query_failed",
): 1 {
  dependencies.stderr(`error: ${code}\n`);
  return 1;
}

export async function runHarnessUsageBackfillCli(
  args: readonly string[],
  dependencies: HarnessUsageBackfillCliDependencies,
): Promise<number> {
  const options = parseCliOptions(args);
  if (!options.ok) return fail(dependencies, options.code);
  try {
    const report = await dependencies.query();
    dependencies.stdout(`${JSON.stringify(report)}\n`);
    return 0;
  } catch {
    return fail(dependencies, "query_failed");
  }
}
