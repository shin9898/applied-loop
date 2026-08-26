import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../../generated/prisma/client";
import { HARNESS_USAGE_SEMANTICS_VERSION } from "../../harness-usage-normalization";
import {
  buildHCacheEvaluationAggregateV1,
  type HCacheEvaluationAggregateV1,
} from "./harness-evaluation-cache-cohort-v1";

const ROOT_KEYS = ["schema", "baseline", "intervention", "followup"] as const;
const OBSERVATION_KEYS = ["schema", "window", "cohort"] as const;
const WINDOW_KEYS = ["startInclusive", "endExclusive"] as const;
const COHORT_KEYS = [
  "harness",
  "model",
  "repo",
  "contextFingerprint",
  "usageSemanticsVersion",
  "collectorVersion",
] as const;
const INTERVENTION_KEYS = [
  "schema",
  "interventionIdHash",
  "beforeContextFingerprint",
  "afterContextFingerprint",
] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTEXT_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * The cohort kernel rejects more than 10,000 samples. Query one additional
 * row so an oversized window becomes an explicit invalid result rather than a
 * silently truncated cache observation.
 */
export const H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1 = 10_000;

export const H_CACHE_EVALUATION_SOURCE_SELECTION_V1 = {
  harness: true,
  model: true,
  repo: true,
  contextFingerprint: true,
  usageSemanticsVersion: true,
  collectorVersion: true,
  inputTotalTokens: true,
  inputUncachedTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  usageNormalizationStatus: true,
  turns: true,
} as const;

type DataRecord = Record<string, unknown>;

export type HCacheEvaluationSourceCohortV1 = Readonly<{
  harness: "claude" | "codex";
  model: string;
  repo: string;
  contextFingerprint: string;
  usageSemanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
  collectorVersion: string;
}>;

export type HCacheEvaluationSourceWindowV1 = Readonly<{
  startInclusive: string;
  endExclusive: string;
}>;

export type HCacheEvaluationSourceObservationV1 = Readonly<{
  cohort: HCacheEvaluationSourceCohortV1;
  window: HCacheEvaluationSourceWindowV1;
}>;

export type HCacheStablePrefixInterventionV1 = Readonly<{
  schema: "h_cache_stable_prefix_intervention_v1";
  interventionIdHash: string;
  beforeContextFingerprint: string;
  afterContextFingerprint: string;
}>;

export type HCacheEvaluationSourceRequestV1 = Readonly<{
  schema: "h_cache_evaluation_source_request_v1";
  baseline: HCacheEvaluationSourceObservationV1 | null;
  intervention: HCacheStablePrefixInterventionV1 | null;
  followup: HCacheEvaluationSourceObservationV1 | null;
}>;

export type HCacheEvaluationSourceRowV1 = Readonly<{
  harness: string;
  model: string | null;
  repo: string | null;
  contextFingerprint: string | null;
  usageSemanticsVersion: string | null;
  collectorVersion: string | null;
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageNormalizationStatus: string | null;
  turns: number;
}>;

export type HCacheEvaluationSourceFindManyArgsV1 = Readonly<{
  where: Readonly<{
    harness: "claude" | "codex";
    model: string;
    repo: string;
    contextFingerprint: string;
    usageSemanticsVersion: typeof HARNESS_USAGE_SEMANTICS_VERSION;
    collectorVersion: string;
    startedAt: Readonly<{
      gte: Date;
      lt: Date;
    }>;
  }>;
  select: typeof H_CACHE_EVALUATION_SOURCE_SELECTION_V1;
  orderBy: Readonly<{ startedAt: "asc" }>;
  take: number;
}>;

export type HCacheEvaluationSourceQueryClientV1 = Readonly<{
  harnessRun: Readonly<{
    findMany(args: HCacheEvaluationSourceFindManyArgsV1): Promise<HCacheEvaluationSourceRowV1[]>;
  }>;
  $disconnect(): Promise<void>;
}>;

type ParsedSourceRequest = Readonly<{
  baseline: ParsedSourceObservation | null;
  intervention: HCacheStablePrefixInterventionV1 | null;
  followup: ParsedSourceObservation | null;
}>;

type ParsedSourceWindow = Readonly<{
  startInclusive: Date;
  endExclusive: Date;
}>;

type ParsedSourceObservation = Readonly<{
  cohort: HCacheEvaluationSourceCohortV1;
  window: ParsedSourceWindow;
}>;

function dataObject(value: unknown): DataRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result: DataRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function hasExactKeys(record: DataRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expectedSorted = [...expected].sort();
  return actual.length === expectedSorted.length && actual.every((key, index) => key === expectedSorted[index]);
}

function safeLabel(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && value.trim() === value;
}

function cloneClosedInput(value: unknown): unknown | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

function strictInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length !== 24) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : undefined;
}

function readCohort(value: unknown): HCacheEvaluationSourceCohortV1 | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, COHORT_KEYS)
    || (record.harness !== "claude" && record.harness !== "codex")
    || !safeLabel(record.model, 120)
    || !safeLabel(record.repo, 200)
    || typeof record.contextFingerprint !== "string"
    || !CONTEXT_FINGERPRINT_PATTERN.test(record.contextFingerprint)
    || record.usageSemanticsVersion !== HARNESS_USAGE_SEMANTICS_VERSION
    || !safeLabel(record.collectorVersion, 64)
  ) {
    return undefined;
  }
  return {
    harness: record.harness,
    model: record.model,
    repo: record.repo,
    contextFingerprint: record.contextFingerprint,
    usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    collectorVersion: record.collectorVersion,
  };
}

function readWindow(value: unknown): ParsedSourceWindow | undefined {
  const record = dataObject(value);
  if (!record || !hasExactKeys(record, WINDOW_KEYS)) return undefined;
  const startInclusive = strictInstant(record.startInclusive);
  const endExclusive = strictInstant(record.endExclusive);
  if (!startInclusive || !endExclusive) return undefined;
  const duration = endExclusive.getTime() - startInclusive.getTime();
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_WINDOW_MS) return undefined;
  return { startInclusive, endExclusive };
}

function readObservation(value: unknown): ParsedSourceObservation | undefined {
  const record = dataObject(value);
  if (!record || !hasExactKeys(record, OBSERVATION_KEYS) || record.schema !== "h_cache_source_observation_v1") {
    return undefined;
  }
  const cohort = readCohort(record.cohort);
  const window = readWindow(record.window);
  return cohort && window ? { cohort, window } : undefined;
}

function readIntervention(value: unknown): HCacheStablePrefixInterventionV1 | undefined {
  const record = dataObject(value);
  if (
    !record
    || !hasExactKeys(record, INTERVENTION_KEYS)
    || record.schema !== "h_cache_stable_prefix_intervention_v1"
    || typeof record.interventionIdHash !== "string"
    || !HASH_PATTERN.test(record.interventionIdHash)
    || typeof record.beforeContextFingerprint !== "string"
    || !CONTEXT_FINGERPRINT_PATTERN.test(record.beforeContextFingerprint)
    || typeof record.afterContextFingerprint !== "string"
    || !CONTEXT_FINGERPRINT_PATTERN.test(record.afterContextFingerprint)
    || record.beforeContextFingerprint === record.afterContextFingerprint
  ) {
    return undefined;
  }
  return {
    schema: "h_cache_stable_prefix_intervention_v1",
    interventionIdHash: record.interventionIdHash,
    beforeContextFingerprint: record.beforeContextFingerprint,
    afterContextFingerprint: record.afterContextFingerprint,
  };
}

function readSourceRequest(value: unknown): ParsedSourceRequest | undefined {
  const cloned = cloneClosedInput(value);
  const record = dataObject(cloned);
  if (!record || !hasExactKeys(record, ROOT_KEYS) || record.schema !== "h_cache_evaluation_source_request_v1") {
    return undefined;
  }
  const baseline = record.baseline === null ? null : readObservation(record.baseline);
  const intervention = record.intervention === null ? null : readIntervention(record.intervention);
  const followup = record.followup === null ? null : readObservation(record.followup);
  return baseline === undefined || intervention === undefined || followup === undefined
    ? undefined
    : { baseline, intervention, followup };
}

function invalidNormalization(): HCacheEvaluationAggregateV1 {
  return buildHCacheEvaluationAggregateV1({});
}

function rowMatchesCohort(
  row: HCacheEvaluationSourceRowV1,
  cohort: HCacheEvaluationSourceCohortV1,
): boolean {
  return row.harness === cohort.harness
    && row.model === cohort.model
    && row.repo === cohort.repo
    && row.contextFingerprint === cohort.contextFingerprint
    && row.usageSemanticsVersion === cohort.usageSemanticsVersion
    && row.collectorVersion === cohort.collectorVersion;
}

function invalidSample(): Record<string, unknown> {
  return {
    schema: "h_cache_usage_sample_v1",
    usageSemanticsVersion: HARNESS_USAGE_SEMANTICS_VERSION,
    usageNormalizationStatus: "invalid",
    inputTotalTokens: null,
    inputUncachedTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    turns: 0,
  };
}

function projectRowToSample(
  row: HCacheEvaluationSourceRowV1,
  cohort: HCacheEvaluationSourceCohortV1,
): Record<string, unknown> {
  if (!rowMatchesCohort(row, cohort)) return invalidSample();
  const unprojected = row.usageNormalizationStatus === null;
  return {
    schema: "h_cache_usage_sample_v1",
    usageSemanticsVersion: row.usageSemanticsVersion,
    usageNormalizationStatus: unprojected ? "unsupported" : row.usageNormalizationStatus,
    inputTotalTokens: unprojected ? null : row.inputTotalTokens,
    inputUncachedTokens: unprojected ? null : row.inputUncachedTokens,
    cacheReadTokens: unprojected ? null : row.cacheReadTokens,
    cacheWriteTokens: unprojected ? null : row.cacheWriteTokens,
    turns: row.turns,
  };
}

function buildObservationInput(
  observation: ParsedSourceObservation,
  rows: readonly HCacheEvaluationSourceRowV1[],
): Record<string, unknown> {
  return {
    schema: "h_cache_cohort_observation_input_v1",
    cohort: observation.cohort,
    samples: rows.map((row) => projectRowToSample(row, observation.cohort)),
  };
}

async function queryObservation(
  client: HCacheEvaluationSourceQueryClientV1,
  observation: ParsedSourceObservation,
): Promise<Record<string, unknown>> {
  const { cohort, window } = observation;
  const rows = await client.harnessRun.findMany({
    where: {
      harness: cohort.harness,
      model: cohort.model,
      repo: cohort.repo,
      contextFingerprint: cohort.contextFingerprint,
      usageSemanticsVersion: cohort.usageSemanticsVersion,
      collectorVersion: cohort.collectorVersion,
      startedAt: {
        gte: window.startInclusive,
        lt: window.endExclusive,
      },
    },
    select: H_CACHE_EVALUATION_SOURCE_SELECTION_V1,
    orderBy: { startedAt: "asc" },
    take: H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1 + 1,
  });
  return buildObservationInput(observation, rows);
}

/**
 * Opens an existing SQLite database in read-only mode. Callers must pass the
 * selected database explicitly; this module never reads an environment URL,
 * creates a database, migrates schema, or performs a write.
 */
export function createReadonlyHCacheEvaluationSourceClientV1(
  url: string,
): HCacheEvaluationSourceQueryClientV1 {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url,
      readonly: true,
      fileMustExist: true,
    }),
  });
}

/**
 * Converts exact, bounded source windows into the closed H-CACHE child used
 * by the A9-A report. The only output is the aggregate supplied by the pure
 * cohort kernel; raw rows and source labels never leave this boundary.
 */
export async function queryHCacheEvaluationSourceV1(
  client: HCacheEvaluationSourceQueryClientV1,
  value: unknown,
): Promise<HCacheEvaluationAggregateV1> {
  try {
    const request = readSourceRequest(value);
    if (!request) return invalidNormalization();

    const baseline = request.baseline === null
      ? null
      : await queryObservation(client, request.baseline);

    // The pure kernel can classify both malformed logical layouts without a
    // follow-up query. This keeps a missing baseline or intervention from
    // expanding the read surface.
    const mustReadFollowup = request.baseline !== null
      && request.intervention !== null
      && request.followup !== null;
    const followup = request.followup === null
      ? null
      : mustReadFollowup
        ? await queryObservation(client, request.followup)
        : buildObservationInput(request.followup, []);

    return buildHCacheEvaluationAggregateV1({
      schema: "h_cache_evaluation_request_v1",
      baseline,
      intervention: request.intervention,
      followup,
    });
  } finally {
    await client.$disconnect();
  }
}

export function queryReadonlyHCacheEvaluationSourceV1(
  url: string,
  value: unknown,
): Promise<HCacheEvaluationAggregateV1> {
  return queryHCacheEvaluationSourceV1(
    createReadonlyHCacheEvaluationSourceClientV1(url),
    value,
  );
}
