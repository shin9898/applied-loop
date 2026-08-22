import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

import {
  CLAIM_EMPTY_ERROR_CODES,
  ENQUEUE_ERROR_CODES,
  LAST_ERROR_CODES,
  ONE_SHOT_OUTCOME_CODES,
  OWNERSHIP_ERROR_CODES,
  WORKER_ERROR_CODES,
} from "./closed-codes";
import { runOneDelivery, type LoopJobHandler } from "./delivery";
import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

const BASE_NOW = new Date("2026-08-22T08:00:00.000Z");
const registry = defineLoopJobRegistry({
  recovery_probe: {
    version: "v1",
    fields: {
      entityId: { type: "opaque_id", prefix: "entity" },
      operation: { type: "enum", values: ["recover"] as const },
      artifactHash: { type: "hash" },
    },
    dedupeFields: ["entityId", "operation"] as const,
  },
});

function entropy(seed: number) {
  let next = seed;
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = next % 256;
      next += 1;
    }
    return bytes;
  };
}

function clockAt(instant: Date) {
  return {
    now: () => new Date(instant),
    addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
    fromStorage: (value: string) => new Date(value),
  };
}

function makeClient(databasePath: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout: 250 },
      { timestampFormat: "iso8601" },
    ),
  });
}

function payload(entityByte: string) {
  return {
    entityId: `entity_${entityByte.repeat(32)}`,
    operation: "recover",
    artifactHash: "a".repeat(64),
  };
}

test("A2-CG3-T1 crash-restart-recovery", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "applied-loop-a2-cg3-"));
  const databasePath = join(fixtureRoot, "crash recovery.db");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    stdio: "pipe",
  });
  const client = makeClient(databasePath);
  let seed = 0;

  function queueAt(instant: Date) {
    seed += 20;
    return createLoopJobQueue({ client, registry, clock: clockAt(instant), randomBytes: entropy(seed) });
  }

  async function enqueue(entityByte: string, maxAttempts: number, instant = BASE_NOW) {
    const result = await queueAt(instant).enqueue({
      kind: "recovery_probe",
      payload: payload(entityByte),
      maxAttempts,
    });
    assert.equal(result.ok, true);
    return result.ok ? result.job : assert.fail("enqueue failed");
  }

  try {
    await t.test("all persisted/library/one-shot/worker code unions remain closed", () => {
      assert.deepEqual(LAST_ERROR_CODES, ["handler_failed", "unknown_kind", "invalid_payload", "lease_expired"]);
      assert.deepEqual(ENQUEUE_ERROR_CODES, ["invalid_payload", "dedupe_payload_conflict", "storage_failure"]);
      assert.deepEqual(OWNERSHIP_ERROR_CODES, ["lease_lost", "storage_failure"]);
      assert.deepEqual(CLAIM_EMPTY_ERROR_CODES, ["no_job", "storage_failure"]);
      assert.deepEqual(ONE_SHOT_OUTCOME_CODES, ["no_job", "job_succeeded", "job_retry_scheduled", "job_dead"]);
      assert.deepEqual(WORKER_ERROR_CODES, [
        "worker_disabled",
        "worker_invalid_arguments",
        "worker_database_url_invalid",
        "worker_database_unavailable",
        "storage_failure",
      ]);
    });

    await t.test("effect-before-success crash recovers and redelivers idempotently", async () => {
      const job = await enqueue("1", 3);
      const firstQueue = queueAt(BASE_NOW);
      const firstClaim = await firstQueue.claim({ leaseDurationMs: 1_000 });
      assert.equal(firstClaim.code, "claimed");
      if (firstClaim.code !== "claimed") return;

      let deliveries = 0;
      const effects = new Set<string>();
      const handler: LoopJobHandler = {
        idempotencyKey: "job_id",
        async handle(context) {
          deliveries += 1;
          effects.add(context.idempotencyKey);
        },
      };

      // The first process applies its idempotent effect and disappears before success.
      await handler.handle({ idempotencyKey: job.id, payload: payload("1") });
      assert.equal(deliveries, 1);
      assert.equal(effects.size, 1);

      const expiry = new Date(BASE_NOW.getTime() + 1_000);
      const restartQueue = queueAt(expiry);
      const recovered = await restartQueue.recoverExpired();
      assert.equal(recovered.ok, true);
      assert.equal(recovered.ok ? recovered.recovered : false, true);
      const recoveredRow = await client.loopJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(recoveredRow.status, "retry_wait");
      assert.equal(recoveredRow.attempts, 1);
      assert.equal(recoveredRow.lastError, "lease_expired");

      const outcome = await runOneDelivery({
        queue: restartQueue,
        registry,
        handlers: { recovery_probe: handler },
        leaseDurationMs: 1_000,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        jitterEntropy: 0,
      });
      assert.deepEqual(outcome, { ok: true, code: "job_succeeded" });
      assert.equal(deliveries, 2);
      assert.equal(effects.size, 1);
      const succeeded = await client.loopJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(succeeded.status, "succeeded");
      assert.equal(succeeded.attempts, 2);
      assert.equal(succeeded.finishedAt?.getTime(), expiry.getTime());
    });

    await t.test("expired final attempt becomes retained dead without another attempt", async () => {
      const job = await enqueue("2", 1, new Date(BASE_NOW.getTime() + 2_000));
      const claimedAt = new Date(BASE_NOW.getTime() + 2_000);
      const claim = await queueAt(claimedAt).claim({ leaseDurationMs: 500 });
      assert.equal(claim.code, "claimed");
      assert.equal(claim.code === "claimed" ? claim.job.attempts : 0, 1);
      const expiry = new Date(claimedAt.getTime() + 500);
      const recoveryQueue = queueAt(expiry);
      const recovered = await recoveryQueue.recoverExpired();
      assert.equal(recovered.ok, true);
      assert.equal(recovered.ok ? recovered.recovered : false, true);
      const dead = await client.loopJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(dead.status, "dead");
      assert.equal(dead.attempts, 1);
      assert.equal(dead.lastError, "lease_expired");
      assert.equal(dead.finishedAt?.getTime(), expiry.getTime());
      assert.deepEqual(await recoveryQueue.claim({ leaseDurationMs: 500 }), { code: "no_job" });
      assert.equal(await client.loopJob.count({ where: { id: job.id } }), 1);
    });

    await t.test("malformed, unknown, and thrown delivery failures are sanitized and retained", async () => {
      const adversarial = [
        "payload-secret-do-not-echo",
        "handler-error-do-not-echo",
        "file:///private/secret.db",
        "curl -H Authorization:secret-token",
        "attacker-token-do-not-echo",
      ];
      const malformed = await enqueue("3", 1, new Date(BASE_NOW.getTime() + 3_000));
      await client.loopJob.update({
        where: { id: malformed.id },
        data: { payloadJson: JSON.stringify({ secret: adversarial.join("|") }) },
      });
      const malformedResult = await runOneDelivery({
        queue: queueAt(new Date(BASE_NOW.getTime() + 3_000)),
        registry,
        handlers: {},
        leaseDurationMs: 500,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        jitterEntropy: 0,
      });
      assert.deepEqual(malformedResult, { ok: true, code: "job_dead" });

      const unknown = await enqueue("4", 1, new Date(BASE_NOW.getTime() + 4_000));
      // `constructor` is valid under the persisted kind grammar but must not
      // resolve through Object.prototype on registry or handler lookups.
      await client.loopJob.update({ where: { id: unknown.id }, data: { kind: "constructor" } });
      const unknownResult = await runOneDelivery({
        queue: queueAt(new Date(BASE_NOW.getTime() + 4_000)),
        registry,
        handlers: {},
        leaseDurationMs: 500,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        jitterEntropy: 0,
      });
      assert.deepEqual(unknownResult, { ok: true, code: "job_dead" });
      assert.equal(
        (await client.loopJob.findUniqueOrThrow({ where: { id: unknown.id } })).lastError,
        "unknown_kind",
      );

      const thrown = await enqueue("5", 2, new Date(BASE_NOW.getTime() + 5_000));
      const child = fork(join(process.cwd(), "src/lib/loop-jobs/delivery-no-echo-helper.ts"), [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          LOOP_JOB_TEST_DATABASE_PATH: databasePath,
          LOOP_JOB_TEST_NOW: new Date(BASE_NOW.getTime() + 5_000).toISOString(),
          LOOP_JOB_TEST_THROWN_SECRET: adversarial.join("|"),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      const resultMessage = new Promise<unknown>((resolve, reject) => {
        child.once("message", (message: unknown) => resolve(message));
        child.once("error", reject);
      });
      const cleanExit = new Promise<void>((resolve, reject) => {
        child.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`no-echo helper failed code=${String(code)} stderr-bytes=${stderr.length}`));
        });
      });
      const [thrownResult] = await Promise.all([resultMessage, cleanExit]);
      assert.deepEqual(thrownResult, { ok: true, code: "job_retry_scheduled" });
      assert.equal(stdout, "");
      assert.equal(stderr, "");
      const thrownRow = await client.loopJob.findUniqueOrThrow({ where: { id: thrown.id } });
      assert.equal(thrownRow.status, "retry_wait");
      assert.equal(thrownRow.lastError, "handler_failed");
      // The deliberately corrupted source payloadJson remains retained; verify it
      // was not copied into any state/error/ownership/output boundary.
      const retained = await client.loopJob.findMany({
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          lastError: true,
          finishedAt: true,
          lockedAt: true,
          leaseExpiresAt: true,
          lockedBy: true,
          leaseToken: true,
        },
      });
      const safeState = JSON.stringify(retained);
      for (const secret of adversarial) assert.equal(safeState.includes(secret), false);
      assert.deepEqual(
        [...new Set(retained.map((row) => row.lastError).filter((value): value is string => value !== null))].sort(),
        [...LAST_ERROR_CODES].sort(),
      );
      const statuses = new Set(retained.map((row) => row.status));
      for (const status of ["queued", "retry_wait", "succeeded", "dead"]) {
        if (status === "queued" && !statuses.has(status)) await enqueue("6", 3, new Date(BASE_NOW.getTime() + 60_000));
      }
      const retainedStatuses = new Set((await client.loopJob.findMany({ select: { status: true } })).map((row) => row.status));
      assert.deepEqual([...retainedStatuses].sort(), ["dead", "queued", "retry_wait", "succeeded"]);
    });
  } finally {
    await client.$disconnect();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
