import { createHash, randomBytes as secureRandomBytes } from "node:crypto";

import {
  canonicalJson,
  decodeLoopJobPayload,
  isValidJstIsoWeek,
} from "../state-machine";
import {
  createHCycleEvaluatePayloadV1,
  H_CYCLE_EVALUATE_JOB_REGISTRY,
} from "./h-cycle-evaluate-job-contract-v1";

const H_CYCLE_KIND = "h_cycle_evaluate" as const;
const EVENT_SCHEMA_V1 = "h_cycle_activation_event_v1" as const;
const INITIAL_FLOOR_WEEK_KEY = "2026-W35" as const;
const ENQUEUE_INPUT_SCHEMA_V1 = "h_cycle_generation_scoped_enqueue_v1" as const;
const CLAIM_INPUT_SCHEMA_V1 = "h_cycle_generation_scoped_claim_v1" as const;
const RECOVER_INPUT_SCHEMA_V1 = "h_cycle_generation_scoped_recover_v1" as const;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const JOB_ID = /^job_[0-9a-f]{32}$/;
const PAYLOAD_HASH = /^[0-9a-f]{64}$/;
const LEASE_TOKEN = /^[0-9a-f]{64}$/;
const WORKER_ID = /^worker_[0-9a-f]{32}$/;

type DataObject = Record<string, unknown>;
type DirectStatement = Readonly<{
  all: (...parameters: readonly unknown[]) => readonly unknown[];
  run: (...parameters: readonly unknown[]) => unknown;
}>;

/**
 * This is deliberately narrower than a database client. The caller provides
 * the already-proven immediate transaction capability; this module cannot
 * open a path, discover an environment variable, or make a second connection.
 */
export type HCycleGenerationScopedSqliteConnectionV1 = Readonly<{
  prepare: (sql: string) => DirectStatement;
}>;

export type HCycleGenerationScopedImmediateRunnerV1 = (
  operation: (connection: HCycleGenerationScopedSqliteConnectionV1) => undefined,
) => Readonly<{ ok: true }> | Readonly<{ ok: false; code: "storage_failure" }>;

export type HCycleGenerationScopedExecutionDependenciesV1 = Readonly<{
  runImmediate: HCycleGenerationScopedImmediateRunnerV1;
  clock: Readonly<{ now: () => Date }>;
  randomBytes?: (length: number) => Uint8Array;
}>;

export type HCycleGenerationScopedEnqueueInputV1 = Readonly<{
  schema: typeof ENQUEUE_INPUT_SCHEMA_V1;
  targetWeekKey: string;
  maxAttempts: number;
  availableAt: Date;
}>;

export type HCycleGenerationScopedClaimInputV1 = Readonly<{
  schema: typeof CLAIM_INPUT_SCHEMA_V1;
  leaseDurationMs: number;
}>;

export type HCycleGenerationScopedRecoverInputV1 = Readonly<{
  schema: typeof RECOVER_INPUT_SCHEMA_V1;
}>;

declare const H_CYCLE_CLAIM_CAPABILITY_BRAND: unique symbol;

/**
 * The object has no enumerable data. Its lease/generation/payload identity is
 * held in a module-private WeakMap so a future C3c writer can consume the
 * proven claim without letting a post-claim caller select those values.
 */
export type HCycleGenerationScopedClaimCapabilityV1 = Readonly<{
  readonly [H_CYCLE_CLAIM_CAPABILITY_BRAND]: "h_cycle_generation_scoped_claim_v1";
}>;

export type HCycleGenerationScopedEnqueueResultV1 =
  | Readonly<{ ok: true; featureState: "off"; code: "enqueued" | "already_enqueued" }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code: "invalid_execution_input" | "execution_fenced" | "storage_failure";
  }>;

export type HCycleGenerationScopedClaimResultV1 =
  | Readonly<{ ok: true; featureState: "off"; code: "no_job" }>
  | Readonly<{
    ok: true;
    featureState: "off";
    code: "claimed";
    capability: HCycleGenerationScopedClaimCapabilityV1;
  }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code: "invalid_execution_input" | "execution_fenced" | "storage_failure";
  }>;

export type HCycleGenerationScopedRecoverResultV1 =
  | Readonly<{ ok: true; featureState: "off"; code: "no_expired_job" | "recovered" }>
  | Readonly<{
    ok: false;
    featureState: "off";
    code: "invalid_execution_input" | "execution_fenced" | "storage_failure";
  }>;

type CapabilityPrivateState = Readonly<{
  jobId: string;
  leaseToken: string;
  generationSequence: number;
  payloadHash: string;
  targetWeekKey: string;
  policyVersion: "h_cycle_evidence_v1";
  projectionSchemaVersion: "h_cycle_evidence_preview_v1";
}>;

type ActivationEventRow = Readonly<{
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

type ActiveControlState = Readonly<{
  generationSequence: number;
  activationFloorWeekKey: string;
}>;

type StoredLoopJob = Readonly<{
  id: string;
  kind: string;
  dedupeKey: string;
  payloadJson: string;
  payloadHash: string;
  status: "queued" | "running" | "retry_wait" | "succeeded" | "dead";
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  leaseExpiresAt: Date | null;
  lockedBy: string | null;
  leaseToken: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  executionGenerationSequence: number | null;
}>;

const capabilities = new WeakMap<object, CapabilityPrivateState>();
const INVALID_EXECUTION_INPUT = Object.freeze({
  ok: false as const,
  featureState: "off" as const,
  code: "invalid_execution_input" as const,
});
const EXECUTION_FENCED = Object.freeze({
  ok: false as const,
  featureState: "off" as const,
  code: "execution_fenced" as const,
});
const STORAGE_FAILURE = Object.freeze({
  ok: false as const,
  featureState: "off" as const,
  code: "storage_failure" as const,
});
const NO_JOB = Object.freeze({ ok: true as const, featureState: "off" as const, code: "no_job" as const });
const NO_EXPIRED_JOB = Object.freeze({
  ok: true as const,
  featureState: "off" as const,
  code: "no_expired_job" as const,
});
const ENQUEUED = Object.freeze({ ok: true as const, featureState: "off" as const, code: "enqueued" as const });
const ALREADY_ENQUEUED = Object.freeze({
  ok: true as const,
  featureState: "off" as const,
  code: "already_enqueued" as const,
});
const RECOVERED = Object.freeze({ ok: true as const, featureState: "off" as const, code: "recovered" as const });

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

function exactKeys(record: DataObject, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseStoredDate(value: unknown): Date | null {
  if (validDate(value)) return new Date(value.getTime());
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isoDate(value: Date): string | null {
  return validDate(value) ? value.toISOString() : null;
}

function jstIsoWeekKey(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const day = jst.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 4 - day));
  const year = thursday.getUTCFullYear();
  const firstDay = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday.getTime() - firstDay.getTime()) / DAY_MS) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function validRoot(row: ActivationEventRow): boolean {
  return Number.isSafeInteger(row.sequence)
    && row.sequence > 0
    && row.eventSchema === EVENT_SCHEMA_V1
    && (row.eventKind === "packet_attested" || row.eventKind === "re_enabled")
    && row.generationSequence === null
    && row.packetSchema === "h_cycle_private_packet_attestation_v1"
    && row.packetStatus === "approved"
    && row.targetClass === "existing_local_applied_loop_development_sqlite"
    && isValidJstIsoWeek(row.activationFloorWeekKey)
    && row.schedulerClass === "macos_user_launchd"
    && row.schedulerOwnership === "operator_manual_install"
    && row.stopRouteClass === "same_user_agent_unload_remove"
    && validDate(row.recordedAt);
}

function validInitialRoot(row: ActivationEventRow): boolean {
  return validRoot(row)
    && row.eventKind === "packet_attested"
    && row.activationFloorWeekKey === INITIAL_FLOOR_WEEK_KEY
    && jstIsoWeekKey(row.recordedAt) === INITIAL_FLOOR_WEEK_KEY;
}

function validReenabledRoot(row: ActivationEventRow): boolean {
  return validRoot(row)
    && row.eventKind === "re_enabled"
    && row.activationFloorWeekKey !== null
    && row.activationFloorWeekKey >= jstIsoWeekKey(row.recordedAt);
}

function validDisable(row: ActivationEventRow): boolean {
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

function deriveActiveControlState(rows: readonly ActivationEventRow[], now: Date): ActiveControlState | null {
  const first = rows[0];
  if (!first || !validInitialRoot(first) || first.recordedAt.getTime() > now.getTime()) return null;

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
      if (disabled || !validDisable(row) || row.generationSequence !== currentRoot.sequence) return null;
      disabled = true;
      continue;
    }
    if (row.eventKind === "re_enabled") {
      if (!disabled
        || !validReenabledRoot(row)
        || row.activationFloorWeekKey === null
        || currentRoot.activationFloorWeekKey === null
        || row.activationFloorWeekKey <= currentRoot.activationFloorWeekKey) {
        return null;
      }
      currentRoot = row;
      disabled = false;
      continue;
    }
    return null;
  }
  if (disabled || currentRoot.activationFloorWeekKey === null) return null;
  return Object.freeze({
    generationSequence: currentRoot.sequence,
    activationFloorWeekKey: currentRoot.activationFloorWeekKey,
  });
}

function parseActivationEvent(value: unknown): ActivationEventRow | null {
  const row = dataObject(value);
  if (!row) return null;
  const recordedAt = parseStoredDate(row.recordedAt);
  const sequence = row.sequence;
  const generationSequence = row.generationSequence;
  const nullableString = (candidate: unknown) => candidate === null || typeof candidate === "string";
  if (!safeInteger(sequence)
    || typeof row.eventSchema !== "string"
    || typeof row.eventKind !== "string"
    || (generationSequence !== null && !safeInteger(generationSequence))
    || !nullableString(row.packetSchema)
    || !nullableString(row.packetStatus)
    || !nullableString(row.targetClass)
    || !nullableString(row.activationFloorWeekKey)
    || !nullableString(row.schedulerClass)
    || !nullableString(row.schedulerOwnership)
    || !nullableString(row.stopRouteClass)
    || !recordedAt) {
    return null;
  }
  return Object.freeze({
    sequence,
    eventSchema: row.eventSchema,
    eventKind: row.eventKind,
    generationSequence,
    packetSchema: row.packetSchema,
    packetStatus: row.packetStatus,
    targetClass: row.targetClass,
    activationFloorWeekKey: row.activationFloorWeekKey,
    schedulerClass: row.schedulerClass,
    schedulerOwnership: row.schedulerOwnership,
    stopRouteClass: row.stopRouteClass,
    recordedAt,
  });
}

function loadActiveControlState(
  connection: HCycleGenerationScopedSqliteConnectionV1,
  now: Date,
): ActiveControlState | null {
  const values = connection.prepare(`
    SELECT "sequence", "eventSchema", "eventKind", "generationSequence", "packetSchema", "packetStatus",
      "targetClass", "activationFloorWeekKey", "schedulerClass", "schedulerOwnership", "stopRouteClass", "recordedAt"
    FROM "HCycleActivationEvent"
    ORDER BY "sequence" ASC
  `).all();
  const rows: ActivationEventRow[] = [];
  for (const value of values) {
    const parsed = parseActivationEvent(value);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return deriveActiveControlState(rows, now);
}

function parseStoredLoopJob(value: unknown): StoredLoopJob | null {
  const row = dataObject(value);
  if (!row) return null;
  const attempts = row.attempts;
  const maxAttempts = row.maxAttempts;
  const executionGenerationSequence = row.executionGenerationSequence;
  const dates = {
    availableAt: parseStoredDate(row.availableAt),
    lockedAt: row.lockedAt === null ? null : parseStoredDate(row.lockedAt),
    leaseExpiresAt: row.leaseExpiresAt === null ? null : parseStoredDate(row.leaseExpiresAt),
    createdAt: parseStoredDate(row.createdAt),
    updatedAt: parseStoredDate(row.updatedAt),
    finishedAt: row.finishedAt === null ? null : parseStoredDate(row.finishedAt),
  };
  if (typeof row.id !== "string" || !JOB_ID.test(row.id)
    || typeof row.kind !== "string"
    || typeof row.dedupeKey !== "string"
    || typeof row.payloadJson !== "string"
    || typeof row.payloadHash !== "string" || !PAYLOAD_HASH.test(row.payloadHash)
    || (row.status !== "queued" && row.status !== "running" && row.status !== "retry_wait" &&
      row.status !== "succeeded" && row.status !== "dead")
    || !safeInteger(attempts) || !safeInteger(maxAttempts)
    || attempts < 0 || maxAttempts < 1 || attempts > maxAttempts
    || !dates.availableAt || !dates.createdAt || !dates.updatedAt
    || (dates.lockedAt === null && row.lockedAt !== null)
    || (dates.leaseExpiresAt === null && row.leaseExpiresAt !== null)
    || (dates.finishedAt === null && row.finishedAt !== null)
    || (row.lockedBy !== null && (typeof row.lockedBy !== "string" || !WORKER_ID.test(row.lockedBy)))
    || (row.leaseToken !== null && (typeof row.leaseToken !== "string" || !LEASE_TOKEN.test(row.leaseToken)))
    || (row.lastError !== null && typeof row.lastError !== "string")
    || (executionGenerationSequence !== null &&
      (!safeInteger(executionGenerationSequence) || executionGenerationSequence <= 0))) {
    return null;
  }
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    dedupeKey: row.dedupeKey,
    payloadJson: row.payloadJson,
    payloadHash: row.payloadHash,
    status: row.status,
    attempts,
    maxAttempts,
    availableAt: dates.availableAt,
    lockedAt: dates.lockedAt,
    leaseExpiresAt: dates.leaseExpiresAt,
    lockedBy: row.lockedBy,
    leaseToken: row.leaseToken,
    lastError: row.lastError,
    createdAt: dates.createdAt,
    updatedAt: dates.updatedAt,
    finishedAt: dates.finishedAt,
    executionGenerationSequence,
  });
}

function parseOnlyStoredLoopJob(rows: readonly unknown[]): StoredLoopJob | null {
  return rows.length === 1 ? parseStoredLoopJob(rows[0]) : null;
}

function validHCyclePayload(job: StoredLoopJob, floorWeekKey: string): {
  targetWeekKey: string;
  policyVersion: "h_cycle_evidence_v1";
  projectionSchemaVersion: "h_cycle_evidence_preview_v1";
} | null {
  if (job.kind !== H_CYCLE_KIND) return null;
  const decoded = decodeLoopJobPayload(H_CYCLE_EVALUATE_JOB_REGISTRY, job);
  if (!decoded.ok
    || decoded.payload.hypothesis !== "h_cycle"
    || decoded.payload.cadence !== "weekly"
    || decoded.payload.policyVersion !== "h_cycle_evidence_v1"
    || decoded.payload.projectionSchemaVersion !== "h_cycle_evidence_preview_v1"
    || decoded.payload.targetWeekKey < floorWeekKey) {
    return null;
  }
  return Object.freeze({
    targetWeekKey: decoded.payload.targetWeekKey,
    policyVersion: decoded.payload.policyVersion,
    projectionSchemaVersion: decoded.payload.projectionSchemaVersion,
  });
}

function validEnqueueInput(value: unknown): value is HCycleGenerationScopedEnqueueInputV1 {
  const input = dataObject(value);
  return input !== null
    && exactKeys(input, ["schema", "targetWeekKey", "maxAttempts", "availableAt"])
    && input.schema === ENQUEUE_INPUT_SCHEMA_V1
    && isValidJstIsoWeek(input.targetWeekKey)
    && safeInteger(input.maxAttempts)
    && input.maxAttempts >= 1
    && validDate(input.availableAt);
}

function validClaimInput(value: unknown): value is HCycleGenerationScopedClaimInputV1 {
  const input = dataObject(value);
  return input !== null
    && exactKeys(input, ["schema", "leaseDurationMs"])
    && input.schema === CLAIM_INPUT_SCHEMA_V1
    && safeInteger(input.leaseDurationMs)
    && input.leaseDurationMs > 0;
}

function validRecoverInput(value: unknown): value is HCycleGenerationScopedRecoverInputV1 {
  const input = dataObject(value);
  return input !== null && exactKeys(input, ["schema"]) && input.schema === RECOVER_INPUT_SCHEMA_V1;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomHex(randomBytes: (length: number) => Uint8Array, length: number): string | null {
  const bytes = randomBytes(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) return null;
  return Buffer.from(bytes).toString("hex");
}

function exactRunnerResult(value: unknown): value is Readonly<{ ok: true }> | Readonly<{ ok: false; code: "storage_failure" }> {
  const result = dataObject(value);
  if (!result) return false;
  return exactKeys(result, ["ok"])
    ? result.ok === true
    : exactKeys(result, ["ok", "code"]) && result.ok === false && result.code === "storage_failure";
}

function runImmediate<T>(
  dependencies: HCycleGenerationScopedExecutionDependenciesV1,
  operation: (connection: HCycleGenerationScopedSqliteConnectionV1) => T,
): T | typeof STORAGE_FAILURE {
  let invoked = false;
  let value: T | undefined;
  try {
    const result = dependencies.runImmediate((connection) => {
      if (invoked) throw new Error("immediate runner invoked operation more than once");
      invoked = true;
      value = operation(connection);
      return undefined;
    });
    if (!exactRunnerResult(result) || !result.ok || !invoked || value === undefined) return STORAGE_FAILURE;
    return value;
  } catch {
    return STORAGE_FAILURE;
  }
}

function exactResult<T>(value: T | typeof STORAGE_FAILURE): T | typeof STORAGE_FAILURE {
  return value;
}

function selectedJob(
  connection: HCycleGenerationScopedSqliteConnectionV1,
  query: string,
  parameters: Readonly<Record<string, unknown>>,
): StoredLoopJob | null {
  return parseOnlyStoredLoopJob(connection.prepare(query).all(parameters));
}

function makeCapability(state: CapabilityPrivateState): HCycleGenerationScopedClaimCapabilityV1 {
  const capability = Object.freeze(Object.create(null)) as HCycleGenerationScopedClaimCapabilityV1;
  capabilities.set(capability, Object.freeze({ ...state }));
  return capability;
}

function claimed(capability: HCycleGenerationScopedClaimCapabilityV1): HCycleGenerationScopedClaimResultV1 {
  return Object.freeze({ ok: true as const, featureState: "off" as const, code: "claimed" as const, capability });
}

export function createHCycleGenerationScopedExecutionV1(
  dependencies: HCycleGenerationScopedExecutionDependenciesV1,
) {
  const randomBytes = dependencies.randomBytes ?? secureRandomBytes;

  return Object.freeze({
    enqueue(input: unknown): HCycleGenerationScopedEnqueueResultV1 {
      if (!validEnqueueInput(input)) return INVALID_EXECUTION_INPUT;
      let now: Date;
      let nowIso: string | null;
      let availableAtIso: string | null;
      try {
        now = dependencies.clock.now();
        nowIso = isoDate(now);
        availableAtIso = isoDate(input.availableAt);
      } catch {
        return STORAGE_FAILURE;
      }
      if (!nowIso || !availableAtIso) return STORAGE_FAILURE;

      const result = runImmediate(dependencies, (connection): HCycleGenerationScopedEnqueueResultV1 => {
        const control = loadActiveControlState(connection, now);
        if (!control || input.targetWeekKey < control.activationFloorWeekKey) return EXECUTION_FENCED;
        const payloadResult = createHCycleEvaluatePayloadV1({ targetWeekKey: input.targetWeekKey });
        if (!payloadResult.ok) return EXECUTION_FENCED;
        const payloadJson = canonicalJson(payloadResult.payload);
        const payloadHash = sha256(payloadJson);
        const definition = H_CYCLE_EVALUATE_JOB_REGISTRY[H_CYCLE_KIND];
        const projection = {
          hypothesis: payloadResult.payload.hypothesis,
          cadence: payloadResult.payload.cadence,
          targetWeekKey: payloadResult.payload.targetWeekKey,
          policyVersion: payloadResult.payload.policyVersion,
          projectionSchemaVersion: payloadResult.payload.projectionSchemaVersion,
        };
        const dedupeKey = `${H_CYCLE_KIND}:${definition.version}:${sha256(canonicalJson(projection))}:g${control.generationSequence}`;
        const entropy = randomHex(randomBytes, 16);
        if (!entropy) return STORAGE_FAILURE;
        const id = `job_${entropy}`;
        const inserted = connection.prepare(`
          INSERT INTO "LoopJob" (
            "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
          ) VALUES (
            :id, :kind, :dedupeKey, :payloadJson, :payloadHash, 'queued', 0, :maxAttempts,
            :availableAt, NULL, NULL, NULL, NULL, NULL, :now, :now, NULL, :generationSequence
          ) ON CONFLICT("dedupeKey") DO NOTHING
          RETURNING "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
        `).all({
          id,
          kind: H_CYCLE_KIND,
          dedupeKey,
          payloadJson,
          payloadHash,
          maxAttempts: input.maxAttempts,
          availableAt: availableAtIso,
          now: nowIso,
          generationSequence: control.generationSequence,
        });
        if (inserted.length === 1) {
          const job = parseOnlyStoredLoopJob(inserted);
          return job && job.id === id && job.kind === H_CYCLE_KIND && job.payloadHash === payloadHash &&
              job.executionGenerationSequence === control.generationSequence
            ? ENQUEUED
            : STORAGE_FAILURE;
        }
        if (inserted.length !== 0) return STORAGE_FAILURE;
        const winner = selectedJob(connection, `
          SELECT "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
          FROM "LoopJob"
          WHERE "dedupeKey" = :dedupeKey
        `, { dedupeKey });
        return winner && winner.kind === H_CYCLE_KIND && winner.payloadJson === payloadJson &&
            winner.payloadHash === payloadHash && winner.executionGenerationSequence === control.generationSequence
          ? ALREADY_ENQUEUED
          : EXECUTION_FENCED;
      });
      return exactResult(result);
    },

    claim(input: unknown): HCycleGenerationScopedClaimResultV1 {
      if (!validClaimInput(input)) return INVALID_EXECUTION_INPUT;
      let now: Date;
      let nowIso: string | null;
      let leaseExpiresAtIso: string | null;
      try {
        now = dependencies.clock.now();
        nowIso = isoDate(now);
        leaseExpiresAtIso = isoDate(new Date(now.getTime() + input.leaseDurationMs));
      } catch {
        return STORAGE_FAILURE;
      }
      if (!nowIso || !leaseExpiresAtIso) return STORAGE_FAILURE;

      const result = runImmediate(dependencies, (connection): HCycleGenerationScopedClaimResultV1 => {
        const control = loadActiveControlState(connection, now);
        if (!control) return EXECUTION_FENCED;
        const candidate = selectedJob(connection, `
          SELECT "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
          FROM "LoopJob"
          WHERE "kind" = :kind
            AND "executionGenerationSequence" = :generationSequence
            AND "status" IN ('queued', 'retry_wait')
            AND "availableAt" <= :now
            AND "attempts" < "maxAttempts"
          ORDER BY "availableAt", "createdAt", "id"
          LIMIT 1
        `, { kind: H_CYCLE_KIND, generationSequence: control.generationSequence, now: nowIso });
        if (!candidate) {
          const foreignGeneration = connection.prepare(`
            SELECT 1
            FROM "LoopJob"
            WHERE "kind" = :kind
              AND "status" IN ('queued', 'retry_wait')
              AND "availableAt" <= :now
              AND "attempts" < "maxAttempts"
            LIMIT 1
          `).all({ kind: H_CYCLE_KIND, now: nowIso });
          return foreignGeneration.length === 0 ? NO_JOB : EXECUTION_FENCED;
        }
        const payload = validHCyclePayload(candidate, control.activationFloorWeekKey);
        if (!payload || candidate.executionGenerationSequence !== control.generationSequence) return EXECUTION_FENCED;
        const workerEntropy = randomHex(randomBytes, 16);
        const leaseToken = randomHex(randomBytes, 32);
        if (!workerEntropy || !leaseToken) return STORAGE_FAILURE;
        const lockedBy = `worker_${workerEntropy}`;
        const claimedRows = connection.prepare(`
          UPDATE "LoopJob"
          SET "status" = 'running',
              "attempts" = "attempts" + 1,
              "lockedAt" = :now,
              "leaseExpiresAt" = :leaseExpiresAt,
              "lockedBy" = :lockedBy,
              "leaseToken" = :leaseToken,
              "updatedAt" = :now,
              "finishedAt" = NULL
          WHERE "id" = :id
            AND "kind" = :kind
            AND "executionGenerationSequence" = :generationSequence
            AND "payloadHash" = :payloadHash
            AND "status" IN ('queued', 'retry_wait')
            AND "availableAt" <= :now
            AND "attempts" < "maxAttempts"
          RETURNING "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
        `).all({
          id: candidate.id,
          kind: H_CYCLE_KIND,
          generationSequence: control.generationSequence,
          payloadHash: candidate.payloadHash,
          now: nowIso,
          leaseExpiresAt: leaseExpiresAtIso,
          lockedBy,
          leaseToken,
        });
        const claimedJob = parseOnlyStoredLoopJob(claimedRows);
        if (!claimedJob || claimedJob.status !== "running" || claimedJob.leaseToken !== leaseToken ||
            claimedJob.executionGenerationSequence !== control.generationSequence ||
            claimedJob.payloadHash !== candidate.payloadHash) {
          return EXECUTION_FENCED;
        }
        return claimed(makeCapability({
          jobId: claimedJob.id,
          leaseToken,
          generationSequence: control.generationSequence,
          payloadHash: claimedJob.payloadHash,
          targetWeekKey: payload.targetWeekKey,
          policyVersion: payload.policyVersion,
          projectionSchemaVersion: payload.projectionSchemaVersion,
        }));
      });
      return exactResult(result);
    },

    recoverExpired(input: unknown): HCycleGenerationScopedRecoverResultV1 {
      if (!validRecoverInput(input)) return INVALID_EXECUTION_INPUT;
      let now: Date;
      let nowIso: string | null;
      try {
        now = dependencies.clock.now();
        nowIso = isoDate(now);
      } catch {
        return STORAGE_FAILURE;
      }
      if (!nowIso) return STORAGE_FAILURE;

      const result = runImmediate(dependencies, (connection): HCycleGenerationScopedRecoverResultV1 => {
        const control = loadActiveControlState(connection, now);
        if (!control) return EXECUTION_FENCED;
        const candidate = selectedJob(connection, `
          SELECT "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
          FROM "LoopJob"
          WHERE "kind" = :kind
            AND "executionGenerationSequence" = :generationSequence
            AND "status" = 'running'
            AND "leaseExpiresAt" <= :now
          ORDER BY "leaseExpiresAt", "lockedAt", "id"
          LIMIT 1
        `, { kind: H_CYCLE_KIND, generationSequence: control.generationSequence, now: nowIso });
        if (!candidate) {
          const stale = connection.prepare(`
            SELECT 1
            FROM "LoopJob"
            WHERE "kind" = :kind
              AND "status" = 'running'
              AND "leaseExpiresAt" <= :now
            LIMIT 1
          `).all({ kind: H_CYCLE_KIND, now: nowIso });
          return stale.length === 0 ? NO_EXPIRED_JOB : EXECUTION_FENCED;
        }
        const payload = validHCyclePayload(candidate, control.activationFloorWeekKey);
        if (!payload || candidate.executionGenerationSequence !== control.generationSequence ||
            !candidate.leaseToken || !candidate.leaseExpiresAt) {
          return EXECUTION_FENCED;
        }
        const candidateLeaseExpiresAt = isoDate(candidate.leaseExpiresAt);
        if (!candidateLeaseExpiresAt) return EXECUTION_FENCED;
        const dead = candidate.attempts >= candidate.maxAttempts;
        const recoveredRows = connection.prepare(`
          UPDATE "LoopJob"
          SET "status" = CASE WHEN "attempts" >= "maxAttempts" THEN 'dead' ELSE 'retry_wait' END,
              "availableAt" = :now,
              "lockedAt" = NULL,
              "leaseExpiresAt" = NULL,
              "lockedBy" = NULL,
              "leaseToken" = NULL,
              "lastError" = 'lease_expired',
              "updatedAt" = :now,
              "finishedAt" = CASE WHEN "attempts" >= "maxAttempts" THEN :now ELSE NULL END
          WHERE "id" = :id
            AND "kind" = :kind
            AND "executionGenerationSequence" = :generationSequence
            AND "payloadHash" = :payloadHash
            AND "status" = 'running'
            AND "leaseToken" = :leaseToken
            AND "leaseExpiresAt" = :leaseExpiresAt
            AND "leaseExpiresAt" <= :now
          RETURNING "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
            "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
            "updatedAt", "finishedAt", "executionGenerationSequence"
        `).all({
          id: candidate.id,
          kind: H_CYCLE_KIND,
          generationSequence: control.generationSequence,
          payloadHash: candidate.payloadHash,
          leaseToken: candidate.leaseToken,
          leaseExpiresAt: candidateLeaseExpiresAt,
          now: nowIso,
        });
        const recovered = parseOnlyStoredLoopJob(recoveredRows);
        if (!recovered || recovered.executionGenerationSequence !== control.generationSequence ||
            recovered.payloadHash !== candidate.payloadHash || recovered.status !== (dead ? "dead" : "retry_wait")) {
          return EXECUTION_FENCED;
        }
        return RECOVERED;
      });
      return exactResult(result);
    },
  });
}
