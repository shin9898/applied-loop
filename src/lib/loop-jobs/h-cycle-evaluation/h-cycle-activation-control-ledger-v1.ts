import type { PrismaClient } from "../../../generated/prisma/client";

const EVENT_INPUT_SCHEMA_V1 = "h_cycle_activation_event_input_v1" as const;
const OPERATION_EVIDENCE_INPUT_SCHEMA_V1 = "h_cycle_operation_evidence_input_v1" as const;
const EVENT_SCHEMA_V1 = "h_cycle_activation_event_v1" as const;
const CONTROL_READ_SCHEMA_V1 = "h_cycle_activation_control_read_v1" as const;
const INITIAL_FLOOR_WEEK_KEY = "2026-W35" as const;
const EVIDENCE_SCHEMA_V1 = "h_cycle_activation_evidence_v1" as const;
const MANUAL_A7C_EVIDENCE_KIND = "manual_a7c_read_only_observation" as const;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_FRESHNESS_MS = 14 * DAY_MS;
const INITIAL_PACKET_INPUT_KEYS = ["schema", "eventKind", "activationFloorWeekKey"] as const;
const DISABLE_INPUT_KEYS = ["schema", "eventKind"] as const;
const REENABLE_INPUT_KEYS = ["schema", "eventKind", "activationFloorWeekKey"] as const;
const MANUAL_OPERATION_EVIDENCE_INPUT_KEYS = ["schema", "evidenceKind", "targetWeekKey", "policyOutcome", "observedAt"] as const;
const OPERATIONAL_OPERATION_EVIDENCE_INPUT_KEYS = ["schema", "evidenceKind", "observedAt"] as const;
const CONTROL_READ_INPUT_KEYS = ["schema"] as const;
const ISO_WEEK_KEY = /^([1-9]\d{3})-W(\d{2})$/;
const POLICY_OUTCOMES = ["baseline_collecting", "inconclusive", "supported", "rejected"] as const;
const OPERATIONAL_EVIDENCE_KINDS = [
  "worker_heartbeat_enabled",
  "worker_heartbeat_disabled",
  "kill_switch_disposable_no_scan_enqueue_delivery_record",
  "kill_switch_local_read_only_no_new_write",
  "disable_queued_work_no_record",
  "crash_after_record_same_digest_retry",
  "hash_mismatch_integrity_stop",
  "stale_lease_recovery",
  "sleep_catch_up_oldest_one",
  "pre_floor_no_backfill",
] as const;

type DataObject = Record<string, unknown>;
type LedgerClient = Pick<PrismaClient, "$transaction" | "hCycleActivationEvent" | "hCycleActivationEvidence">;
type HCycleActivationEventRowV1 = Readonly<{
  sequence: number;
  eventSchema: string;
  eventKind: string;
  generationSequence: number | null;
  packetSchema: string | null;
  packetStatus: string | null;
  targetClass: string | null;
  activationFloorWeekKey: string | null;
  schedulerClass: string | null;
  schedulerOwnership: string | null;
  stopRouteClass: string | null;
  recordedAt: Date;
}>;
type HCycleActivationEvidenceRowV1 = Readonly<{
  sequence: number;
  evidenceSchema: string;
  generationSequence: number;
  evidenceKind: string;
  targetWeekKey: string | null;
  policyOutcome: string | null;
  observedAt: Date;
}>;

export type HCycleActivationControlLedgerDependenciesV1 = Readonly<{
  client: LedgerClient;
  clock: Readonly<{ now: () => Date }>;
}>;

export type HCycleActivationEventInputV1 = Readonly<{
  schema: typeof EVENT_INPUT_SCHEMA_V1;
  eventKind: "packet_attested";
  activationFloorWeekKey: typeof INITIAL_FLOOR_WEEK_KEY;
}> | Readonly<{
  schema: typeof EVENT_INPUT_SCHEMA_V1;
  eventKind: "disabled";
}> | Readonly<{
  schema: typeof EVENT_INPUT_SCHEMA_V1;
  eventKind: "re_enabled";
  activationFloorWeekKey: string;
}>;

type HCycleManualOperationEvidenceInputV1 = Readonly<{
  schema: typeof OPERATION_EVIDENCE_INPUT_SCHEMA_V1;
  evidenceKind: typeof MANUAL_A7C_EVIDENCE_KIND;
  targetWeekKey: string;
  policyOutcome: typeof POLICY_OUTCOMES[number];
  observedAt: Date;
}>;

type HCycleOperationalOperationEvidenceInputV1 = Readonly<{
  schema: typeof OPERATION_EVIDENCE_INPUT_SCHEMA_V1;
  evidenceKind: typeof OPERATIONAL_EVIDENCE_KINDS[number];
  observedAt: Date;
}>;

export type HCycleOperationEvidenceInputV1 =
  | HCycleManualOperationEvidenceInputV1
  | HCycleOperationalOperationEvidenceInputV1;

export type AppendHCycleActivationEventResultV1 =
  | Readonly<{ ok: true; featureState: "off"; created: true }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code:
      | "invalid_activation_event_input"
      | "activation_event_sequence_failure"
      | "activation_event_integrity_failure"
      | "activation_event_storage_failure";
  }>;

export type AppendHCycleOperationEvidenceResultV1 =
  | Readonly<{ ok: true; featureState: "off"; created: true | false }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code:
      | "invalid_operation_evidence_input"
      | "activation_control_not_attested"
      | "activation_control_disabled"
      | "activation_evidence_integrity_failure"
      | "activation_evidence_storage_failure";
  }>;

export type ReadHCycleActivationControlStateResultV1 =
  | Readonly<{
    ok: true;
    featureState: "off";
    state: "unattested" | "evidence_incomplete" | "ready_for_separately_approved_operation" | "disabled";
  }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code: "invalid_activation_control_read_input" | "activation_control_integrity_failure" | "activation_control_storage_failure";
  }>;

const INVALID_EVENT_INPUT: AppendHCycleActivationEventResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "invalid_activation_event_input",
});
const EVENT_STORAGE_FAILURE: AppendHCycleActivationEventResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_event_storage_failure",
});
const EVENT_SEQUENCE_FAILURE: AppendHCycleActivationEventResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_event_sequence_failure",
});
const EVENT_INTEGRITY_FAILURE: AppendHCycleActivationEventResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_event_integrity_failure",
});
const INVALID_OPERATION_EVIDENCE_INPUT: AppendHCycleOperationEvidenceResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "invalid_operation_evidence_input",
});
const CONTROL_NOT_ATTESTED: AppendHCycleOperationEvidenceResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_control_not_attested",
});
const CONTROL_DISABLED: AppendHCycleOperationEvidenceResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_control_disabled",
});
const EVIDENCE_INTEGRITY_FAILURE: AppendHCycleOperationEvidenceResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_evidence_integrity_failure",
});
const EVIDENCE_STORAGE_FAILURE: AppendHCycleOperationEvidenceResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_evidence_storage_failure",
});
const INVALID_CONTROL_READ: ReadHCycleActivationControlStateResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "invalid_activation_control_read_input",
});
const CONTROL_STORAGE_FAILURE: ReadHCycleActivationControlStateResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_control_storage_failure",
});
const CONTROL_INTEGRITY_FAILURE: ReadHCycleActivationControlStateResultV1 = Object.freeze({
  ok: false,
  featureState: "off",
  code: "activation_control_integrity_failure",
});

function dataObject(value: unknown): DataObject | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output = Object.create(null) as DataObject;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function hasExactKeys(record: DataObject, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function jstIsoWeekKey(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const day = jst.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 4 - day));
  const isoYear = thursday.getUTCFullYear();
  const firstDay = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((thursday.getTime() - firstDay.getTime()) / DAY_MS) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function validInitialPacketInput(value: unknown, now: Date): value is HCycleActivationEventInputV1 {
  const record = dataObject(value);
  return record !== null
    && hasExactKeys(record, INITIAL_PACKET_INPUT_KEYS)
    && record.schema === EVENT_INPUT_SCHEMA_V1
    && record.eventKind === "packet_attested"
    && record.activationFloorWeekKey === INITIAL_FLOOR_WEEK_KEY
    && jstIsoWeekKey(now) === INITIAL_FLOOR_WEEK_KEY;
}

function validDisableInput(value: unknown): value is HCycleActivationEventInputV1 {
  const record = dataObject(value);
  return record !== null
    && hasExactKeys(record, DISABLE_INPUT_KEYS)
    && record.schema === EVENT_INPUT_SCHEMA_V1
    && record.eventKind === "disabled";
}

function validReenableInput(value: unknown): value is HCycleActivationEventInputV1 {
  const record = dataObject(value);
  return record !== null
    && hasExactKeys(record, REENABLE_INPUT_KEYS)
    && record.schema === EVENT_INPUT_SCHEMA_V1
    && record.eventKind === "re_enabled"
    && validIsoWeekKey(record.activationFloorWeekKey);
}

function validManualEvidenceInput(value: unknown, now: Date): value is HCycleManualOperationEvidenceInputV1 {
  const record = dataObject(value);
  return record !== null
    && hasExactKeys(record, MANUAL_OPERATION_EVIDENCE_INPUT_KEYS)
    && record.schema === OPERATION_EVIDENCE_INPUT_SCHEMA_V1
    && record.evidenceKind === MANUAL_A7C_EVIDENCE_KIND
    && validIsoWeekKey(record.targetWeekKey)
    && typeof record.policyOutcome === "string"
    && includesExact(POLICY_OUTCOMES, record.policyOutcome)
    && validDate(record.observedAt)
    && record.observedAt.getTime() <= now.getTime();
}

function validOperationalEvidenceInput(value: unknown, now: Date): value is HCycleOperationalOperationEvidenceInputV1 {
  const record = dataObject(value);
  return record !== null
    && hasExactKeys(record, OPERATIONAL_OPERATION_EVIDENCE_INPUT_KEYS)
    && record.schema === OPERATION_EVIDENCE_INPUT_SCHEMA_V1
    && typeof record.evidenceKind === "string"
    && includesExact(OPERATIONAL_EVIDENCE_KINDS, record.evidenceKind)
    && validDate(record.observedAt)
    && record.observedAt.getTime() <= now.getTime();
}

function validOperationEvidenceInput(value: unknown, now: Date): value is HCycleOperationEvidenceInputV1 {
  return validManualEvidenceInput(value, now) || validOperationalEvidenceInput(value, now);
}

function validReadInput(value: unknown): boolean {
  const record = dataObject(value);
  return record !== null && hasExactKeys(record, CONTROL_READ_INPUT_KEYS) && record.schema === CONTROL_READ_SCHEMA_V1;
}

function validRootPacketRow(row: HCycleActivationEventRowV1): boolean {
  return Number.isSafeInteger(row.sequence)
    && row.sequence > 0
    && row.eventSchema === EVENT_SCHEMA_V1
    && (row.eventKind === "packet_attested" || row.eventKind === "re_enabled")
    && row.generationSequence === null
    && row.packetSchema === "h_cycle_private_packet_attestation_v1"
    && row.packetStatus === "approved"
    && row.targetClass === "existing_local_applied_loop_development_sqlite"
    && validIsoWeekKey(row.activationFloorWeekKey)
    && row.schedulerClass === "macos_user_launchd"
    && row.schedulerOwnership === "operator_manual_install"
    && row.stopRouteClass === "same_user_agent_unload_remove"
    && validDate(row.recordedAt);
}

function validInitialPacketRow(row: HCycleActivationEventRowV1): boolean {
  return validRootPacketRow(row)
    && row.eventKind === "packet_attested"
    && row.activationFloorWeekKey === INITIAL_FLOOR_WEEK_KEY
    && jstIsoWeekKey(row.recordedAt) === INITIAL_FLOOR_WEEK_KEY;
}

function validReenabledRow(row: HCycleActivationEventRowV1): boolean {
  return validRootPacketRow(row)
    && row.eventKind === "re_enabled"
    && row.activationFloorWeekKey !== null
    && row.activationFloorWeekKey >= jstIsoWeekKey(row.recordedAt);
}

function validDisabledRow(row: HCycleActivationEventRowV1): boolean {
  return Number.isSafeInteger(row.sequence)
    && row.sequence > 0
    && row.eventSchema === EVENT_SCHEMA_V1
    && row.eventKind === "disabled"
    && Number.isSafeInteger(row.generationSequence)
    && (row.generationSequence ?? 0) > 0
    && row.packetSchema === null
    && row.packetStatus === null
    && row.targetClass === null
    && row.activationFloorWeekKey === null
    && row.schedulerClass === null
    && row.schedulerOwnership === null
    && row.stopRouteClass === null
    && validDate(row.recordedAt);
}

type HCycleActivationControlHistoryV1 = Readonly<{
  currentRoot: HCycleActivationEventRowV1;
  disabled: boolean;
  rootsBySequence: ReadonlyMap<number, HCycleActivationEventRowV1>;
  disabledRecordedAtByGeneration: ReadonlyMap<number, Date>;
}>;

function deriveActivationControlHistory(
  rows: readonly HCycleActivationEventRowV1[],
  now: Date,
): HCycleActivationControlHistoryV1 | null {
  const first = rows[0];
  if (!first || !validInitialPacketRow(first) || first.recordedAt.getTime() > now.getTime()) return null;

  const rootsBySequence = new Map<number, HCycleActivationEventRowV1>([[first.sequence, first]]);
  const disabledRecordedAtByGeneration = new Map<number, Date>();
  let currentRoot = first;
  let disabled = false;
  let previousSequence = first.sequence;
  let previousRecordedAt = first.recordedAt;

  for (const row of rows.slice(1)) {
    if (!Number.isSafeInteger(row.sequence)
      || row.sequence <= previousSequence
      || !validDate(row.recordedAt)
      || row.recordedAt.getTime() > now.getTime()
      || row.recordedAt.getTime() < previousRecordedAt.getTime()) {
      return null;
    }
    previousSequence = row.sequence;
    previousRecordedAt = row.recordedAt;

    if (row.eventKind === "disabled") {
      if (disabled || !validDisabledRow(row) || row.generationSequence !== currentRoot.sequence) return null;
      disabledRecordedAtByGeneration.set(currentRoot.sequence, row.recordedAt);
      disabled = true;
      continue;
    }

    if (row.eventKind === "re_enabled") {
      if (!disabled
        || !validReenabledRow(row)
        || row.activationFloorWeekKey === null
        || currentRoot.activationFloorWeekKey === null
        || row.activationFloorWeekKey <= currentRoot.activationFloorWeekKey) {
        return null;
      }
      rootsBySequence.set(row.sequence, row);
      currentRoot = row;
      disabled = false;
      continue;
    }

    return null;
  }

  return Object.freeze({ currentRoot, disabled, rootsBySequence, disabledRecordedAtByGeneration });
}

function validIsoWeekKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_WEEK_KEY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1) return false;

  const finalIsoWeekDate = new Date(0);
  finalIsoWeekDate.setUTCFullYear(year, 11, 28);
  finalIsoWeekDate.setUTCHours(0, 0, 0, 0);
  const finalWeek = Number(jstIsoWeekKey(finalIsoWeekDate).slice(-2));
  return Number.isInteger(finalWeek) && week <= finalWeek;
}

function includesExact(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function validEvidenceRow(
  row: HCycleActivationEvidenceRowV1,
  root: HCycleActivationEventRowV1,
  now: Date,
): boolean {
  if (row.evidenceSchema !== EVIDENCE_SCHEMA_V1
    || row.generationSequence !== root.sequence
    || !validDate(row.observedAt)
    || row.observedAt.getTime() < root.recordedAt.getTime()
    || row.observedAt.getTime() > now.getTime()) {
    return false;
  }

  if (row.evidenceKind === MANUAL_A7C_EVIDENCE_KIND) {
    const rootFloorWeekKey = root.activationFloorWeekKey;
    if (!validIsoWeekKey(row.targetWeekKey)
      || !validIsoWeekKey(rootFloorWeekKey)
      || row.policyOutcome === null) {
      return false;
    }
    const completedWeekAt = jstIsoWeekEndExclusive(row.targetWeekKey);
    return completedWeekAt !== null
      && row.targetWeekKey >= rootFloorWeekKey
      && row.observedAt.getTime() >= completedWeekAt.getTime()
      && includesExact(POLICY_OUTCOMES, row.policyOutcome);
  }

  return includesExact(OPERATIONAL_EVIDENCE_KINDS, row.evidenceKind)
    && row.targetWeekKey === null
    && row.policyOutcome === null;
}

function validEvidenceHistory(
  rows: readonly HCycleActivationEvidenceRowV1[],
  history: HCycleActivationControlHistoryV1,
  now: Date,
): boolean {
  const manualWeeks = new Set<string>();
  const operationalFacts = new Set<string>();
  let previousSequence = 0;

  for (const row of rows) {
    if (!Number.isSafeInteger(row.sequence) || row.sequence <= previousSequence) return false;
    previousSequence = row.sequence;
    const root = history.rootsBySequence.get(row.generationSequence);
    if (!root) return false;
    const disabledRecordedAt = history.disabledRecordedAtByGeneration.get(row.generationSequence);
    if (!validEvidenceRow(row, root, now)
      || (disabledRecordedAt !== undefined && row.observedAt.getTime() > disabledRecordedAt.getTime())) {
      return false;
    }
    if (row.evidenceKind === MANUAL_A7C_EVIDENCE_KIND) {
      if (row.targetWeekKey === null) return false;
      const manualWeekKey = `${row.generationSequence}\u0000${row.targetWeekKey}`;
      if (manualWeeks.has(manualWeekKey)) return false;
      manualWeeks.add(manualWeekKey);
      continue;
    }

    const factKey = `${row.generationSequence}\u0000${row.evidenceKind}\u0000${row.observedAt.toISOString()}`;
    if (operationalFacts.has(factKey)) return false;
    operationalFacts.add(factKey);
  }

  return true;
}

function isFreshEvidence(row: HCycleActivationEvidenceRowV1, now: Date): boolean {
  const age = now.getTime() - row.observedAt.getTime();
  return age >= 0 && age <= EVIDENCE_FRESHNESS_MS;
}

function hasCompleteCurrentGenerationEvidence(
  rows: readonly HCycleActivationEvidenceRowV1[],
  currentRoot: HCycleActivationEventRowV1,
  now: Date,
): boolean {
  const freshManualWeeks = new Set<string>();
  const newestOperationalByKind = new Map<string, HCycleActivationEvidenceRowV1>();

  for (const row of rows) {
    if (row.generationSequence !== currentRoot.sequence) continue;
    if (row.evidenceKind === MANUAL_A7C_EVIDENCE_KIND) {
      if (row.targetWeekKey !== null && isFreshEvidence(row, now)) {
        freshManualWeeks.add(row.targetWeekKey);
      }
      continue;
    }

    const prior = newestOperationalByKind.get(row.evidenceKind);
    if (prior === undefined
      || row.observedAt.getTime() > prior.observedAt.getTime()
      || (row.observedAt.getTime() === prior.observedAt.getTime() && row.sequence > prior.sequence)) {
      newestOperationalByKind.set(row.evidenceKind, row);
    }
  }

  return freshManualWeeks.size >= 2
    && OPERATIONAL_EVIDENCE_KINDS.every((evidenceKind) => {
      const newest = newestOperationalByKind.get(evidenceKind);
      return newest !== undefined && isFreshEvidence(newest, now);
    });
}

function jstIsoWeekEndExclusive(weekKey: string): Date | null {
  if (!validIsoWeekKey(weekKey)) return null;
  const match = ISO_WEEK_KEY.exec(weekKey);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const janFourth = new Date(Date.UTC(year, 0, 4));
  const janFourthIsoDay = janFourth.getUTCDay() || 7;
  const monday = new Date(Date.UTC(year, 0, 4 - (janFourthIsoDay - 1) + ((week - 1) * 7)));
  return new Date(monday.getTime() - JST_OFFSET_MS + (7 * DAY_MS));
}

function matchesManualEvidenceFact(
  row: HCycleActivationEvidenceRowV1,
  root: HCycleActivationEventRowV1,
  input: HCycleManualOperationEvidenceInputV1,
): boolean {
  return row.evidenceSchema === EVIDENCE_SCHEMA_V1
    && row.generationSequence === root.sequence
    && row.evidenceKind === MANUAL_A7C_EVIDENCE_KIND
    && row.targetWeekKey === input.targetWeekKey
    && row.policyOutcome === input.policyOutcome
    && validDate(row.observedAt)
    && row.observedAt.getTime() === input.observedAt.getTime();
}

function matchesOperationalEvidenceFact(
  row: HCycleActivationEvidenceRowV1,
  root: HCycleActivationEventRowV1,
  input: HCycleOperationalOperationEvidenceInputV1,
): boolean {
  return row.evidenceSchema === EVIDENCE_SCHEMA_V1
    && row.generationSequence === root.sequence
    && row.evidenceKind === input.evidenceKind
    && row.targetWeekKey === null
    && row.policyOutcome === null
    && validDate(row.observedAt)
    && row.observedAt.getTime() === input.observedAt.getTime();
}

async function findManualEvidenceForWeek(
  client: LedgerClient,
  generationSequence: number,
  targetWeekKey: string,
): Promise<HCycleActivationEvidenceRowV1 | null> {
  return client.hCycleActivationEvidence.findFirst({
    where: {
      generationSequence,
      evidenceKind: MANUAL_A7C_EVIDENCE_KIND,
      targetWeekKey,
    },
    orderBy: { sequence: "asc" },
  });
}

async function findOperationalEvidenceForObservation(
  client: LedgerClient,
  generationSequence: number,
  evidenceKind: HCycleOperationalOperationEvidenceInputV1["evidenceKind"],
  observedAt: Date,
): Promise<HCycleActivationEvidenceRowV1 | null> {
  return client.hCycleActivationEvidence.findFirst({
    where: {
      generationSequence,
      evidenceKind,
      observedAt,
    },
    orderBy: { sequence: "asc" },
  });
}

function isManualOperationEvidenceInput(
  input: HCycleOperationEvidenceInputV1,
): input is HCycleManualOperationEvidenceInputV1 {
  return input.evidenceKind === MANUAL_A7C_EVIDENCE_KIND;
}

function redactedRootEventData(
  eventKind: "packet_attested" | "re_enabled",
  activationFloorWeekKey: string,
  recordedAt: Date,
) {
  return {
    eventSchema: EVENT_SCHEMA_V1,
    eventKind,
    generationSequence: null,
    packetSchema: "h_cycle_private_packet_attestation_v1",
    packetStatus: "approved",
    targetClass: "existing_local_applied_loop_development_sqlite",
    activationFloorWeekKey,
    schedulerClass: "macos_user_launchd",
    schedulerOwnership: "operator_manual_install",
    stopRouteClass: "same_user_agent_unload_remove",
    recordedAt,
  } as const;
}

export async function appendHCycleActivationEventV1(
  dependencies: HCycleActivationControlLedgerDependenciesV1,
  input: unknown,
): Promise<AppendHCycleActivationEventResultV1> {
  try {
    const now = dependencies.clock.now();
    if (!validDate(now)) return INVALID_EVENT_INPUT;
    const events = await dependencies.client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });

    if (validInitialPacketInput(input, now)) {
      if (events.length !== 0) {
        return deriveActivationControlHistory(events, now) === null ? EVENT_INTEGRITY_FAILURE : EVENT_SEQUENCE_FAILURE;
      }
      await dependencies.client.hCycleActivationEvent.create({
        data: redactedRootEventData("packet_attested", INITIAL_FLOOR_WEEK_KEY, now),
      });
      return Object.freeze({ ok: true, featureState: "off", created: true });
    }

    if (validDisableInput(input)) {
      if (events.length === 0) return EVENT_SEQUENCE_FAILURE;
      const history = deriveActivationControlHistory(events, now);
      if (history === null) return EVENT_INTEGRITY_FAILURE;
      if (history.disabled) return EVENT_SEQUENCE_FAILURE;
      await dependencies.client.hCycleActivationEvent.create({
        data: {
          eventSchema: EVENT_SCHEMA_V1,
          eventKind: "disabled",
          generationSequence: history.currentRoot.sequence,
          packetSchema: null,
          packetStatus: null,
          targetClass: null,
          activationFloorWeekKey: null,
          schedulerClass: null,
          schedulerOwnership: null,
          stopRouteClass: null,
          recordedAt: now,
        },
      });
      return Object.freeze({ ok: true, featureState: "off", created: true });
    }

    if (validReenableInput(input)) {
      if (events.length === 0) return EVENT_SEQUENCE_FAILURE;
      const history = deriveActivationControlHistory(events, now);
      if (history === null) return EVENT_INTEGRITY_FAILURE;
      if (!history.disabled || input.eventKind !== "re_enabled") return EVENT_SEQUENCE_FAILURE;
      const priorFloorWeekKey = history.currentRoot.activationFloorWeekKey;
      if (priorFloorWeekKey === null) return EVENT_INTEGRITY_FAILURE;
      if (input.activationFloorWeekKey < jstIsoWeekKey(now)) return INVALID_EVENT_INPUT;
      if (input.activationFloorWeekKey <= priorFloorWeekKey) return EVENT_SEQUENCE_FAILURE;
      await dependencies.client.hCycleActivationEvent.create({
        data: redactedRootEventData("re_enabled", input.activationFloorWeekKey, now),
      });
      return Object.freeze({ ok: true, featureState: "off", created: true });
    }

    return INVALID_EVENT_INPUT;
  } catch {
    return EVENT_STORAGE_FAILURE;
  }
}

export async function appendHCycleOperationEvidenceV1(
  dependencies: HCycleActivationControlLedgerDependenciesV1,
  input: unknown,
): Promise<AppendHCycleOperationEvidenceResultV1> {
  try {
    const now = dependencies.clock.now();
    if (!validDate(now) || !validOperationEvidenceInput(input, now)) return INVALID_OPERATION_EVIDENCE_INPUT;

    const events = await dependencies.client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });
    if (events.length === 0) return CONTROL_NOT_ATTESTED;
    const history = deriveActivationControlHistory(events, now);
    if (history === null) return EVIDENCE_INTEGRITY_FAILURE;
    if (history.disabled) return CONTROL_DISABLED;

    const root = history.currentRoot;
    if (input.observedAt.getTime() < root.recordedAt.getTime()) return INVALID_OPERATION_EVIDENCE_INPUT;

    if (isManualOperationEvidenceInput(input)) {
      const rootFloorWeekKey = root.activationFloorWeekKey;
      const completedWeekAt = jstIsoWeekEndExclusive(input.targetWeekKey);
      if (completedWeekAt === null
        || rootFloorWeekKey === null
        || input.targetWeekKey < rootFloorWeekKey
        || input.observedAt.getTime() < completedWeekAt.getTime()) {
        return INVALID_OPERATION_EVIDENCE_INPUT;
      }

      const existing = await findManualEvidenceForWeek(dependencies.client, root.sequence, input.targetWeekKey);
      if (existing !== null) {
        return matchesManualEvidenceFact(existing, root, input)
          ? Object.freeze({ ok: true, featureState: "off", created: false })
          : EVIDENCE_INTEGRITY_FAILURE;
      }

      try {
        await dependencies.client.hCycleActivationEvidence.create({
          data: {
            evidenceSchema: EVIDENCE_SCHEMA_V1,
            generationSequence: root.sequence,
            evidenceKind: MANUAL_A7C_EVIDENCE_KIND,
            targetWeekKey: input.targetWeekKey,
            policyOutcome: input.policyOutcome,
            observedAt: input.observedAt,
          },
        });
        return Object.freeze({ ok: true, featureState: "off", created: true });
      } catch {
        const persisted = await findManualEvidenceForWeek(dependencies.client, root.sequence, input.targetWeekKey);
        if (persisted === null) return EVIDENCE_STORAGE_FAILURE;
        return matchesManualEvidenceFact(persisted, root, input)
          ? Object.freeze({ ok: true, featureState: "off", created: false })
          : EVIDENCE_INTEGRITY_FAILURE;
      }
    }

    const existing = await findOperationalEvidenceForObservation(
      dependencies.client,
      root.sequence,
      input.evidenceKind,
      input.observedAt,
    );
    if (existing !== null) {
      return matchesOperationalEvidenceFact(existing, root, input)
        ? Object.freeze({ ok: true, featureState: "off", created: false })
        : EVIDENCE_INTEGRITY_FAILURE;
    }

    try {
      await dependencies.client.hCycleActivationEvidence.create({
        data: {
          evidenceSchema: EVIDENCE_SCHEMA_V1,
          generationSequence: root.sequence,
          evidenceKind: input.evidenceKind,
          targetWeekKey: null,
          policyOutcome: null,
          observedAt: input.observedAt,
        },
      });
      return Object.freeze({ ok: true, featureState: "off", created: true });
    } catch {
      const persisted = await findOperationalEvidenceForObservation(
        dependencies.client,
        root.sequence,
        input.evidenceKind,
        input.observedAt,
      );
      if (persisted === null) return EVIDENCE_STORAGE_FAILURE;
      return matchesOperationalEvidenceFact(persisted, root, input)
        ? Object.freeze({ ok: true, featureState: "off", created: false })
        : EVIDENCE_INTEGRITY_FAILURE;
    }
  } catch {
    return EVIDENCE_STORAGE_FAILURE;
  }
}

export async function readHCycleActivationControlStateV1(
  dependencies: HCycleActivationControlLedgerDependenciesV1,
  input: unknown,
): Promise<ReadHCycleActivationControlStateResultV1> {
  try {
    if (!validReadInput(input)) return INVALID_CONTROL_READ;
    const now = dependencies.clock.now();
    if (!validDate(now)) return CONTROL_INTEGRITY_FAILURE;
    const snapshot = await dependencies.client.$transaction(async (transaction) => {
      const events = await transaction.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });
      const evidence = await transaction.hCycleActivationEvidence.findMany({ orderBy: { sequence: "asc" } });
      return { events, evidence };
    });

    if (snapshot.events.length === 0) {
      return snapshot.evidence.length === 0
        ? Object.freeze({ ok: true, featureState: "off", state: "unattested" })
        : CONTROL_INTEGRITY_FAILURE;
    }
    const history = deriveActivationControlHistory(snapshot.events, now);
    if (history === null) return CONTROL_INTEGRITY_FAILURE;
    if (!validEvidenceHistory(snapshot.evidence, history, now)) return CONTROL_INTEGRITY_FAILURE;
    if (history.disabled) return Object.freeze({ ok: true, featureState: "off", state: "disabled" });
    return Object.freeze({
      ok: true,
      featureState: "off",
      state: hasCompleteCurrentGenerationEvidence(snapshot.evidence, history.currentRoot, now)
        ? "ready_for_separately_approved_operation"
        : "evidence_incomplete",
    });
  } catch {
    return CONTROL_STORAGE_FAILURE;
  }
}
