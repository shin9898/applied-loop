import { createHash, randomBytes as secureRandomBytes } from "node:crypto";

// A8-C2 BEGIN: single-kind raw claim import
import { types as nodeTypes } from "node:util";

import { claimOneKindRaw } from "./raw-state-adapter";
// A8-C2 END: single-kind raw claim import

import type { LoopJob, PrismaClient } from "../../generated/prisma/client";
import type { LastErrorCode } from "./closed-codes";
import {
  claimOneRaw,
  recoverOneExpiredRaw,
  renewOwnedRaw,
  type RawLoopJobClient,
} from "./raw-state-adapter";

type OpaqueIdField = { type: "opaque_id"; prefix: string };
type EnumField = { type: "enum"; values: readonly string[] };
type HashField = { type: "hash" };
type IsoWeekField = { type: "iso_week" };
type Field = OpaqueIdField | EnumField | HashField | IsoWeekField;

type JobDefinition = {
  version: string;
  fields: Record<string, Field>;
  dedupeFields: readonly string[];
};

export type LoopJobRegistry = Readonly<Record<string, JobDefinition>>;

type InjectedClock = {
  now: () => Date;
  addMilliseconds: (date: Date, milliseconds: number) => Date;
  fromStorage: (value: string) => Date;
};

export type LoopJobClient = RawLoopJobClient & {
  loopJob: Pick<PrismaClient["loopJob"], "create" | "findUnique" | "updateMany">;
};

type EnqueueInput = {
  kind: string;
  payload: unknown;
  maxAttempts: number;
  availableAt?: Date;
};

type EnqueueResult =
  | { ok: true; created: boolean; job: LoopJob }
  | { ok: false; code: "invalid_payload" | "dedupe_payload_conflict" | "storage_failure" };

type ClaimResult = { code: "claimed"; job: LoopJob } | { code: "no_job" | "storage_failure" };

type MutationResult = { ok: true } | { ok: false; code: "lease_lost" | "storage_failure" };

type RecoveryResult =
  | { ok: true; recovered: false }
  | { ok: true; recovered: true; job: LoopJob }
  | { ok: false; code: "storage_failure" };

const KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const VERSION_PATTERN = /^v[1-9][0-9]{0,5}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("unsupported canonical JSON value");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bytesToHex(bytes: Uint8Array, length: number): string {
  if (bytes.length !== length) throw new Error("entropy length mismatch");
  return Buffer.from(bytes).toString("hex");
}

function validOpaquePrefix(prefix: string): boolean {
  return /^[a-z][a-z0-9]{0,15}$/.test(prefix);
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

/**
 * Strict calendar validation for the ISO week identity used by H-CYCLE.
 * Calendar math is JST-shaped and never consults the host timezone or a clock.
 */
export function isValidJstIsoWeek(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return Number.isSafeInteger(year) && year >= 1 && year <= 9999
    && Number.isSafeInteger(week) && week >= 1 && week <= isoWeeksInJstYear(year);
}

export function defineLoopJobRegistry<const T extends LoopJobRegistry>(registry: T): T {
  for (const [kind, definition] of Object.entries(registry)) {
    if (!KIND_PATTERN.test(kind) || !VERSION_PATTERN.test(definition.version)) {
      throw new Error("invalid registry identity");
    }
    const fieldNames = new Set(Object.keys(definition.fields));
    if (fieldNames.size === 0 || definition.dedupeFields.length === 0) throw new Error("invalid registry schema");
    for (const fieldName of definition.dedupeFields) {
      if (!fieldNames.has(fieldName)) throw new Error("invalid registry projection");
    }
    for (const field of Object.values(definition.fields)) {
      if (field.type === "opaque_id" && !validOpaquePrefix(field.prefix)) throw new Error("invalid opaque id prefix");
      if (field.type === "enum" && (field.values.length === 0 || field.values.some((value) => !KIND_PATTERN.test(value)))) {
        throw new Error("invalid enum registry field");
      }
    }
  }
  const immutableRegistry = Object.assign(
    Object.create(null) as Record<string, JobDefinition>,
    Object.fromEntries(
      Object.entries(registry).map(([kind, definition]) => [
        kind,
        Object.freeze({
          version: definition.version,
          fields: Object.freeze(Object.fromEntries(
            Object.entries(definition.fields).map(([name, field]) => [
              name,
              Object.freeze(field.type === "enum" ? { ...field, values: Object.freeze([...field.values]) } : { ...field }),
            ]),
          )),
          dedupeFields: Object.freeze([...definition.dedupeFields]),
        }),
      ]),
    ),
  );
  return Object.freeze(immutableRegistry) as T;
}

function validatePayload(definition: JobDefinition, payload: unknown): payload is Record<string, string> {
  if (!isPlainObject(payload)) return false;
  const expectedKeys = Object.keys(definition.fields).sort();
  const suppliedKeys = Object.keys(payload).sort();
  if (canonicalJson(expectedKeys) !== canonicalJson(suppliedKeys)) return false;

  for (const [name, field] of Object.entries(definition.fields)) {
    const value = payload[name];
    if (typeof value !== "string") return false;
    if (field.type === "hash" && !HASH_PATTERN.test(value)) return false;
    if (field.type === "enum" && !field.values.includes(value)) return false;
    if (field.type === "iso_week" && !isValidJstIsoWeek(value)) return false;
    if (field.type === "opaque_id") {
      const pattern = new RegExp(`^${field.prefix}_[0-9a-f]{32}$`);
      if (!pattern.test(value)) return false;
    }
  }
  return true;
}

export function decodeLoopJobPayload(
  registry: LoopJobRegistry,
  job: Pick<LoopJob, "kind" | "payloadJson" | "payloadHash">,
): { ok: true; payload: Record<string, string> } | { ok: false; code: "unknown_kind" | "invalid_payload" } {
  const definition = Object.hasOwn(registry, job.kind) ? registry[job.kind] : undefined;
  if (!definition) return { ok: false, code: "unknown_kind" };
  try {
    const payload: unknown = JSON.parse(job.payloadJson);
    if (!validatePayload(definition, payload)) return { ok: false, code: "invalid_payload" };
    const canonical = canonicalJson(payload);
    if (canonical !== job.payloadJson || sha256(canonical) !== job.payloadHash) {
      return { ok: false, code: "invalid_payload" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, code: "invalid_payload" };
  }
}

function isExactEnqueueInput(input: unknown): input is EnqueueInput {
  if (!isPlainObject(input)) return false;
  const allowed = new Set(["kind", "payload", "maxAttempts", "availableAt"]);
  return Object.keys(input).every((key) => allowed.has(key));
}

function targetedDedupeP2002(error: unknown): boolean {
  if (!isRecord(error) || error.code !== "P2002" || !isRecord(error.meta)) return false;
  if (error.meta.modelName !== undefined && error.meta.modelName !== "LoopJob") return false;
  const target = error.meta.target;
  if (Array.isArray(target)) return target.length === 1 && target[0] === "dedupeKey";
  if (target === "dedupeKey" || target === "LoopJob_dedupeKey_key") return true;

  // Prisma 7's driver-adapter path carries the structured constraint below
  // instead of `meta.target`; never inspect the database message fallback.
  const driverAdapterError = error.meta.driverAdapterError;
  if (!isRecord(driverAdapterError) || !isRecord(driverAdapterError.cause)) return false;
  const constraint = driverAdapterError.cause.constraint;
  return isRecord(constraint) && Array.isArray(constraint.fields) &&
    constraint.fields.length === 1 && constraint.fields[0] === "dedupeKey";
}

function unexpiredOwnership(jobId: string, leaseToken: string, now: Date) {
  return {
    id: jobId,
    status: "running" as const,
    // A8-C3 BEGIN: generic owned mutation reserved-kind fence
    kind: { not: "h_cycle_evaluate" },
    // A8-C3 END: generic owned mutation reserved-kind fence
    leaseToken,
    leaseExpiresAt: { gt: now },
  };
}

function clearedLease(finishedAt: Date | null) {
  return {
    lockedAt: null,
    leaseExpiresAt: null,
    lockedBy: null,
    leaseToken: null,
    finishedAt,
  };
}

export function deterministicBackoffMs(input: {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  entropy: number;
}): number {
  const { attempts, baseDelayMs, maxDelayMs, entropy } = input;
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 ||
      !Number.isSafeInteger(maxDelayMs) || maxDelayMs < 0 || !Number.isFinite(entropy) || entropy < 0 || entropy >= 1) {
    throw new RangeError("invalid backoff input");
  }
  const unjittered = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempts - 1));
  return Math.floor(unjittered * (0.5 + entropy));
}

export function createLoopJobQueue(input: {
  client: LoopJobClient;
  registry: LoopJobRegistry;
  clock: InjectedClock;
  randomBytes?: (length: number) => Uint8Array;
}) {
  const { client, registry, clock } = input;
  const randomBytes = input.randomBytes ?? secureRandomBytes;

  async function failOwned(options: {
    jobId: string;
    leaseToken: string;
    lastError: LastErrorCode;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterEntropy: number;
  }): Promise<
    | { ok: true; code: "retry_scheduled"; availableAt: Date }
    | { ok: true; code: "dead" }
    | { ok: false; code: "lease_lost" | "storage_failure" }
  > {
    try {
      const now = clock.now();
      const owned = await client.loopJob.findUnique({ where: { id: options.jobId } });
      if (!owned || owned.status !== "running" || owned.leaseToken !== options.leaseToken ||
          owned.leaseExpiresAt === null || owned.leaseExpiresAt.getTime() <= now.getTime()) {
        return { ok: false, code: "lease_lost" };
      }
      const delayMs = deterministicBackoffMs({
        attempts: owned.attempts,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        entropy: options.jitterEntropy,
      });
      const availableAt = clock.addMilliseconds(now, delayMs);
      const dead = owned.attempts >= owned.maxAttempts;
      const result = await client.loopJob.updateMany({
        where: unexpiredOwnership(options.jobId, options.leaseToken, now),
        data: {
          status: dead ? "dead" : "retry_wait",
          availableAt,
          lastError: options.lastError,
          updatedAt: now,
          ...clearedLease(dead ? now : null),
        },
      });
      if (result.count !== 1) return { ok: false, code: "lease_lost" };
      return dead ? { ok: true, code: "dead" } : { ok: true, code: "retry_scheduled", availableAt };
    } catch {
      return { ok: false, code: "storage_failure" };
    }
  }

  return {
    async enqueue(rawInput: EnqueueInput): Promise<EnqueueResult> {
      if (!isExactEnqueueInput(rawInput)) return { ok: false, code: "invalid_payload" };
      const { kind, payload, maxAttempts } = rawInput;
      // A8-C3 BEGIN: generic queue enqueue reserved-kind fence
      if (kind === "h_cycle_evaluate") return { ok: false, code: "invalid_payload" };
      // A8-C3 END: generic queue enqueue reserved-kind fence
      const definition = Object.hasOwn(registry, kind) ? registry[kind] : undefined;
      if (!definition || !Number.isInteger(maxAttempts) || maxAttempts < 1 || !validatePayload(definition, payload)) {
        return { ok: false, code: "invalid_payload" };
      }
      if (rawInput.availableAt !== undefined && !(rawInput.availableAt instanceof Date)) {
        return { ok: false, code: "invalid_payload" };
      }

      try {
        const payloadJson = canonicalJson(payload);
        const payloadHash = sha256(payloadJson);
        const projection = Object.fromEntries(definition.dedupeFields.map((field) => [field, payload[field]]));
        const dedupeKey = `${kind}:${definition.version}:${sha256(canonicalJson(projection))}`;
        const now = clock.now();
        const id = `job_${bytesToHex(randomBytes(16), 16)}`;

        try {
          const job = await client.loopJob.create({
            data: {
              id,
              kind,
              dedupeKey,
              payloadJson,
              payloadHash,
              status: "queued",
              attempts: 0,
              maxAttempts,
              availableAt: rawInput.availableAt ?? now,
              lockedAt: null,
              leaseExpiresAt: null,
              lockedBy: null,
              leaseToken: null,
              lastError: null,
              createdAt: now,
              updatedAt: now,
              finishedAt: null,
            },
          });
          return { ok: true, created: true, job };
        } catch (error) {
          if (!targetedDedupeP2002(error)) return { ok: false, code: "storage_failure" };
          try {
            const winner = await client.loopJob.findUnique({ where: { dedupeKey } });
            if (!winner) return { ok: false, code: "storage_failure" };
            if (winner.payloadHash !== payloadHash) return { ok: false, code: "dedupe_payload_conflict" };
            return { ok: true, created: false, job: winner };
          } catch {
            return { ok: false, code: "storage_failure" };
          }
        }
      } catch {
        return { ok: false, code: "storage_failure" };
      }
    },

    async claim(options: { leaseDurationMs: number }): Promise<ClaimResult> {
      if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs <= 0) return { code: "storage_failure" };
      try {
        const now = clock.now();
        const leaseExpiresAt = clock.addMilliseconds(now, options.leaseDurationMs);
        const lockedBy = `worker_${bytesToHex(randomBytes(16), 16)}`;
        const leaseToken = bytesToHex(randomBytes(32), 32);
        const result = await claimOneRaw({
          client,
          now,
          leaseExpiresAt,
          lockedBy,
          leaseToken,
          fromStorage: clock.fromStorage,
        });
        if (!result.ok) return { code: result.code };
        return result.rows.length === 0 ? { code: "no_job" } : { code: "claimed", job: result.rows[0] };
      } catch {
        return { code: "storage_failure" };
      }
    },

    // A8-C2 BEGIN: queue claimKind method
    async claimKind(rawInput: unknown): Promise<ClaimResult> {
      let kind: string;
      let leaseDurationMs: number;
      try {
        if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput) || nodeTypes.isProxy(rawInput)) {
          return { code: "storage_failure" };
        }
        const prototype = Object.getPrototypeOf(rawInput);
        if (prototype !== Object.prototype && prototype !== null) return { code: "storage_failure" };
        const keys = Reflect.ownKeys(rawInput);
        if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "leaseDurationMs") {
          return { code: "storage_failure" };
        }
        const kindDescriptor = Object.getOwnPropertyDescriptor(rawInput, "kind");
        const leaseDescriptor = Object.getOwnPropertyDescriptor(rawInput, "leaseDurationMs");
        if (!kindDescriptor || !kindDescriptor.enumerable || !("value" in kindDescriptor) ||
            !leaseDescriptor || !leaseDescriptor.enumerable || !("value" in leaseDescriptor)) {
          return { code: "storage_failure" };
        }
        const snapshottedKind = kindDescriptor.value;
        const snapshottedLeaseDurationMs = leaseDescriptor.value;
        if (typeof snapshottedKind !== "string" || !KIND_PATTERN.test(snapshottedKind) ||
            !Number.isSafeInteger(snapshottedLeaseDurationMs) || snapshottedLeaseDurationMs <= 0) {
          return { code: "storage_failure" };
        }
        kind = snapshottedKind;
        // A8-C3 BEGIN: generic queue claimKind reserved-kind fence
        if (kind === "h_cycle_evaluate") return { code: "storage_failure" };
        // A8-C3 END: generic queue claimKind reserved-kind fence
        leaseDurationMs = snapshottedLeaseDurationMs;
      } catch {
        return { code: "storage_failure" };
      }

      try {
        const now = clock.now();
        const leaseExpiresAt = clock.addMilliseconds(now, leaseDurationMs);
        const lockedBy = `worker_${bytesToHex(randomBytes(16), 16)}`;
        const leaseToken = bytesToHex(randomBytes(32), 32);
        const result = await claimOneKindRaw({
          client,
          kind,
          now,
          leaseExpiresAt,
          lockedBy,
          leaseToken,
          fromStorage: clock.fromStorage,
        });
        if (!result.ok) return { code: result.code };
        return result.rows.length === 0 ? { code: "no_job" } : { code: "claimed", job: result.rows[0] };
      } catch {
        return { code: "storage_failure" };
      }
    },
    // A8-C2 END: queue claimKind method

    async renew(options: {
      jobId: string;
      leaseToken: string;
      leaseDurationMs: number;
    }): Promise<{ ok: true; leaseExpiresAt: Date } | { ok: false; code: "lease_lost" | "storage_failure" }> {
      if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs <= 0) {
        return { ok: false, code: "storage_failure" };
      }
      try {
        const now = clock.now();
        const leaseExpiresAt = clock.addMilliseconds(now, options.leaseDurationMs);
        const result = await renewOwnedRaw({
          client,
          jobId: options.jobId,
          leaseToken: options.leaseToken,
          now,
          leaseExpiresAt,
          fromStorage: clock.fromStorage,
        });
        if (!result.ok) return result;
        return result.rows.length === 1
          ? { ok: true, leaseExpiresAt: result.rows[0].leaseExpiresAt }
          : { ok: false, code: "lease_lost" };
      } catch {
        return { ok: false, code: "storage_failure" };
      }
    },

    async recoverExpired(): Promise<RecoveryResult> {
      try {
        const result = await recoverOneExpiredRaw({
          client,
          now: clock.now(),
          fromStorage: clock.fromStorage,
        });
        if (!result.ok) return result;
        return result.rows.length === 0
          ? { ok: true, recovered: false }
          : { ok: true, recovered: true, job: result.rows[0] };
      } catch {
        return { ok: false, code: "storage_failure" };
      }
    },

    async succeedOwned(options: { jobId: string; leaseToken: string }): Promise<MutationResult> {
      try {
        const now = clock.now();
        const result = await client.loopJob.updateMany({
          where: unexpiredOwnership(options.jobId, options.leaseToken, now),
          data: {
            status: "succeeded",
            updatedAt: now,
            ...clearedLease(now),
          },
        });
        return result.count === 1 ? { ok: true } : { ok: false, code: "lease_lost" };
      } catch {
        return { ok: false, code: "storage_failure" };
      }
    },

    failOwned,
  };
}

export type LoopJobQueue = ReturnType<typeof createLoopJobQueue>;
