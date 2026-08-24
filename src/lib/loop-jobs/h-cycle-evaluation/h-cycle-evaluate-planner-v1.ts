import type { HCyclePeriodV1 } from "../../h-cycle-projection";
import {
  createHCycleEvaluatePayloadV1,
  type HCycleEvaluatePayloadV1,
} from "./h-cycle-evaluate-job-contract-v1";
import { isValidJstIsoWeek } from "../state-machine";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DUE_OFFSET_MS = 8 * 60 * 60 * 1000 + 15 * 60 * 1000;
const ON_TIME_WINDOW_MS = 5 * 60 * 1000;

const TIMING_INPUT_KEYS = ["targetWeekKey", "evaluatedAt"] as const;
const PLANNER_INPUT_KEYS = ["activationFloorWeekKey", "recordedTargetWeekKeys", "now"] as const;

type ParsedWeek = Readonly<{ year: number; week: number; weekKey: string }>;
type TriggerKind = "scheduled" | "catch_up";
type Timeliness = "on_time" | "catch_up";

export type HCycleEvaluateTimingV1 = Readonly<{
  targetWeekKey: string;
  previousWeekKey: string;
  periods: readonly [HCyclePeriodV1, HCyclePeriodV1];
  scheduledFor: Date;
  evaluatedAt: Date;
  triggerKind: TriggerKind;
  timeliness: Timeliness;
}>;

export type HCycleEvaluateTimingResult =
  | Readonly<{ ok: true; timing: HCycleEvaluateTimingV1 }>
  | Readonly<{ ok: false; code: "invalid_timing_input" | "week_not_due" }>;

export type HCycleEvaluatePlanV1 = HCycleEvaluateTimingV1 & Readonly<{
  payload: HCycleEvaluatePayloadV1;
}>;

export type HCycleEvaluatePlanResult =
  | Readonly<{ ok: true; plan: HCycleEvaluatePlanV1 | null }>
  | Readonly<{ ok: false; code: "invalid_planning_input" }>;

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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validDate(value: unknown): Date | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  return new Date(value.getTime());
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

function isoWeeksInJstYear(year: number): number {
  return Math.round((firstJstIsoMondayMs(year + 1) - firstJstIsoMondayMs(year)) / WEEK_MS);
}

function parseIsoWeek(value: unknown): ParsedWeek | null {
  if (!isValidJstIsoWeek(value)) return null;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (match === null) return null;
  return Object.freeze({
    year: Number(match[1]),
    week: Number(match[2]),
    weekKey: value,
  });
}

function periodFor(week: ParsedWeek): HCyclePeriodV1 {
  const start = new Date(firstJstIsoMondayMs(week.year) + (week.week - 1) * WEEK_MS);
  const end = new Date(start.getTime() + WEEK_MS);
  return Object.freeze({
    weekKey: week.weekKey,
    start,
    end,
    asOf: new Date(end),
  });
}

function previousWeek(target: ParsedWeek): ParsedWeek | null {
  if (target.week > 1) {
    return Object.freeze({
      year: target.year,
      week: target.week - 1,
      weekKey: String(target.year) + "-W" + String(target.week - 1).padStart(2, "0"),
    });
  }
  if (target.year === 1) return null;
  const year = target.year - 1;
  const week = isoWeeksInJstYear(year);
  return Object.freeze({
    year,
    week,
    weekKey: String(year) + "-W" + String(week).padStart(2, "0"),
  });
}

function nextWeek(current: ParsedWeek): ParsedWeek | null {
  if (current.week < isoWeeksInJstYear(current.year)) {
    return Object.freeze({
      year: current.year,
      week: current.week + 1,
      weekKey: String(current.year) + "-W" + String(current.week + 1).padStart(2, "0"),
    });
  }
  if (current.year === 9999) return null;
  return Object.freeze({
    year: current.year + 1,
    week: 1,
    weekKey: String(current.year + 1) + "-W01",
  });
}

function timingFailure(code: Extract<HCycleEvaluateTimingResult, { ok: false }>["code"]): HCycleEvaluateTimingResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Derives all schedule metadata from a closed target week and one supplied
 * observation instant. It never reads activation state, a database, or a
 * process clock.
 */
export function deriveHCycleEvaluateTimingV1(input: unknown): HCycleEvaluateTimingResult {
  try {
    const record = dataObject(input);
    if (!record || !hasExactKeys(record, TIMING_INPUT_KEYS)) return timingFailure("invalid_timing_input");
    const target = parseIsoWeek(record.targetWeekKey);
    const evaluatedAt = validDate(record.evaluatedAt);
    if (target === null || evaluatedAt === null) return timingFailure("invalid_timing_input");

    const targetPeriod = periodFor(target);
    const scheduledFor = new Date(targetPeriod.end.getTime() + DUE_OFFSET_MS);
    if (evaluatedAt.getTime() < scheduledFor.getTime()) return timingFailure("week_not_due");

    const previous = previousWeek(target);
    if (previous === null) return timingFailure("invalid_timing_input");
    const previousPeriod = periodFor(previous);
    const onTime = evaluatedAt.getTime() <= scheduledFor.getTime() + ON_TIME_WINDOW_MS;
    return Object.freeze({
      ok: true as const,
      timing: Object.freeze({
        targetWeekKey: target.weekKey,
        previousWeekKey: previous.weekKey,
        periods: Object.freeze([previousPeriod, targetPeriod]) as readonly [HCyclePeriodV1, HCyclePeriodV1],
        scheduledFor,
        evaluatedAt,
        triggerKind: onTime ? "scheduled" as const : "catch_up" as const,
        timeliness: onTime ? "on_time" as const : "catch_up" as const,
      }),
    });
  } catch {
    return timingFailure("invalid_timing_input");
  }
}

function planningFailure(): HCycleEvaluatePlanResult {
  return Object.freeze({ ok: false as const, code: "invalid_planning_input" as const });
}

/**
 * Pure activation-floor scan. A caller supplies a floor and already-recorded
 * targets; this function merely proposes one oldest due candidate. It does not
 * persist activation, enqueue a job, or consult a scheduler.
 */
export function planHCycleEvaluateV1(input: unknown): HCycleEvaluatePlanResult {
  try {
    const record = dataObject(input);
    if (!record || !hasExactKeys(record, PLANNER_INPUT_KEYS)) return planningFailure();
    const floor = parseIsoWeek(record.activationFloorWeekKey);
    const now = validDate(record.now);
    if (floor === null || now === null || !Array.isArray(record.recordedTargetWeekKeys)) return planningFailure();

    const recorded = new Set<string>();
    for (const weekKey of record.recordedTargetWeekKeys) {
      if (!isValidJstIsoWeek(weekKey)) return planningFailure();
      recorded.add(weekKey);
    }

    let candidate = floor;
    for (;;) {
      const timingResult = deriveHCycleEvaluateTimingV1({
        targetWeekKey: candidate.weekKey,
        evaluatedAt: now,
      });
      if (!timingResult.ok) {
        return timingResult.code === "week_not_due"
          ? Object.freeze({ ok: true as const, plan: null })
          : planningFailure();
      }
      if (!recorded.has(candidate.weekKey)) {
        const payload = createHCycleEvaluatePayloadV1({ targetWeekKey: candidate.weekKey });
        if (!payload.ok) return planningFailure();
        return Object.freeze({
          ok: true as const,
          plan: Object.freeze({
            ...timingResult.timing,
            payload: payload.payload,
          }),
        });
      }
      const next = nextWeek(candidate);
      if (next === null) return Object.freeze({ ok: true as const, plan: null });
      candidate = next;
    }
  } catch {
    return planningFailure();
  }
}
