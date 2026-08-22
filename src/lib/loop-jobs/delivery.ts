import type { LastErrorCode, OneShotOutcomeCode, OwnershipErrorCode } from "./closed-codes";
import {
  decodeLoopJobPayload,
  type LoopJobQueue,
  type LoopJobRegistry,
} from "./state-machine";

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
