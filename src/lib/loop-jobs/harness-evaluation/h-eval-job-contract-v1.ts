import { createHash } from "node:crypto";

import { defineLoopJobRegistry } from "../state-machine";

const CADENCES = ["daily", "weekly", "intervention_7d", "intervention_14d", "monthly"] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDENTITY_KEYS = [
  "policyVersion",
  "cadence",
  "scopeHash",
  "periodHash",
  "periodOrdinal",
  "periodStartEpochMs",
  "periodEndEpochMs",
];

type Cadence = (typeof CADENCES)[number];

export type HEvalSchedulePayloadV1 = Readonly<{
  hypothesis: "h_eval";
  cadence: Cadence;
  scopeHash: string;
  periodHash: string;
  policyVersion: "v1";
}>;

export type HEvalSchedulePayloadResult =
  | Readonly<{ ok: true; payload: HEvalSchedulePayloadV1 }>
  | Readonly<{ ok: false; code: "invalid_job_identity" }>;

export const H_EVAL_JOB_REGISTRY = defineLoopJobRegistry({
  harness_evaluate: {
    version: "v1",
    fields: {
      hypothesis: { type: "enum", values: ["h_eval"] as const },
      cadence: { type: "enum", values: CADENCES },
      scopeHash: { type: "hash" },
      periodHash: { type: "hash" },
      policyVersion: { type: "enum", values: ["v1"] as const },
    },
    dedupeFields: ["hypothesis", "cadence", "scopeHash", "periodHash", "policyVersion"] as const,
  },
});

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) deepFreeze(nested);
  }
  return Object.freeze(value);
}

function readDataObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    record[key] = descriptor.value;
  }
  return record;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expectedSorted = [...expected].sort();
  return actual.length === expectedSorted.length && actual.every((key, index) => key === expectedSorted[index]);
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function isCadence(value: unknown): value is Cadence {
  return typeof value === "string" && (CADENCES as readonly string[]).includes(value);
}

function periodHash(input: {
  cadence: Cadence;
  periodOrdinal: number;
  periodStartEpochMs: number;
  periodEndEpochMs: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "h_eval_period_v1",
        "v1",
        input.cadence,
        input.periodOrdinal,
        input.periodStartEpochMs,
        input.periodEndEpochMs,
      ]),
      "utf8",
    )
    .digest("hex");
}

function invalidResult(): HEvalSchedulePayloadResult {
  return deepFreeze({ ok: false as const, code: "invalid_job_identity" as const });
}

export function createHEvalSchedulePayloadV1(input: unknown): HEvalSchedulePayloadResult {
  try {
    const record = readDataObject(input);
    if (
      !record ||
      !hasExactKeys(record, IDENTITY_KEYS) ||
      record.policyVersion !== "v1" ||
      !isCadence(record.cadence) ||
      typeof record.scopeHash !== "string" ||
      !HASH_PATTERN.test(record.scopeHash) ||
      typeof record.periodHash !== "string" ||
      !HASH_PATTERN.test(record.periodHash) ||
      !safeCount(record.periodOrdinal) ||
      !safeCount(record.periodStartEpochMs) ||
      !safeCount(record.periodEndEpochMs) ||
      record.periodEndEpochMs <= record.periodStartEpochMs
    ) {
      return invalidResult();
    }
    if (
      record.periodHash !== periodHash({
        cadence: record.cadence,
        periodOrdinal: record.periodOrdinal,
        periodStartEpochMs: record.periodStartEpochMs,
        periodEndEpochMs: record.periodEndEpochMs,
      })
    ) {
      return invalidResult();
    }
    return deepFreeze({
      ok: true as const,
      payload: {
        hypothesis: "h_eval" as const,
        cadence: record.cadence,
        scopeHash: record.scopeHash,
        periodHash: record.periodHash,
        policyVersion: "v1" as const,
      },
    });
  } catch {
    return invalidResult();
  }
}
