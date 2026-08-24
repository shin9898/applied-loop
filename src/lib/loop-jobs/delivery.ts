import type { LastErrorCode, OneShotOutcomeCode, OwnershipErrorCode } from "./closed-codes";
import {
  decodeLoopJobPayload,
  type LoopJobQueue,
  type LoopJobRegistry,
} from "./state-machine";

// A8-C2 BEGIN: scoped capability snapshot helpers
import { types as nodeTypes } from "node:util";

import { defineLoopJobRegistry } from "./state-machine";

const SCOPED_KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

type RegistryFieldSnapshot =
  | { type: "opaque_id"; prefix: string }
  | { type: "enum"; values: readonly string[] }
  | { type: "hash" }
  | { type: "iso_week" };

type RegistryDefinitionSnapshot = {
  version: string;
  fields: Record<string, RegistryFieldSnapshot>;
  dedupeFields: readonly string[];
};

type Callable = (this: unknown, ...args: never[]) => unknown;

function capabilityObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null || typeof value === "function") && !nodeTypes.isProxy(value);
}

function ownDataDescriptor(
  target: unknown,
  key: PropertyKey,
  enumerable?: boolean,
): PropertyDescriptor | undefined {
  if (!capabilityObject(target)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  if (enumerable !== undefined && descriptor.enumerable !== enumerable) return undefined;
  return descriptor;
}

function hasExactOwnKeys(target: object, expected: readonly PropertyKey[]): boolean {
  const keys = Reflect.ownKeys(target);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function snapshotStringArray(value: unknown): readonly string[] | undefined {
  if (!capabilityObject(value) || !Array.isArray(value)) return undefined;
  const lengthDescriptor = ownDataDescriptor(value, "length", false);
  if (!lengthDescriptor || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return undefined;
  const length = lengthDescriptor.value as number;
  const expectedKeys = [...Array.from({ length }, (_, index) => String(index)), "length"];
  if (!hasExactOwnKeys(value, expectedKeys)) return undefined;
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = ownDataDescriptor(value, String(index), true);
    if (!descriptor || typeof descriptor.value !== "string") return undefined;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function snapshotRegistryField(value: unknown): RegistryFieldSnapshot | undefined {
  if (!capabilityObject(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const typeDescriptor = ownDataDescriptor(value, "type", true);
  if (!typeDescriptor || typeof typeDescriptor.value !== "string") return undefined;
  if (typeDescriptor.value === "hash" || typeDescriptor.value === "iso_week") {
    if (!hasExactOwnKeys(value, ["type"])) return undefined;
    return { type: typeDescriptor.value };
  }
  if (typeDescriptor.value === "opaque_id") {
    if (!hasExactOwnKeys(value, ["type", "prefix"])) return undefined;
    const prefixDescriptor = ownDataDescriptor(value, "prefix", true);
    return prefixDescriptor && typeof prefixDescriptor.value === "string"
      ? { type: "opaque_id", prefix: prefixDescriptor.value }
      : undefined;
  }
  if (typeDescriptor.value === "enum") {
    if (!hasExactOwnKeys(value, ["type", "values"])) return undefined;
    const valuesDescriptor = ownDataDescriptor(value, "values", true);
    const values = valuesDescriptor ? snapshotStringArray(valuesDescriptor.value) : undefined;
    return values ? { type: "enum", values } : undefined;
  }
  return undefined;
}

function snapshotRegistryDefinition(value: unknown): RegistryDefinitionSnapshot | undefined {
  if (!capabilityObject(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (!hasExactOwnKeys(value, ["version", "fields", "dedupeFields"])) return undefined;
  const versionDescriptor = ownDataDescriptor(value, "version", true);
  const fieldsDescriptor = ownDataDescriptor(value, "fields", true);
  const dedupeDescriptor = ownDataDescriptor(value, "dedupeFields", true);
  if (!versionDescriptor || typeof versionDescriptor.value !== "string" || !fieldsDescriptor || !dedupeDescriptor) {
    return undefined;
  }
  const rawFields = fieldsDescriptor.value;
  if (!capabilityObject(rawFields)) return undefined;
  const fieldsPrototype = Object.getPrototypeOf(rawFields);
  if (fieldsPrototype !== Object.prototype && fieldsPrototype !== null) return undefined;
  const fieldKeys = Reflect.ownKeys(rawFields);
  if (fieldKeys.length === 0 || fieldKeys.some((key) => typeof key !== "string")) return undefined;
  const fields = Object.create(null) as Record<string, RegistryFieldSnapshot>;
  for (const fieldName of fieldKeys as string[]) {
    const fieldDescriptor = ownDataDescriptor(rawFields, fieldName, true);
    const field = fieldDescriptor ? snapshotRegistryField(fieldDescriptor.value) : undefined;
    if (!field) return undefined;
    fields[fieldName] = field;
  }
  const dedupeFields = snapshotStringArray(dedupeDescriptor.value);
  if (!dedupeFields) return undefined;
  return {
    version: versionDescriptor.value,
    fields,
    dedupeFields,
  };
}

function snapshotOneEntryRegistry(registry: unknown, kind: string): LoopJobRegistry | undefined {
  if (!capabilityObject(registry)) return undefined;
  const descriptor = ownDataDescriptor(registry, kind);
  const definition = descriptor ? snapshotRegistryDefinition(descriptor.value) : undefined;
  if (!definition) return undefined;
  return defineLoopJobRegistry({ [kind]: definition });
}

function snapshotCallable(target: unknown, key: PropertyKey): Callable | undefined {
  const descriptor = ownDataDescriptor(target, key);
  return descriptor && typeof descriptor.value === "function" && !nodeTypes.isProxy(descriptor.value)
    ? descriptor.value as Callable
    : undefined;
}

type ScopedJobSnapshot = Readonly<{
  id: string;
  kind: string;
  payloadJson: string;
  payloadHash: string;
  leaseToken: string;
}>;

function snapshotClaimedJob(value: unknown): ScopedJobSnapshot | undefined {
  if (!capabilityObject(value)) return undefined;
  const requiredStrings = ["id", "kind", "payloadJson", "payloadHash", "leaseToken"] as const;
  const descriptors = Object.create(null) as Record<(typeof requiredStrings)[number], PropertyDescriptor>;
  for (const key of requiredStrings) {
    const descriptor = ownDataDescriptor(value, key, true);
    if (!descriptor || typeof descriptor.value !== "string") return undefined;
    descriptors[key] = descriptor;
  }
  return Object.freeze({
    id: descriptors.id.value,
    kind: descriptors.kind.value,
    payloadJson: descriptors.payloadJson.value,
    payloadHash: descriptors.payloadHash.value,
    leaseToken: descriptors.leaseToken.value,
  });
}

function closedMutationResult(value: unknown):
  | { ok: true; code?: "retry_scheduled" | "dead" }
  | { ok: false; code: OwnershipErrorCode }
  | undefined {
  if (!capabilityObject(value)) return undefined;
  const okDescriptor = ownDataDescriptor(value, "ok", true);
  if (!okDescriptor || typeof okDescriptor.value !== "boolean") return undefined;
  if (okDescriptor.value === false) {
    const codeDescriptor = ownDataDescriptor(value, "code", true);
    if (!codeDescriptor || codeDescriptor.value !== "lease_lost" && codeDescriptor.value !== "storage_failure") {
      return undefined;
    }
    return { ok: false, code: codeDescriptor.value };
  }
  const codeDescriptor = ownDataDescriptor(value, "code", true);
  if (!codeDescriptor) return { ok: true };
  return codeDescriptor.value === "retry_scheduled" || codeDescriptor.value === "dead"
    ? { ok: true, code: codeDescriptor.value }
    : undefined;
}

function closedSucceedResult(value: unknown): { ok: true } | { ok: false; code: OwnershipErrorCode } | undefined {
  if (!capabilityObject(value)) return undefined;
  const okDescriptor = ownDataDescriptor(value, "ok", true);
  if (!okDescriptor || typeof okDescriptor.value !== "boolean") return undefined;
  if (okDescriptor.value === true) {
    return hasExactOwnKeys(value, ["ok"]) ? { ok: true } : undefined;
  }
  const codeDescriptor = ownDataDescriptor(value, "code", true);
  if (!hasExactOwnKeys(value, ["ok", "code"]) || !codeDescriptor ||
      codeDescriptor.value !== "lease_lost" && codeDescriptor.value !== "storage_failure") {
    return undefined;
  }
  return { ok: false, code: codeDescriptor.value };
}

async function recordScopedFailure(input: {
  queueReceiver: object;
  failOwned: Callable;
  jobId: string;
  leaseToken: string;
  lastError: LastErrorCode;
  retry: RetryPolicy;
}): Promise<OneShotResult> {
  try {
    const rawResult = await Reflect.apply(input.failOwned, input.queueReceiver, [{
      jobId: input.jobId,
      leaseToken: input.leaseToken,
      lastError: input.lastError,
      ...input.retry,
    }]);
    const result = closedMutationResult(rawResult);
    if (!result) return { ok: false, code: "storage_failure" };
    if (!result.ok) return { ok: false, code: result.code };
    if (result.code === "dead") return { ok: true, code: "job_dead" };
    if (result.code === "retry_scheduled") return { ok: true, code: "job_retry_scheduled" };
    return { ok: false, code: "storage_failure" };
  } catch {
    return { ok: false, code: "storage_failure" };
  }
}
// A8-C2 END: scoped capability snapshot helpers

export type LoopJobHandler = {
  idempotencyKey: "job_id";
  handle: (context: { idempotencyKey: string; payload: Record<string, string> }) => Promise<void>;
};

type OneShotResult =
  | { ok: true; code: OneShotOutcomeCode }
  | { ok: false; code: OwnershipErrorCode };

type RetryPolicy = {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterEntropy: number;
};

async function recordFailure(input: {
  queue: LoopJobQueue;
  jobId: string;
  leaseToken: string;
  lastError: LastErrorCode;
  retry: RetryPolicy;
}): Promise<OneShotResult> {
  const result = await input.queue.failOwned({
    jobId: input.jobId,
    leaseToken: input.leaseToken,
    lastError: input.lastError,
    ...input.retry,
  });
  if (!result.ok) return result;
  return { ok: true, code: result.code === "dead" ? "job_dead" : "job_retry_scheduled" };
}

export async function runOneDelivery(input: {
  queue: LoopJobQueue;
  registry: LoopJobRegistry;
  handlers: Readonly<Record<string, LoopJobHandler>>;
  leaseDurationMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterEntropy: number;
}): Promise<OneShotResult> {
  const claim = await input.queue.claim({ leaseDurationMs: input.leaseDurationMs });
  if (claim.code !== "claimed") {
    return claim.code === "no_job"
      ? { ok: true, code: "no_job" }
      : { ok: false, code: "storage_failure" };
  }

  const retry = {
    baseDelayMs: input.baseDelayMs,
    maxDelayMs: input.maxDelayMs,
    jitterEntropy: input.jitterEntropy,
  };
  const leaseToken = claim.job.leaseToken!;
  const decoded = decodeLoopJobPayload(input.registry, claim.job);
  if (!decoded.ok) {
    return recordFailure({
      queue: input.queue,
      jobId: claim.job.id,
      leaseToken,
      lastError: decoded.code,
      retry,
    });
  }

  const handler = Object.hasOwn(input.handlers, claim.job.kind)
    ? input.handlers[claim.job.kind]
    : undefined;
  if (!handler || handler.idempotencyKey !== "job_id") {
    return recordFailure({
      queue: input.queue,
      jobId: claim.job.id,
      leaseToken,
      lastError: "unknown_kind",
      retry,
    });
  }

  try {
    await handler.handle({ idempotencyKey: claim.job.id, payload: decoded.payload });
  } catch {
    return recordFailure({
      queue: input.queue,
      jobId: claim.job.id,
      leaseToken,
      lastError: "handler_failed",
      retry,
    });
  }

  const succeeded = await input.queue.succeedOwned({ jobId: claim.job.id, leaseToken });
  return succeeded.ok ? { ok: true, code: "job_succeeded" } : succeeded;
}

// A8-C2 BEGIN: runOneKindDelivery
export async function runOneKindDelivery(input: {
  kind: string;
  queue: LoopJobQueue;
  registry: LoopJobRegistry;
  handlers: Readonly<Record<string, LoopJobHandler>>;
  leaseDurationMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterEntropy: number;
}): Promise<OneShotResult> {
  let snapshottedKind: string;
  let registrySnapshot: LoopJobRegistry;
  let handlerReceiver: object;
  let handle: Callable;
  let queueReceiver: object;
  let claimKind: Callable;
  let failOwned: Callable;
  let succeedOwned: Callable;
  let leaseDurationMs: number;
  let retry: RetryPolicy;
  try {
    const kindDescriptor = ownDataDescriptor(input, "kind", true);
    if (!kindDescriptor || typeof kindDescriptor.value !== "string" || !SCOPED_KIND_PATTERN.test(kindDescriptor.value)) {
      return { ok: false, code: "storage_failure" };
    }
    snapshottedKind = kindDescriptor.value;

    const registryDescriptor = ownDataDescriptor(input, "registry", true);
    const normalizedRegistry = registryDescriptor
      ? snapshotOneEntryRegistry(registryDescriptor.value, snapshottedKind)
      : undefined;
    if (!normalizedRegistry) return { ok: false, code: "storage_failure" };
    registrySnapshot = normalizedRegistry;

    const handlersDescriptor = ownDataDescriptor(input, "handlers", true);
    const handlers = handlersDescriptor?.value;
    if (!capabilityObject(handlers)) return { ok: false, code: "storage_failure" };
    const handlerDescriptor = ownDataDescriptor(handlers, snapshottedKind);
    const handler = handlerDescriptor?.value;
    if (!capabilityObject(handler)) return { ok: false, code: "storage_failure" };
    const idempotencyDescriptor = ownDataDescriptor(handler, "idempotencyKey");
    const snapshottedHandle = snapshotCallable(handler, "handle");
    if (!idempotencyDescriptor || idempotencyDescriptor.value !== "job_id" || !snapshottedHandle) {
      return { ok: false, code: "storage_failure" };
    }
    handlerReceiver = handler;
    handle = snapshottedHandle;

    const queueDescriptor = ownDataDescriptor(input, "queue", true);
    const queue = queueDescriptor?.value;
    if (!capabilityObject(queue)) return { ok: false, code: "storage_failure" };
    const snapshottedClaimKind = snapshotCallable(queue, "claimKind");
    const snapshottedFailOwned = snapshotCallable(queue, "failOwned");
    const snapshottedSucceedOwned = snapshotCallable(queue, "succeedOwned");
    if (!snapshottedClaimKind || !snapshottedFailOwned || !snapshottedSucceedOwned) {
      return { ok: false, code: "storage_failure" };
    }
    queueReceiver = queue;
    claimKind = snapshottedClaimKind;
    failOwned = snapshottedFailOwned;
    succeedOwned = snapshottedSucceedOwned;

    const leaseDescriptor = ownDataDescriptor(input, "leaseDurationMs", true);
    const baseDelayDescriptor = ownDataDescriptor(input, "baseDelayMs", true);
    const maxDelayDescriptor = ownDataDescriptor(input, "maxDelayMs", true);
    const jitterDescriptor = ownDataDescriptor(input, "jitterEntropy", true);
    if (!leaseDescriptor || !Number.isSafeInteger(leaseDescriptor.value) || leaseDescriptor.value <= 0 ||
        !baseDelayDescriptor || !Number.isSafeInteger(baseDelayDescriptor.value) || baseDelayDescriptor.value < 0 ||
        !maxDelayDescriptor || !Number.isSafeInteger(maxDelayDescriptor.value) || maxDelayDescriptor.value < 0 ||
        !jitterDescriptor || typeof jitterDescriptor.value !== "number" || !Number.isFinite(jitterDescriptor.value) ||
        jitterDescriptor.value < 0 || jitterDescriptor.value >= 1) {
      return { ok: false, code: "storage_failure" };
    }
    leaseDurationMs = leaseDescriptor.value;
    retry = {
      baseDelayMs: baseDelayDescriptor.value,
      maxDelayMs: maxDelayDescriptor.value,
      jitterEntropy: jitterDescriptor.value,
    };
  } catch {
    return { ok: false, code: "storage_failure" };
  }

  let claim: {
    code: "claimed";
    job: { id: string; kind: string; payloadJson: string; payloadHash: string; leaseToken: string };
  };
  try {
    const rawClaim = await Reflect.apply(claimKind, queueReceiver, [{
      kind: snapshottedKind,
      leaseDurationMs,
    }]);
    if (!capabilityObject(rawClaim)) return { ok: false, code: "storage_failure" };
    const codeDescriptor = ownDataDescriptor(rawClaim, "code", true);
    if (!codeDescriptor || typeof codeDescriptor.value !== "string") {
      return { ok: false, code: "storage_failure" };
    }
    if (codeDescriptor.value === "no_job") return { ok: true, code: "no_job" };
    if (codeDescriptor.value !== "claimed") return { ok: false, code: "storage_failure" };
    const jobDescriptor = ownDataDescriptor(rawClaim, "job", true);
    const jobSnapshot = jobDescriptor ? snapshotClaimedJob(jobDescriptor.value) : undefined;
    if (!jobSnapshot) return { ok: false, code: "storage_failure" };
    claim = { code: "claimed", job: jobSnapshot };
  } catch {
    return { ok: false, code: "storage_failure" };
  }

  if (claim.job.kind !== snapshottedKind) {
    return { ok: false, code: "storage_failure" };
  }
  const decoded = decodeLoopJobPayload(registrySnapshot, claim.job);
  if (!decoded.ok) {
    return recordScopedFailure({
      queueReceiver,
      failOwned,
      jobId: claim.job.id,
      leaseToken: claim.job.leaseToken,
      lastError: decoded.code,
      retry,
    });
  }

  try {
    await Reflect.apply(handle, handlerReceiver, [{ idempotencyKey: claim.job.id, payload: decoded.payload }]);
  } catch {
    return recordScopedFailure({
      queueReceiver,
      failOwned,
      jobId: claim.job.id,
      leaseToken: claim.job.leaseToken,
      lastError: "handler_failed",
      retry,
    });
  }

  try {
    const rawSucceeded = await Reflect.apply(succeedOwned, queueReceiver, [{
      jobId: claim.job.id,
      leaseToken: claim.job.leaseToken,
    }]);
    const succeeded = closedSucceedResult(rawSucceeded);
    if (!succeeded) return { ok: false, code: "storage_failure" };
    return succeeded.ok
      ? { ok: true, code: "job_succeeded" }
      : { ok: false, code: succeeded.code };
  } catch {
    return { ok: false, code: "storage_failure" };
  }
}
// A8-C2 END: runOneKindDelivery
