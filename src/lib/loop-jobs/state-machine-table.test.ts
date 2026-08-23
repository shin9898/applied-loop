import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

import {
  canonicalJson,
  createLoopJobQueue,
  defineLoopJobRegistry,
  deterministicBackoffMs,
  type LoopJobClient,
} from "./state-machine";

const FIXED_NOW = new Date("2026-08-22T01:02:03.456Z");

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

const registry = defineLoopJobRegistry({
  state_probe: {
    version: "v1",
    fields: {
      entityId: { type: "opaque_id", prefix: "entity" },
      operation: { type: "enum", values: ["inspect", "reconcile"] as const },
      artifactHash: { type: "hash" },
    },
    dedupeFields: ["entityId", "operation"] as const,
  },
});

const validPayload = {
  operation: "inspect",
  artifactHash: "a".repeat(64),
  entityId: `entity_${"b".repeat(32)}`,
};

function makeClient(databasePath: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3(
    { url: databasePath, fileMustExist: true },
    { timestampFormat: "iso8601" },
  );
  return new PrismaClient({ adapter });
}

test("A2-CG1-T1 state-machine-table", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "applied-loop-a2-cg1-"));
  const databasePath = join(fixtureRoot, "state table.db");
  const fixtureUrl = `file:${databasePath}`;

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: fixtureUrl },
    stdio: "pipe",
  });
  const client = makeClient(databasePath);
  const clients = [client];

  try {
    await t.test("canonical payload, strict registry, derived identity, and no free-form dedupe", async () => {
      assert.equal(canonicalJson({ z: [3, { b: 2, a: 1 }], a: true }), '{"a":true,"z":[3,{"a":1,"b":2}]}');

      const queue = createLoopJobQueue({
        client,
        registry,
        clock: clockAt(FIXED_NOW),
        randomBytes: entropy(0),
      });
      const first = await queue.enqueue({
        kind: "state_probe",
        payload: validPayload,
        maxAttempts: 3,
      });
      assert.equal(first.ok, true);
      assert.match(first.ok ? first.job.id : "", /^job_[0-9a-f]{32}$/);
      assert.match(first.ok ? first.job.payloadHash : "", /^[0-9a-f]{64}$/);
      assert.match(first.ok ? first.job.dedupeKey : "", /^state_probe:v1:[0-9a-f]{64}$/);
      assert.equal(first.ok ? first.job.payloadJson : "", canonicalJson(validPayload));
      assert.deepEqual(first.ok ? first.job.createdAt : null, FIXED_NOW);
      assert.deepEqual(first.ok ? first.job.updatedAt : null, FIXED_NOW);
      assert.deepEqual(first.ok ? first.job.availableAt : null, FIXED_NOW);

      for (const payload of [
        { ...validPayload, secret: "sk-do-not-store" },
        { ...validPayload, entityId: "free form customer text" },
        { ...validPayload, artifactHash: "not-a-hash" },
        { ...validPayload, operation: "https://secret.example/token" },
        { ...validPayload, command: "curl -H Authorization:token" },
        { ...validPayload, nested: { answer: "secret" } },
        { ...validPayload, values: ["secret"] },
      ]) {
        assert.deepEqual(await queue.enqueue({ kind: "state_probe", payload, maxAttempts: 3 }), {
          ok: false,
          code: "invalid_payload",
        });
      }
      assert.deepEqual(
        await queue.enqueue({
          kind: "unknown_kind",
          payload: validPayload,
          maxAttempts: 3,
        }),
        { ok: false, code: "invalid_payload" },
      );
      assert.deepEqual(
        await queue.enqueue({
          kind: "state_probe",
          payload: validPayload,
          maxAttempts: 3,
          dedupeKey: "free-form-secret-bearing-key",
        } as never),
        { ok: false, code: "invalid_payload" },
      );
      assert.equal(await client.loopJob.count(), 1);
    });

    await t.test("create-first targeted P2002 and untouched duplicate/conflict semantics", async () => {
      const row = await client.loopJob.findFirstOrThrow();
      const originalTimestamps = [row.createdAt.getTime(), row.updatedAt.getTime()];
      const laterQueue = createLoopJobQueue({
        client,
        registry,
        clock: clockAt(new Date(FIXED_NOW.getTime() + 60_000)),
        randomBytes: entropy(90),
      });

      const duplicate = await laterQueue.enqueue({ kind: "state_probe", payload: validPayload, maxAttempts: 9 });
      assert.equal(duplicate.ok, true);
      assert.equal(duplicate.ok ? duplicate.created : true, false);
      assert.equal(duplicate.ok ? duplicate.job.id : "", row.id);

      const conflict = await laterQueue.enqueue({
        kind: "state_probe",
        payload: { ...validPayload, artifactHash: "c".repeat(64) },
        maxAttempts: 9,
      });
      assert.deepEqual(conflict, { ok: false, code: "dedupe_payload_conflict" });
      const untouched = await client.loopJob.findUniqueOrThrow({ where: { id: row.id } });
      assert.deepEqual([untouched.createdAt.getTime(), untouched.updatedAt.getTime()], originalTimestamps);
      assert.equal(untouched.maxAttempts, 3);
      assert.equal(untouched.payloadHash, row.payloadHash);
      assert.equal(await client.loopJob.count(), 1);

      let findCalls = 0;
      const nonTargetClient = {
        loopJob: {
          create: async () => {
            throw { code: "P2002", meta: { modelName: "LoopJob", target: ["id"] }, message: "must-not-echo" };
          },
          findUnique: async () => {
            findCalls += 1;
            return row;
          },
        },
      } as unknown as LoopJobClient;
      const nonTargetQueue = createLoopJobQueue({
        client: nonTargetClient,
        registry,
        clock: clockAt(FIXED_NOW),
        randomBytes: entropy(120),
      });
      assert.deepEqual(
        await nonTargetQueue.enqueue({ kind: "state_probe", payload: validPayload, maxAttempts: 3 }),
        { ok: false, code: "storage_failure" },
      );
      assert.equal(findCalls, 0);

      const missingWinnerClient = {
        loopJob: {
          create: async () => {
            throw { code: "P2002", meta: { modelName: "LoopJob", target: ["dedupeKey"] } };
          },
          findUnique: async () => null,
        },
      } as unknown as LoopJobClient;
      const missingWinnerQueue = createLoopJobQueue({
        client: missingWinnerClient,
        registry,
        clock: clockAt(FIXED_NOW),
        randomBytes: entropy(130),
      });
      assert.deepEqual(
        await missingWinnerQueue.enqueue({ kind: "state_probe", payload: validPayload, maxAttempts: 3 }),
        { ok: false, code: "storage_failure" },
      );

      const genericFailureClient = {
        loopJob: {
          create: async () => {
            throw new Error("secret storage path and payload must not echo");
          },
          findUnique: async () => row,
        },
      } as unknown as LoopJobClient;
      const genericFailureQueue = createLoopJobQueue({
        client: genericFailureClient,
        registry,
        clock: clockAt(FIXED_NOW),
        randomBytes: entropy(140),
      });
      assert.deepEqual(
        await genericFailureQueue.enqueue({ kind: "state_probe", payload: validPayload, maxAttempts: 3 }),
        { ok: false, code: "storage_failure" },
      );
    });

    await t.test("sequential claim ordering, attempts, exact Date storage, fixed backoff, and terminal retention", async () => {
      await client.loopJob.deleteMany();
      const queue = createLoopJobQueue({ client, registry, clock: clockAt(FIXED_NOW), randomBytes: entropy(160) });
      const before = new Date(FIXED_NOW.getTime() - 1);
      const equal = new Date(FIXED_NOW);
      const after = new Date(FIXED_NOW.getTime() + 1);
      for (const [entityByte, availableAt] of [
        ["1", before],
        ["2", equal],
        ["3", after],
      ] as const) {
        const result = await queue.enqueue({
          kind: "state_probe",
          payload: { ...validPayload, entityId: `entity_${entityByte.repeat(32)}` },
          maxAttempts: 2,
          availableAt,
        });
        assert.equal(result.ok, true);
      }

      const backingRows = await client.$queryRaw<
        Array<{ availableAtQuoted: string; availableAtType: string; createdAtQuoted: string; updatedAtQuoted: string }>
      >`
        SELECT quote("availableAt") AS "availableAtQuoted",
               typeof("availableAt") AS "availableAtType",
               quote("createdAt") AS "createdAtQuoted",
               quote("updatedAt") AS "updatedAtQuoted"
        FROM "LoopJob"
        ORDER BY "availableAt"
      `;
      assert.deepEqual(
        backingRows.map((row) => row.availableAtQuoted),
        [before, equal, after].map((date) => `'${date.toISOString().replace("Z", "+00:00")}'`),
      );
      for (const row of backingRows) {
        assert.equal(row.availableAtType, "text");
        assert.match(row.createdAtQuoted, /^'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00'$/);
        assert.match(row.updatedAtQuoted, /^'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00'$/);
      }

      const claimedBefore = await queue.claim({ leaseDurationMs: 30_000 });
      assert.equal(claimedBefore.code, "claimed");
      assert.equal(claimedBefore.code === "claimed" ? claimedBefore.job.attempts : 0, 1);
      assert.match(claimedBefore.code === "claimed" ? claimedBefore.job.lockedBy! : "", /^worker_[0-9a-f]{32}$/);
      assert.match(claimedBefore.code === "claimed" ? claimedBefore.job.leaseToken! : "", /^[0-9a-f]{64}$/);
      const claimedEqual = await queue.claim({ leaseDurationMs: 30_000 });
      assert.equal(claimedEqual.code, "claimed");
      assert.equal(claimedEqual.code === "claimed" ? claimedEqual.job.attempts : 0, 1);
      assert.deepEqual(await queue.claim({ leaseDurationMs: 30_000 }), {
        code: "no_job",
      });
      const notDue = await client.loopJob.findFirstOrThrow({ where: { availableAt: after } });
      assert.equal(notDue.attempts, 0);

      assert.equal(deterministicBackoffMs({ attempts: 1, baseDelayMs: 1_000, maxDelayMs: 60_000, entropy: 0 }), 500);
      assert.equal(deterministicBackoffMs({ attempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, entropy: 0.25 }), 3_000);
      assert.equal(deterministicBackoffMs({ attempts: 40, baseDelayMs: 1_000, maxDelayMs: 60_000, entropy: 0.999 }), 89_940);

      assert.equal(claimedBefore.code, "claimed");
      if (claimedBefore.code === "claimed") {
        assert.deepEqual(
          await queue.succeedOwned({ jobId: claimedBefore.job.id, leaseToken: claimedBefore.job.leaseToken! }),
          { ok: true },
        );
        assert.deepEqual(
          await queue.succeedOwned({ jobId: claimedBefore.job.id, leaseToken: claimedBefore.job.leaseToken! }),
          { ok: false, code: "lease_lost" },
        );
      }
      assert.equal(claimedEqual.code, "claimed");
      if (claimedEqual.code === "claimed") {
        assert.deepEqual(
          await queue.failOwned({
            jobId: claimedEqual.job.id,
            leaseToken: claimedEqual.job.leaseToken!,
            lastError: "handler_failed",
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            jitterEntropy: 0,
          }),
          { ok: true, code: "retry_scheduled", availableAt: new Date(FIXED_NOW.getTime() + 500) },
        );
      }
      const terminal = await client.loopJob.findMany({ where: { status: "succeeded" } });
      assert.equal(terminal.length, 1);
      assert.equal(terminal.every((row) => row.finishedAt !== null), true);
      assert.equal(terminal.every((row) => row.lockedAt === null && row.leaseExpiresAt === null && row.lockedBy === null && row.leaseToken === null), true);

      const finalAttempt = await queue.enqueue({
        kind: "state_probe",
        payload: { ...validPayload, entityId: `entity_${"4".repeat(32)}` },
        maxAttempts: 1,
      });
      assert.equal(finalAttempt.ok, true);
      const finalClaim = await queue.claim({ leaseDurationMs: 30_000 });
      assert.equal(finalClaim.code, "claimed");
      if (finalClaim.code === "claimed") {
        assert.deepEqual(
          await queue.failOwned({
            jobId: finalClaim.job.id,
            leaseToken: finalClaim.job.leaseToken!,
            lastError: "handler_failed",
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            jitterEntropy: 0,
          }),
          { ok: true, code: "dead" },
        );
      }
      const retainedDead = await client.loopJob.findMany({ where: { status: "dead" } });
      assert.equal(retainedDead.length, 1);
      assert.equal(retainedDead[0].finishedAt?.getTime(), FIXED_NOW.getTime());
      assert.equal(retainedDead[0].lastError, "handler_failed");
      assert.deepEqual(await queue.claim({ leaseDurationMs: 30_000 }), {
        code: "no_job",
      });
      assert.equal(await client.loopJob.count(), 4);
    });

    await t.test("database CHECKs reject every illegal direct row shape", async () => {
      const base = {
        id: `job_${"1".repeat(32)}`,
        kind: "state_probe",
        dedupeKey: `state_probe:v1:${"2".repeat(64)}`,
        payloadJson: canonicalJson(validPayload),
        payloadHash: "3".repeat(64),
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        availableAt: FIXED_NOW,
        lockedAt: null,
        leaseExpiresAt: null,
        lockedBy: null,
        leaseToken: null,
        lastError: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        finishedAt: null,
      };
      const invalidRows = [
        { ...base, status: "invented" },
        { ...base, attempts: -1 },
        { ...base, attempts: 4 },
        { ...base, maxAttempts: 0 },
        { ...base, status: "running" },
        { ...base, lockedAt: FIXED_NOW },
        { ...base, status: "running", lockedAt: FIXED_NOW, leaseExpiresAt: FIXED_NOW, lockedBy: `worker_${"4".repeat(32)}`, leaseToken: "5".repeat(64) },
        { ...base, status: "succeeded" },
        { ...base, status: "queued", finishedAt: FIXED_NOW },
        { ...base, lastError: "secret database message" },
        { ...base, id: "caller-controlled" },
        { ...base, payloadHash: "short" },
      ];
      for (const [index, row] of invalidRows.entries()) {
        await assert.rejects(
          client.loopJob.create({ data: { ...row, dedupeKey: `${row.dedupeKey}-${index}` } }),
          /constraint failed/i,
        );
      }
    });

    await t.test("synchronized separate-process clients preserve same/different-hash enqueue races", async () => {
      await client.loopJob.deleteMany();

      type RaceResult = { ok: true; created: boolean } | { ok: false; code: string };
      type RaceChild = {
        process: ChildProcess;
        ready: Promise<void>;
        result: Promise<RaceResult>;
        exited: Promise<void>;
      };

      function startRaceChild(hashCharacter: string, seed: number): RaceChild {
        const child = fork(join(process.cwd(), "src/lib/loop-jobs/state-machine-race-helper.ts"), [], {
          execArgv: ["--import", "tsx"],
          env: {
            ...process.env,
            LOOP_JOB_TEST_DATABASE_PATH: databasePath,
            LOOP_JOB_TEST_HASH_CHARACTER: hashCharacter,
            LOOP_JOB_TEST_ENTROPY_SEED: String(seed),
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        let markReady!: () => void;
        let resolveResult!: (result: RaceResult) => void;
        let rejectReady!: (error: Error) => void;
        let rejectResult!: (error: Error) => void;
        const ready = new Promise<void>((resolve, reject) => { markReady = resolve; rejectReady = reject; });
        const result = new Promise<RaceResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
        const stderr: string[] = [];
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
        child.on("message", (message: unknown) => {
          if (typeof message !== "object" || message === null) return;
          if ((message as { type?: string }).type === "ready") markReady();
          if ((message as { type?: string }).type === "result") {
            resolveResult((message as { result: RaceResult }).result);
          }
        });
        const exited = new Promise<void>((resolve, reject) => {
          child.once("error", (error) => { rejectReady(error); rejectResult(error); reject(error); });
          child.once("exit", (code) => {
            if (code === 0) resolve();
            else {
              const error = new Error(`race helper failed with code ${String(code)}; stderr-bytes=${stderr.join("").length}`);
              rejectReady(error);
              rejectResult(error);
              reject(error);
            }
          });
        });
        return { process: child, ready, result, exited };
      }

      async function race(leftHash: string, rightHash: string): Promise<[RaceResult, RaceResult]> {
        const left = startRaceChild(leftHash, 200);
        const right = startRaceChild(rightHash, 220);
        await Promise.all([left.ready, right.ready]);
        left.process.send?.({ type: "go" });
        right.process.send?.({ type: "go" });
        const results = await Promise.all([left.result, right.result]);
        await Promise.all([left.exited, right.exited]);
        return results;
      }

      const same = await race("a", "a");
      assert.equal(same.every((result) => result.ok), true);
      assert.equal(await client.loopJob.count(), 1);
      const winnerBefore = await client.loopJob.findFirstOrThrow();

      await client.loopJob.deleteMany();
      const different = await race("a", "f");
      assert.equal(different.filter((result) => result.ok).length, 1);
      assert.deepEqual(different.find((result) => !result.ok), { ok: false, code: "dedupe_payload_conflict" });
      assert.equal(await client.loopJob.count(), 1);

      // Same-hash duplicate did not mutate the winner even though both contexts used different IDs.
      assert.equal(winnerBefore.attempts, 0);
      assert.deepEqual(winnerBefore.createdAt, FIXED_NOW);
      assert.deepEqual(winnerBefore.updatedAt, FIXED_NOW);
    });
  } finally {
    await Promise.all(clients.map((entry) => entry.$disconnect()));
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
