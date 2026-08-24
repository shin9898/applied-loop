import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachHCycleEvidencePeriodV1,
  type HCycleEvidenceSnapshotV1,
} from "./h-cycle-evidence-adapter";
import {
  evaluateHCycleEvidencePolicyV1,
  H_CYCLE_POLICY_VERSION_V1,
  projectHCycleEvidenceV1,
  type HCycleEvidencePolicyResultV1,
  type HCycleEvidenceProjectionV1,
  type HCyclePeriodV1,
} from "./h-cycle-projection";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type PreviewErrorCode =
  | "missing_database_url"
  | "invalid_database_url"
  | "missing_required_option"
  | "missing_option_value"
  | "duplicate_option"
  | "unknown_option"
  | "invalid_iso_week"
  | "week_not_completed"
  | "query_failed"
  | "internal_error";

type ParsedOptions =
  | Readonly<{ ok: true; weekKey: string }>
  | Readonly<{ ok: false; code: Extract<PreviewErrorCode, "missing_required_option" | "missing_option_value" | "duplicate_option" | "unknown_option"> }>;

type ParsedWeek = Readonly<{ year: number; week: number; weekKey: string }>;

type PeriodPair = readonly [HCyclePeriodV1, HCyclePeriodV1];

export type HCycleEvidencePreviewV1 = Readonly<{
  schema: "h_cycle_evidence_preview_v1";
  policyVersion: typeof H_CYCLE_POLICY_VERSION_V1;
  targetWeekKey: string;
  projections: readonly [HCycleEvidenceProjectionV1, HCycleEvidenceProjectionV1];
  policy: HCycleEvidencePolicyResultV1;
}>;

export type HCycleEvidencePreviewCliDependencies = Readonly<{
  databaseUrl: string | undefined;
  now(): Date;
  querySnapshot(url: string): Promise<HCycleEvidenceSnapshotV1>;
  stdout(text: string): void;
  stderr(text: string): void;
}>;

function fail(
  dependencies: HCycleEvidencePreviewCliDependencies,
  code: PreviewErrorCode,
): 1 {
  dependencies.stderr(`error: ${code}\n`);
  return 1;
}

function parseOptions(args: readonly string[]): ParsedOptions {
  let weekKey: string | null = null;
  let hasJson = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (hasJson) return { ok: false, code: "duplicate_option" };
      hasJson = true;
      continue;
    }
    if (argument !== "--week") return { ok: false, code: "unknown_option" };
    if (weekKey !== null) return { ok: false, code: "duplicate_option" };
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, code: "missing_option_value" };
    weekKey = value;
    index += 1;
  }

  if (weekKey === null || !hasJson) return { ok: false, code: "missing_required_option" };
  return { ok: true, weekKey };
}

function firstJstIsoMondayMs(year: number): number {
  const janFourthMs = Date.UTC(year, 0, 4);
  const janFourthWeekday = new Date(janFourthMs).getUTCDay() || 7;
  return janFourthMs - (janFourthWeekday - 1) * DAY_MS - JST_OFFSET_MS;
}

function isoWeeksInYear(year: number): number {
  return Math.round((firstJstIsoMondayMs(year + 1) - firstJstIsoMondayMs(year)) / WEEK_MS);
}

function parseIsoWeek(raw: string): ParsedWeek | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(raw);
  if (match === null) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isSafeInteger(year) || year < 1 || !Number.isSafeInteger(week) || week < 1 || week > isoWeeksInYear(year)) {
    return null;
  }
  return Object.freeze({ year, week, weekKey: raw });
}

function isoWeekKeyForJstMonday(start: Date): string {
  const jstMonday = new Date(start.getTime() + JST_OFFSET_MS);
  const mondayMs = Date.UTC(
    jstMonday.getUTCFullYear(),
    jstMonday.getUTCMonth(),
    jstMonday.getUTCDate(),
  );
  const thursday = new Date(mondayMs);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstMondayMs = firstJstIsoMondayMs(isoYear) + JST_OFFSET_MS;
  const week = Math.floor((mondayMs - firstMondayMs) / WEEK_MS) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function periodForJstMonday(start: Date, weekKey: string): HCyclePeriodV1 {
  const end = new Date(start.getTime() + WEEK_MS);
  return Object.freeze({ weekKey, start, end, asOf: end });
}

function createCompletedPeriodPair(
  targetWeek: ParsedWeek,
  now: Date,
): Readonly<{ ok: true; periods: PeriodPair }> | Readonly<{ ok: false; code: "week_not_completed" | "internal_error" }> {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, code: "internal_error" };
  const targetStart = new Date(firstJstIsoMondayMs(targetWeek.year) + (targetWeek.week - 1) * WEEK_MS);
  const target = periodForJstMonday(targetStart, targetWeek.weekKey);
  if (target.end.getTime() > nowMs) return { ok: false, code: "week_not_completed" };
  const previousStart = new Date(target.start.getTime() - WEEK_MS);
  const previous = periodForJstMonday(previousStart, isoWeekKeyForJstMonday(previousStart));
  return { ok: true, periods: [previous, target] };
}

function validateDatabaseUrl(raw: string | undefined): Readonly<{ ok: true; url: string }> | Readonly<{ ok: false; code: "missing_database_url" | "invalid_database_url" }> {
  if (raw === undefined) return { ok: false, code: "missing_database_url" };
  if (raw.length === 0 || raw.trim() !== raw || !raw.startsWith("file:/")) {
    return { ok: false, code: "invalid_database_url" };
  }
  const rawAuthority = /^file:\/\/([^/]*)(?:\/|$)/.exec(raw);
  if (rawAuthority !== null && rawAuthority[1] !== "") return { ok: false, code: "invalid_database_url" };
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "file:"
      || parsed.host !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || !isAbsolute(fileURLToPath(parsed))
    ) {
      return { ok: false, code: "invalid_database_url" };
    }
  } catch {
    return { ok: false, code: "invalid_database_url" };
  }
  return { ok: true, url: raw };
}

export function buildHCycleEvidencePreviewV1(
  snapshot: HCycleEvidenceSnapshotV1,
  periods: PeriodPair,
): HCycleEvidencePreviewV1 {
  const projections = [
    projectHCycleEvidenceV1(attachHCycleEvidencePeriodV1(snapshot, periods[0])),
    projectHCycleEvidenceV1(attachHCycleEvidencePeriodV1(snapshot, periods[1])),
  ] as const;
  return Object.freeze({
    schema: "h_cycle_evidence_preview_v1" as const,
    policyVersion: H_CYCLE_POLICY_VERSION_V1,
    targetWeekKey: periods[1].weekKey,
    projections,
    policy: evaluateHCycleEvidencePolicyV1(projections),
  });
}

export async function runHCycleEvidencePreviewCli(
  args: readonly string[],
  dependencies: HCycleEvidencePreviewCliDependencies,
): Promise<number> {
  const options = parseOptions(args);
  if (!options.ok) return fail(dependencies, options.code);

  const database = validateDatabaseUrl(dependencies.databaseUrl);
  if (!database.ok) return fail(dependencies, database.code);

  const parsedWeek = parseIsoWeek(options.weekKey);
  if (parsedWeek === null) return fail(dependencies, "invalid_iso_week");
  const pair = createCompletedPeriodPair(parsedWeek, dependencies.now());
  if (!pair.ok) return fail(dependencies, pair.code);

  let snapshot: HCycleEvidenceSnapshotV1;
  try {
    snapshot = await dependencies.querySnapshot(database.url);
  } catch {
    return fail(dependencies, "query_failed");
  }

  try {
    dependencies.stdout(`${JSON.stringify(buildHCycleEvidencePreviewV1(snapshot, pair.periods))}\n`);
  } catch {
    return fail(dependencies, "internal_error");
  }
  return 0;
}
