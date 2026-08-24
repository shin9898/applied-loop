const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const INPUT_KEYS = [
  "schema",
  "targetDatabaseBinding",
  "schedulerBinding",
  "activationFloorWeekKey",
  "disableUninstallEvidence",
  "workerOperationalEvidence",
  "manualObservationEvidence",
] as const;

type ReadinessBlockerV1 =
  | "target_database_binding_missing"
  | "scheduler_binding_missing"
  | "activation_floor_missing"
  | "disable_uninstall_evidence_missing"
  | "worker_operational_evidence_missing"
  | "manual_observation_evidence_missing";

export type HCycleActivationReadinessInputV1 = Readonly<{
  schema: "h_cycle_activation_readiness_v1";
  targetDatabaseBinding: "missing" | "externally_attested";
  schedulerBinding: "missing" | "externally_attested";
  activationFloorWeekKey: string | null;
  disableUninstallEvidence: "missing" | "accepted";
  workerOperationalEvidence: "missing" | "accepted";
  manualObservationEvidence: "none" | "one_observed" | "at_least_two_observed";
}>;

export const H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1 = Object.freeze({
  version: "h_cycle_weekly_monday_0815_jst_v1" as const,
  timeZone: "Asia/Tokyo" as const,
  cadence: "weekly" as const,
  weekday: "monday" as const,
  localTime: "08:15" as const,
  onTimeGraceMinutes: 5 as const,
  maxEnqueuePerScan: 1 as const,
});

export type HCycleActivationReadinessResultV1 =
  | Readonly<{
    ok: false;
    featureState: "off";
    code: "invalid_activation_readiness_input";
  }>
  | Readonly<{
    ok: true;
    schema: "h_cycle_activation_readiness_v1";
    featureState: "off";
    technicalReadiness: "blocked" | "attested";
    scheduleIntent: typeof H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1;
    blockers: readonly ReadinessBlockerV1[];
  }>;

const INVALID_RESULT: HCycleActivationReadinessResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "invalid_activation_readiness_input",
});

function dataObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    output[key] = descriptor.value;
  }
  return output;
}

function hasExactInputKeys(record: Record<string, unknown>): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...INPUT_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function utcMidnightMs(year: number, month: number, date: number): number {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month, date);
  instant.setUTCHours(0, 0, 0, 0);
  return instant.getTime();
}

function firstJstIsoMondayMs(year: number): number {
  const janFourthMs = utcMidnightMs(year, 0, 4);
  const janFourthWeekday = new Date(janFourthMs).getUTCDay() || 7;
  return janFourthMs - (janFourthWeekday - 1) * DAY_MS - JST_OFFSET_MS;
}

function isValidJstIsoWeek(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const weeksInYear = Math.round((firstJstIsoMondayMs(year + 1) - firstJstIsoMondayMs(year)) / WEEK_MS);
  return Number.isSafeInteger(year) && year >= 1 && year <= 9999
    && Number.isSafeInteger(week) && week >= 1 && week <= weeksInYear;
}

function validInput(record: Record<string, unknown>): record is HCycleActivationReadinessInputV1 {
  return hasExactInputKeys(record)
    && record.schema === "h_cycle_activation_readiness_v1"
    && (record.targetDatabaseBinding === "missing" || record.targetDatabaseBinding === "externally_attested")
    && (record.schedulerBinding === "missing" || record.schedulerBinding === "externally_attested")
    && (record.activationFloorWeekKey === null || isValidJstIsoWeek(record.activationFloorWeekKey))
    && (record.disableUninstallEvidence === "missing" || record.disableUninstallEvidence === "accepted")
    && (record.workerOperationalEvidence === "missing" || record.workerOperationalEvidence === "accepted")
    && (record.manualObservationEvidence === "none"
      || record.manualObservationEvidence === "one_observed"
      || record.manualObservationEvidence === "at_least_two_observed");
}

function readinessBlockers(input: HCycleActivationReadinessInputV1): readonly ReadinessBlockerV1[] {
  const blockers: ReadinessBlockerV1[] = [];
  if (input.targetDatabaseBinding === "missing") blockers.push("target_database_binding_missing");
  if (input.schedulerBinding === "missing") blockers.push("scheduler_binding_missing");
  if (input.activationFloorWeekKey === null) blockers.push("activation_floor_missing");
  if (input.disableUninstallEvidence === "missing") blockers.push("disable_uninstall_evidence_missing");
  if (input.workerOperationalEvidence === "missing") blockers.push("worker_operational_evidence_missing");
  if (input.manualObservationEvidence !== "at_least_two_observed") {
    blockers.push("manual_observation_evidence_missing");
  }
  return Object.freeze(blockers);
}

export function assessHCycleActivationReadinessV1(input: unknown): HCycleActivationReadinessResultV1 {
  try {
    const record = dataObject(input);
    if (record === null || !validInput(record)) return INVALID_RESULT;
    const blockers = readinessBlockers(record);
    return Object.freeze({
      ok: true,
      schema: "h_cycle_activation_readiness_v1",
      featureState: "off",
      technicalReadiness: blockers.length === 0 ? "attested" : "blocked",
      scheduleIntent: H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1,
      blockers,
    });
  } catch {
    return INVALID_RESULT;
  }
}
