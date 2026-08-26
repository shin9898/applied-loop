import { createHash } from "node:crypto";

import type { HarnessEvaluationRun, PrismaClient } from "../generated/prisma/client";
import {
  normalizeHarnessEvaluationReportV1,
  type HarnessEvaluationReportV1,
} from "./loop-jobs/harness-evaluation/harness-evaluation-report-v1";
import { canonicalJson } from "./loop-jobs/state-machine";

const RECORD_SCHEMA_V1 = "harness_evaluation_run_v1" as const;
const REPORT_SCHEMA_V1 = "harness_evaluation_report_v1" as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RECORD_INPUT_KEYS = ["client", "evaluationKeyHash", "report", "evaluatedAt"] as const;
const RECORD_WRITE_INPUT_KEYS = ["evaluationKeyHash", "report", "evaluatedAt"] as const;

type DataObject = Record<string, unknown>;
type HarnessEvaluationRunClient = Readonly<{
  harnessEvaluationRun: Pick<PrismaClient["harnessEvaluationRun"], "create" | "findUnique">;
}>;

export type HarnessEvaluationRunIdentityV1 = Readonly<{
  recordSchema: typeof RECORD_SCHEMA_V1;
  reportSchema: typeof REPORT_SCHEMA_V1;
  evaluationKeyHash: string;
}>;

export type PreparedHarnessEvaluationRunV1 = Readonly<{
  identity: HarnessEvaluationRunIdentityV1;
  evaluatedAt: Date;
  reportEnvelopeJson: string;
  reportEnvelopeSha256: string;
  recordSha256: string;
}>;

type PreparedRecord = PreparedHarnessEvaluationRunV1 & Readonly<{ client: HarnessEvaluationRunClient }>;

export type PersistHarnessEvaluationRunResult =
  | Readonly<{ ok: true; created: boolean; record: HarnessEvaluationRun }>
  | Readonly<{
    ok: false;
    code: "invalid_evaluation_run" | "evaluation_run_integrity_failure" | "storage_failure";
  }>;

function dataObject(value: unknown): DataObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function errorObject(value: unknown): DataObject | null {
  return value !== null && typeof value === "object" ? value as DataObject : null;
}

function hasExactKeys(record: DataObject, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneDate(value: unknown): Date | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Date.prototype) return null;
  const milliseconds = (value as Date).getTime();
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function prepareRecord(input: unknown): PreparedRecord | null {
  try {
    const record = dataObject(input);
    if (!record
      || !hasExactKeys(record, RECORD_INPUT_KEYS)
      || record.client === null
      || typeof record.client !== "object"
      || Array.isArray(record.client)) return null;

    const evaluationKeyHash = record.evaluationKeyHash;
    if (typeof evaluationKeyHash !== "string" || !HASH_PATTERN.test(evaluationKeyHash)) return null;
    const report = normalizeHarnessEvaluationReportV1(record.report);
    const evaluatedAt = cloneDate(record.evaluatedAt);
    if (report === null || evaluatedAt === null) return null;

    const reportEnvelopeJson = canonicalJson(report);
    const reportEnvelopeSha256 = sha256(reportEnvelopeJson);
    const identity: HarnessEvaluationRunIdentityV1 = Object.freeze({
      recordSchema: RECORD_SCHEMA_V1,
      reportSchema: REPORT_SCHEMA_V1,
      evaluationKeyHash,
    });
    const recordSha256 = sha256(canonicalJson({
      ...identity,
      evaluatedAt: evaluatedAt.toISOString(),
      reportEnvelopeSha256,
    }));
    return Object.freeze({
      client: record.client as HarnessEvaluationRunClient,
      identity,
      evaluatedAt,
      reportEnvelopeJson,
      reportEnvelopeSha256,
      recordSha256,
    });
  } catch {
    return null;
  }
}

function identityWhere(identity: HarnessEvaluationRunIdentityV1) {
  return { recordSchema_reportSchema_evaluationKeyHash: identity };
}

function recordConstraintTarget(value: unknown): boolean {
  const fields = ["recordSchema", "reportSchema", "evaluationKeyHash"];
  if (Array.isArray(value)) return value.length === fields.length && value.every((field, index) => field === fields[index]);
  return value === "HarnessEvaluationRun_recordSchema_reportSchema_evaluationKeyHash_key";
}

function targetedRecordP2002(error: unknown): boolean {
  const record = errorObject(error);
  if (!record || record.code !== "P2002") return false;
  const meta = errorObject(record.meta);
  if (!meta || (meta.modelName !== undefined && meta.modelName !== "HarnessEvaluationRun")) return false;
  if (recordConstraintTarget(meta.target)) return true;
  const adapterError = errorObject(meta.driverAdapterError);
  const cause = adapterError === null ? null : errorObject(adapterError.cause);
  const constraint = cause === null ? null : errorObject(cause.constraint);
  return constraint !== null && recordConstraintTarget(constraint.fields);
}

function failure(code: Extract<PersistHarnessEvaluationRunResult, { ok: false }>['code']): PersistHarnessEvaluationRunResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Persists one closed aggregate report. The unique identity makes retries
 * idempotent, while a changed report for the same identity is an integrity
 * failure. This function never updates or deletes an existing record.
 */
export async function persistHarnessEvaluationRunV1(input: unknown): Promise<PersistHarnessEvaluationRunResult> {
  const prepared = prepareRecord(input);
  if (prepared === null) return failure("invalid_evaluation_run");
  try {
    const created = await prepared.client.harnessEvaluationRun.create({
      data: {
        ...prepared.identity,
        evaluatedAt: prepared.evaluatedAt,
        reportEnvelopeJson: prepared.reportEnvelopeJson,
        reportEnvelopeSha256: prepared.reportEnvelopeSha256,
        recordSha256: prepared.recordSha256,
      },
    });
    return Object.freeze({ ok: true as const, created: true, record: created });
  } catch (error) {
    if (!targetedRecordP2002(error)) return failure("storage_failure");
  }
  try {
    const winner = await prepared.client.harnessEvaluationRun.findUnique({ where: identityWhere(prepared.identity) });
    if (winner === null) return failure("storage_failure");
    if (winner.reportEnvelopeSha256 !== prepared.reportEnvelopeSha256) {
      return failure("evaluation_run_integrity_failure");
    }
    return Object.freeze({ ok: true as const, created: false, record: winner });
  } catch {
    return failure("storage_failure");
  }
}

export const HARNESS_EVALUATION_RUN_RECORD_SCHEMA_V1 = RECORD_SCHEMA_V1;
export const HARNESS_EVALUATION_RUN_REPORT_SCHEMA_V1 = REPORT_SCHEMA_V1;
export const HARNESS_EVALUATION_RUN_WRITE_INPUT_KEYS_V1 = RECORD_WRITE_INPUT_KEYS;
export type { HarnessEvaluationReportV1 };
