import {
  defineLoopJobRegistry,
  isValidJstIsoWeek,
} from "../state-machine";

const INPUT_KEYS = ["targetWeekKey"] as const;

export type HCycleEvaluatePayloadV1 = Readonly<{
  hypothesis: "h_cycle";
  cadence: "weekly";
  targetWeekKey: string;
  policyVersion: "h_cycle_evidence_v1";
  projectionSchemaVersion: "h_cycle_evidence_preview_v1";
}>;

export type HCycleEvaluatePayloadResult =
  | Readonly<{ ok: true; payload: HCycleEvaluatePayloadV1 }>
  | Readonly<{ ok: false; code: "invalid_job_identity" }>;

export const H_CYCLE_EVALUATE_JOB_REGISTRY = defineLoopJobRegistry({
  h_cycle_evaluate: {
    version: "v1",
    fields: {
      hypothesis: { type: "enum", values: ["h_cycle"] as const },
      cadence: { type: "enum", values: ["weekly"] as const },
      targetWeekKey: { type: "iso_week" },
      policyVersion: { type: "enum", values: ["h_cycle_evidence_v1"] as const },
      projectionSchemaVersion: { type: "enum", values: ["h_cycle_evidence_preview_v1"] as const },
    },
    dedupeFields: ["hypothesis", "cadence", "targetWeekKey", "policyVersion", "projectionSchemaVersion"] as const,
  },
});

function dataObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function invalid(): HCycleEvaluatePayloadResult {
  return Object.freeze({ ok: false as const, code: "invalid_job_identity" as const });
}

/** Constructs the entire closed v1 identity from the one admissible input. */
export function createHCycleEvaluatePayloadV1(input: unknown): HCycleEvaluatePayloadResult {
  try {
    const record = dataObject(input);
    if (!record || !hasExactKeys(record, INPUT_KEYS) || !isValidJstIsoWeek(record.targetWeekKey)) return invalid();
    return Object.freeze({
      ok: true as const,
      payload: Object.freeze({
        hypothesis: "h_cycle" as const,
        cadence: "weekly" as const,
        targetWeekKey: record.targetWeekKey,
        policyVersion: "h_cycle_evidence_v1" as const,
        projectionSchemaVersion: "h_cycle_evidence_preview_v1" as const,
      }),
    });
  } catch {
    return invalid();
  }
}
