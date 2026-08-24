import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../../generated/prisma/client";
import type { HCycleEvidenceSnapshotV1 } from "../../h-cycle-evidence-adapter";
import { persistHCycleEvaluationRecordV1 } from "../../h-cycle-evaluation-record";
import { runOneDelivery, type LoopJobHandler } from "../delivery";
import {
  createHCycleEvaluateDormantHandlerV1,
} from "./h-cycle-evaluate-dormant-handler-v1";
import {
  createHCycleEvaluatePayloadV1,
  H_CYCLE_EVALUATE_JOB_REGISTRY,
} from "./h-cycle-evaluate-job-contract-v1";
import { createLoopJobQueue } from "../state-machine";

const ON_TIME = new Date("2026-08-16T23:15:02.000Z");

function emptySnapshot(): HCycleEvidenceSnapshotV1 {
  return {
    sourceRevisions: [],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  };
}

function snapshotWithRawLookingValues(): HCycleEvidenceSnapshotV1 {
  return {
    ...emptySnapshot(),
    sourceRevisions: [
      {
        sourceKind: "daily",
        textbookKey: "source-secret-must-not-persist",
        source: "auto",
        checkIndex: 0,
        sourceRevisionHash: "a".repeat(64),
        firstObservedAt: new Date("2026-08-10T00:00:00.000Z"),
        masteryEvents: [],
      },
    ],
  };
}

function clockAt(instant: Date) {
  return {
    now: () => new Date(instant),
    addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
    fromStorage: (value: string) => new Date(value),
  };
}

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

function payload(targetWeekKey = "2026-W33") {
  const result = createHCycleEvaluatePayloadV1({ targetWeekKey });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("payload builder rejected a valid fixture");
  return result.payload;
}

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a8b2-handler-"));
  const databasePath = join(directory, "fixture.db");
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: "/dev/null",
        DATABASE_URL: "file:" + databasePath,
      },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    try {
      return await run(client);
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function handlerFor(
  client: PrismaClient,
  now: Date,
  snapshot: HCycleEvidenceSnapshotV1,
  observed?: { readCount: number },
): LoopJobHandler {
  return createHCycleEvaluateDormantHandlerV1({
    now: () => new Date(now),
    readSnapshot: async () => {
      if (observed) observed.readCount += 1;
      return snapshot;
    },
    persistRecord: (input) => persistHCycleEvaluationRecordV1({ client, ...input }),
  });
}

test("A8B2-CG3-T1 dormant handler derives periods, writes only aggregate record, and fails closed before due", async () => {
  await withFixture(async (client) => {
    const observed = { readCount: 0 };
    const handler = handlerFor(client, ON_TIME, snapshotWithRawLookingValues(), observed);
    await handler.handle({ idempotencyKey: "job_" + "1".repeat(32), payload: payload() });
    assert.equal(observed.readCount, 1);

    const saved = await client.hCycleEvaluationRecord.findUniqueOrThrow({
      where: {
        recordSchema_policyVersion_projectionSchemaVersion_targetWeekKey: {
          recordSchema: "h_cycle_evaluation_record_v1",
          policyVersion: "h_cycle_evidence_v1",
          projectionSchemaVersion: "h_cycle_evidence_preview_v1",
          targetWeekKey: "2026-W33",
        },
      },
    });
    assert.equal(saved.previousWeekKey, "2026-W32");
    assert.equal(saved.scheduledFor.toISOString(), "2026-08-16T23:15:00.000Z");
    assert.equal(saved.evaluatedAt.toISOString(), ON_TIME.toISOString());
    assert.equal(saved.triggerKind, "scheduled");
    assert.equal(saved.timeliness, "on_time");
    assert.doesNotMatch(saved.aggregateEnvelopeJson, /source-secret-must-not-persist/);
    assert.doesNotMatch(saved.aggregateEnvelopeJson, /a{64}/);

    const mismatched = handlerFor(client, ON_TIME, emptySnapshot());
    await assert.rejects(
      () => mismatched.handle({ idempotencyKey: "job_" + "2".repeat(32), payload: payload() }),
      /evaluation_record_integrity_failure/,
    );
    assert.equal(await client.hCycleEvaluationRecord.count(), 1);

    const beforeDueReads = { readCount: 0 };
    const beforeDue = handlerFor(
      client,
      new Date("2026-08-16T23:14:59.999Z"),
      emptySnapshot(),
      beforeDueReads,
    );
    await assert.rejects(
      () => beforeDue.handle({ idempotencyKey: "job_" + "3".repeat(32), payload: payload() }),
      /week_not_due/,
    );
    assert.equal(beforeDueReads.readCount, 0);
  });
});

test("A8B2-CG3-T2 temporary SQLite crash retry and stale lease recovery preserve one record", async () => {
  await withFixture(async (client) => {
    const crashQueue = createLoopJobQueue({
      client,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      clock: clockAt(ON_TIME),
      randomBytes: entropy(1),
    });
    const enqueued = await crashQueue.enqueue({
      kind: "h_cycle_evaluate",
      payload: payload(),
      maxAttempts: 3,
    });
    assert.equal(enqueued.ok, true);
    if (!enqueued.ok) return;

    const durable = handlerFor(client, ON_TIME, emptySnapshot());
    let crashAfterRecord = true;
    const crashAfterWrite: LoopJobHandler = {
      idempotencyKey: "job_id",
      async handle(context) {
        await durable.handle(context);
        if (crashAfterRecord) {
          crashAfterRecord = false;
          throw new Error("simulated_crash_after_record_write");
        }
      },
    };
    const first = await runOneDelivery({
      queue: crashQueue,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      handlers: { h_cycle_evaluate: crashAfterWrite },
      leaseDurationMs: 1_000,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterEntropy: 0.5,
    });
    assert.deepEqual(first, { ok: true, code: "job_retry_scheduled" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 1);

    const second = await runOneDelivery({
      queue: crashQueue,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      handlers: { h_cycle_evaluate: durable },
      leaseDurationMs: 1_000,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterEntropy: 0.5,
    });
    assert.deepEqual(second, { ok: true, code: "job_succeeded" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 1);
    const completed = await client.loopJob.findUniqueOrThrow({ where: { id: enqueued.job.id } });
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.attempts, 2);

    const staleAt = new Date("2026-08-23T23:15:02.000Z");
    const staleQueue = createLoopJobQueue({
      client,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      clock: clockAt(staleAt),
      randomBytes: entropy(100),
    });
    const staleEnqueue = await staleQueue.enqueue({
      kind: "h_cycle_evaluate",
      payload: payload("2026-W34"),
      maxAttempts: 3,
    });
    assert.equal(staleEnqueue.ok, true);
    if (!staleEnqueue.ok) return;
    const claimed = await staleQueue.claim({ leaseDurationMs: 1 });
    assert.equal(claimed.code, "claimed");

    const recoveredAt = new Date(staleAt.getTime() + 1);
    const recoveryQueue = createLoopJobQueue({
      client,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      clock: clockAt(recoveredAt),
      randomBytes: entropy(200),
    });
    const recovered = await recoveryQueue.recoverExpired();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.ok ? recovered.recovered : false, true);
    const recovery = await runOneDelivery({
      queue: recoveryQueue,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      handlers: { h_cycle_evaluate: handlerFor(client, recoveredAt, emptySnapshot()) },
      leaseDurationMs: 1_000,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterEntropy: 0.5,
    });
    assert.deepEqual(recovery, { ok: true, code: "job_succeeded" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 2);
    const staleCompleted = await client.loopJob.findUniqueOrThrow({ where: { id: staleEnqueue.job.id } });
    assert.equal(staleCompleted.status, "succeeded");
    assert.equal(staleCompleted.attempts, 2);
    assert.equal(staleCompleted.lastError, "lease_expired");
  });
});
