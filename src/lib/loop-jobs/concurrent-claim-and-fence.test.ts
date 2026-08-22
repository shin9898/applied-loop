import assert from "node:assert/strict";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

import {
  createLoopJobQueue,
  defineLoopJobRegistry,
  type LoopJobClient,
} from "./state-machine";

const BASE_NOW = new Date("2026-08-22T04:00:00.000Z");
const registry = defineLoopJobRegistry({
  fence_probe: {
    version: "v1",
    fields: {
      entityId: { type: "opaque_id", prefix: "entity" },
      operation: { type: "enum", values: ["fence"] as const },
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

function makeClient(databasePath: string, timeout = 1_000): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout },
      { timestampFormat: "iso8601" },
    ),
  });
}

const payload = {
  entityId: `entity_${"1".repeat(32)}`,
  operation: "fence",
  artifactHash: "2".repeat(64),
};

type HelperResult = {
  ok?: boolean;
  code?: string;
  recovered?: boolean;
  id?: string;
  attempts?: number;
  leaseToken?: string;
  lockedBy?: string;
  leaseExpiresAt?: string;
  status?: string;
};

type RaceChild = {
  process: ChildProcess;
  ready: Promise<void>;
  result: Promise<HelperResult>;
  exited: Promise<void>;
};

function startHelper(databasePath: string, env: Record<string, string>): RaceChild {
  const child = fork(join(process.cwd(), "src/lib/loop-jobs/concurrent-claim-helper.ts"), [], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, LOOP_JOB_TEST_DATABASE_PATH: databasePath, ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let markReady!: () => void;
  let resolveResult!: (result: HelperResult) => void;
  let rejectReady!: (error: Error) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { markReady = resolve; rejectReady = reject; });
  const result = new Promise<HelperResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const stderr: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
  child.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    if ((message as { type?: string }).type === "ready") markReady();
    if ((message as { type?: string }).type === "result") {
      resolveResult((message as { result: HelperResult }).result);
    }
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => { rejectReady(error); rejectResult(error); reject(error); });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`CG2 helper failed code=${String(code)} stderr-bytes=${stderr.join("").length}`);
        rejectReady(error);
        rejectResult(error);
        reject(error);
      }
    });
  });
  return { process: child, ready, result, exited };
}

async function synchronizedHelpers(left: RaceChild, right: RaceChild): Promise<[HelperResult, HelperResult]> {
  await Promise.all([left.ready, right.ready]);
  left.process.send?.({ type: "go" });
  right.process.send?.({ type: "go" });
  const results = await Promise.all([left.result, right.result]);
  await Promise.all([left.exited, right.exited]);
  return results;
}

test("A2-CG2-T1 concurrent-claim-and-fence", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "applied-loop-a2-cg2-"));
  const databasePath = join(fixtureRoot, "concurrency.db");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    stdio: "pipe",
  });
  const client = makeClient(databasePath);

  async function enqueueDue(maxAttempts = 3) {
    const queue = createLoopJobQueue({ client, registry, clock: clockAt(BASE_NOW), randomBytes: entropy(10) });
    const result = await queue.enqueue({ kind: "fence_probe", payload, maxAttempts });
    assert.equal(result.ok, true);
    return result.ok ? result.job : assert.fail("enqueue failed");
  }

  try {
    await t.test("independent processes atomically claim one due row", async () => {
      await client.loopJob.deleteMany();
      await enqueueDue();
      const env = {
        LOOP_JOB_TEST_ACTION: "claim",
        LOOP_JOB_TEST_NOW: BASE_NOW.toISOString(),
        LOOP_JOB_TEST_LEASE_MS: "1000",
      };
      const [left, right] = await synchronizedHelpers(
        startHelper(databasePath, { ...env, LOOP_JOB_TEST_SEED: "40" }),
        startHelper(databasePath, { ...env, LOOP_JOB_TEST_SEED: "80" }),
      );
      const winners = [left, right].filter((result) => result.code === "claimed");
      const losers = [left, right].filter((result) => result.code === "no_job");
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      const stored = await client.loopJob.findFirstOrThrow();
      assert.equal(stored.status, "running");
      assert.equal(stored.attempts, 1);
      assert.equal(stored.leaseToken, winners[0].leaseToken);
      assert.equal(stored.lockedBy, winners[0].lockedBy);
    });

    await t.test("renewal boundary and old-owner fencing after recovery/reclaim", async () => {
      await client.loopJob.deleteMany();
      await enqueueDue();
      const claimed = await createLoopJobQueue({
        client,
        registry,
        clock: clockAt(BASE_NOW),
        randomBytes: entropy(100),
      }).claim({ leaseDurationMs: 1_000 });
      assert.equal(claimed.code, "claimed");
      if (claimed.code !== "claimed") return;
      const oldToken = claimed.job.leaseToken!;

      const beforeExpiry = new Date(BASE_NOW.getTime() + 999);
      const renewed = await createLoopJobQueue({
        client,
        registry,
        clock: clockAt(beforeExpiry),
        randomBytes: entropy(120),
      }).renew({ jobId: claimed.job.id, leaseToken: oldToken, leaseDurationMs: 2_000 });
      assert.deepEqual(renewed, {
        ok: true,
        leaseExpiresAt: new Date(beforeExpiry.getTime() + 2_000),
      });

      const exactExpiry = new Date(beforeExpiry.getTime() + 2_000);
      const expiryQueue = createLoopJobQueue({
        client,
        registry,
        clock: clockAt(exactExpiry),
        randomBytes: entropy(140),
      });
      assert.deepEqual(
        await expiryQueue.renew({ jobId: claimed.job.id, leaseToken: oldToken, leaseDurationMs: 1_000 }),
        { ok: false, code: "lease_lost" },
      );
      const recovered = await expiryQueue.recoverExpired();
      assert.equal(recovered.ok, true);
      assert.equal(recovered.ok ? recovered.recovered : false, true);
      const afterRecovery = await client.loopJob.findUniqueOrThrow({ where: { id: claimed.job.id } });
      assert.equal(afterRecovery.status, "retry_wait");
      assert.equal(afterRecovery.attempts, 1);
      assert.equal(afterRecovery.availableAt.getTime(), exactExpiry.getTime());

      const reclaimed = await expiryQueue.claim({ leaseDurationMs: 1_000 });
      assert.equal(reclaimed.code, "claimed");
      if (reclaimed.code !== "claimed") return;
      assert.equal(reclaimed.job.attempts, 2);
      assert.notEqual(reclaimed.job.leaseToken, oldToken);
      assert.deepEqual(
        await expiryQueue.succeedOwned({ jobId: claimed.job.id, leaseToken: oldToken }),
        { ok: false, code: "lease_lost" },
      );
      assert.deepEqual(
        await expiryQueue.failOwned({
          jobId: claimed.job.id,
          leaseToken: oldToken,
          lastError: "handler_failed",
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          jitterEntropy: 0,
        }),
        { ok: false, code: "lease_lost" },
      );
      assert.deepEqual(
        await expiryQueue.renew({ jobId: claimed.job.id, leaseToken: oldToken, leaseDurationMs: 1_000 }),
        { ok: false, code: "lease_lost" },
      );
      assert.deepEqual(
        await expiryQueue.succeedOwned({ jobId: claimed.job.id, leaseToken: reclaimed.job.leaseToken! }),
        { ok: true },
      );
    });

    await t.test("synchronized renewal versus recovery has one state-consistent winner", async () => {
      await client.loopJob.deleteMany();
      await enqueueDue();
      const initial = await createLoopJobQueue({
        client,
        registry,
        clock: clockAt(BASE_NOW),
        randomBytes: entropy(160),
      }).claim({ leaseDurationMs: 1_000 });
      assert.equal(initial.code, "claimed");
      if (initial.code !== "claimed") return;
      const token = initial.job.leaseToken!;
      const originalExpiry = new Date(BASE_NOW.getTime() + 1_000);
      const [renewResult, recoverResult] = await synchronizedHelpers(
        startHelper(databasePath, {
          LOOP_JOB_TEST_ACTION: "renew",
          LOOP_JOB_TEST_NOW: new Date(originalExpiry.getTime() - 1).toISOString(),
          LOOP_JOB_TEST_JOB_ID: initial.job.id,
          LOOP_JOB_TEST_LEASE_TOKEN: token,
          LOOP_JOB_TEST_LEASE_MS: "5000",
          LOOP_JOB_TEST_SEED: "180",
        }),
        startHelper(databasePath, {
          LOOP_JOB_TEST_ACTION: "recover",
          LOOP_JOB_TEST_NOW: originalExpiry.toISOString(),
          LOOP_JOB_TEST_SEED: "200",
        }),
      );
      const renewWon = renewResult.ok === true;
      const recoveryWon = recoverResult.ok === true && recoverResult.recovered === true;
      assert.equal(Number(renewWon) + Number(recoveryWon), 1);
      const stored = await client.loopJob.findUniqueOrThrow({ where: { id: initial.job.id } });
      if (renewWon) {
        assert.equal(recoverResult.recovered, false);
        assert.equal(stored.status, "running");
        assert.equal(stored.leaseToken, token);
        assert.equal(stored.leaseExpiresAt?.toISOString(), renewResult.leaseExpiresAt);
      } else {
        assert.equal(renewResult.code, "lease_lost");
        assert.equal(stored.status, "retry_wait");
        assert.equal(stored.leaseToken, null);
        assert.equal(stored.attempts, 1);
      }
    });

    await t.test("SQLite busy is bounded and normalized without retry or sleep", async () => {
      await client.loopJob.deleteMany();
      await enqueueDue();
      const adapterRequire = createRequire(require.resolve("@prisma/adapter-better-sqlite3"));
      type Locker = { exec: (sql: string) => void; close: () => void };
      const Database = adapterRequire("better-sqlite3") as new (
        path: string,
        options: { fileMustExist: boolean; timeout: number },
      ) => Locker;
      const locker = new Database(databasePath, { fileMustExist: true, timeout: 25 });
      const boundedClient = makeClient(databasePath, 25);
      try {
        locker.exec("BEGIN EXCLUSIVE");
        const started = performance.now();
        const result = await createLoopJobQueue({
          client: boundedClient,
          registry,
          clock: clockAt(BASE_NOW),
          randomBytes: entropy(220),
        }).claim({ leaseDurationMs: 1_000 });
        const elapsedMs = performance.now() - started;
        assert.deepEqual(result, { code: "storage_failure" });
        assert.ok(elapsedMs < 1_000, `busy handling exceeded bound: ${String(elapsedMs)}ms`);
      } finally {
        locker.exec("ROLLBACK");
        locker.close();
        await boundedClient.$disconnect();
      }

      let rawCalls = 0;
      const oneAttemptClient = {
        $queryRaw: async () => {
          rawCalls += 1;
          throw new Error("SQLITE_BUSY secret path must not echo");
        },
        loopJob: {},
      } as unknown as LoopJobClient;
      assert.deepEqual(
        await createLoopJobQueue({
          client: oneAttemptClient,
          registry,
          clock: clockAt(BASE_NOW),
          randomBytes: entropy(240),
        }).claim({ leaseDurationMs: 1_000 }),
        { code: "storage_failure" },
      );
      assert.equal(rawCalls, 1);
    });
  } finally {
    await client.$disconnect();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
