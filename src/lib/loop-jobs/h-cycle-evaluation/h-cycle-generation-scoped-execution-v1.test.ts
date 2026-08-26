import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../../generated/prisma/client";
import { buildHCycleEvidencePreviewV1 } from "../../h-cycle-evidence-preview";
import { persistHCycleEvaluationRecordV1 } from "../../h-cycle-evaluation-record";
import { appendHCycleActivationEventV1 } from "./h-cycle-activation-control-ledger-v1";
import {
  createHCycleGenerationScopedExecutionV1,
  type HCycleGenerationScopedImmediateRunnerV1,
  type HCycleGenerationScopedSqliteConnectionV1,
} from "./h-cycle-generation-scoped-execution-v1";
import {
  createHCycleEvaluatePayloadV1,
  H_CYCLE_EVALUATE_JOB_REGISTRY,
} from "./h-cycle-evaluate-job-contract-v1";
import { deriveHCycleEvaluateTimingV1 } from "./h-cycle-evaluate-planner-v1";
import {
  runHCycleSqliteImmediateWriteTransactionV1,
  type HCycleSqliteImmediateWriteConnectionV1,
} from "./h-cycle-sqlite-immediate-write-transaction-v1";
import { runOneDelivery, runOneKindDelivery } from "../delivery";
import {
  canonicalJson,
  createLoopJobQueue,
  type LoopJobQueue,
} from "../state-machine";

const ROOT_NOW = new Date("2026-08-24T00:00:00.000Z");
const H_CYCLE_KIND = "h_cycle_evaluate";
const resolveFromTest = createRequire(import.meta.url);

type DataRecord = Record<string, unknown>;
type DirectStatement = Readonly<{
  all: (parameters?: Readonly<Record<string, unknown>>) => readonly DataRecord[];
  run: (parameters?: Readonly<Record<string, unknown>>) => unknown;
}>;
type DirectConnection = HCycleSqliteImmediateWriteConnectionV1 & HCycleGenerationScopedSqliteConnectionV1 & Readonly<{
  pragma: (source: string, options?: Readonly<{ simple: boolean }>) => unknown;
  prepare: (source: string) => DirectStatement;
  close: () => void;
}>;
type DirectDatabaseConstructor = new (
  databasePath: string,
  options: Readonly<{ fileMustExist: boolean; timeout: number }>,
) => DirectConnection;

type Fixture = Readonly<{
  directory: string;
  databasePath: string;
}>;

function loadDirectDatabaseConstructor(): DirectDatabaseConstructor {
  const adapterEntry = resolveFromTest.resolve("@prisma/adapter-better-sqlite3");
  const requireFromAdapter = createRequire(adapterEntry);
  const nestedDriverEntry = requireFromAdapter.resolve("better-sqlite3");
  const rootDriverEntry = resolveFromTest.resolve("better-sqlite3");
  const adapterRoot = dirname(dirname(adapterEntry));
  const nestedRoot = join(adapterRoot, "node_modules", "better-sqlite3");
  const nestedRelativePath = relative(nestedRoot, nestedDriverEntry);
  assert.equal(nestedRelativePath === "" || nestedRelativePath.startsWith(".."), false);
  assert.notEqual(nestedDriverEntry, rootDriverEntry);
  return requireFromAdapter("better-sqlite3") as DirectDatabaseConstructor;
}

async function withFixture<T>(run: (fixture: Fixture, client: PrismaClient, direct: DirectConnection) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a8c3b-"));
  const databasePath = join(directory, "fixture.db");
  const dotenvConfigPath = join(directory, "dotenv-never-exists");
  const prismaCliEntry = resolveFromTest.resolve("prisma/build/index.js");
  const Database = loadDirectDatabaseConstructor();
  try {
    const migration = spawnSync(
      process.execPath,
      [prismaCliEntry, "migrate", "deploy", "--schema", join(process.cwd(), "prisma", "schema.prisma")],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${databasePath}`, DOTENV_CONFIG_PATH: dotenvConfigPath },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    assert.equal(migration.error, undefined, "temporary fixture migration must start");
    assert.equal(migration.status, 0, migration.stderr);
    assert.equal(lstatSync(databasePath).isFile(), true);

    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    const direct = new Database(databasePath, { fileMustExist: true, timeout: 250 });
    direct.pragma("foreign_keys = ON");
    assert.equal(direct.pragma("foreign_keys", { simple: true }), 1);
    try {
      return await run(Object.freeze({ directory, databasePath }), client, direct);
    } finally {
      try {
        direct.close();
      } finally {
        await client.$disconnect();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

function hCyclePayload(targetWeekKey: string) {
  const result = createHCycleEvaluatePayloadV1({ targetWeekKey });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("valid fixture target must construct a payload");
  return result.payload;
}

function hCyclePayloadJson(targetWeekKey: string) {
  const payloadJson = canonicalJson(hCyclePayload(targetWeekKey));
  return Object.freeze({
    payloadJson,
    payloadHash: createHash("sha256").update(payloadJson, "utf8").digest("hex"),
  });
}

function evaluationFor(targetWeekKey: string, evaluatedAt: Date) {
  const timing = deriveHCycleEvaluateTimingV1({ targetWeekKey, evaluatedAt });
  assert.equal(timing.ok, true, "fixture target must be due");
  if (!timing.ok) assert.fail("fixture target must derive evaluation timing");
  const preview = buildHCycleEvidencePreviewV1({
    sourceRevisions: [],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  }, timing.timing.periods);
  return Object.freeze({
    preview,
    scheduledFor: timing.timing.scheduledFor,
    evaluatedAt: timing.timing.evaluatedAt,
    triggerKind: timing.timing.triggerKind,
    timeliness: timing.timing.timeliness,
  });
}

function conflictingEvaluationFor(targetWeekKey: string, evaluatedAt: Date) {
  const timing = deriveHCycleEvaluateTimingV1({ targetWeekKey, evaluatedAt });
  assert.equal(timing.ok, true, "fixture target must be due");
  if (!timing.ok) assert.fail("fixture target must derive evaluation timing");
  const observedAt = new Date(timing.timing.periods[1].start.getTime() + 60_000);
  const preview = buildHCycleEvidencePreviewV1({
    sourceRevisions: [{
      sourceKind: "daily",
      textbookKey: `fixture-${targetWeekKey}`,
      source: "auto",
      checkIndex: 1,
      sourceRevisionHash: "f".repeat(64),
      firstObservedAt: observedAt,
      masteryEvents: [{ mastery: "partial", recordedAt: new Date(observedAt.getTime() + 1_000) }],
    }],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  }, timing.timing.periods);
  return Object.freeze({
    preview,
    scheduledFor: timing.timing.scheduledFor,
    evaluatedAt: timing.timing.evaluatedAt,
    triggerKind: timing.timing.triggerKind,
    timeliness: timing.timing.timeliness,
  });
}

function immediateRunner(direct: DirectConnection): HCycleGenerationScopedImmediateRunnerV1 {
  return (operation) => runHCycleSqliteImmediateWriteTransactionV1(
    { connection: direct },
    (connection) => operation(connection as unknown as HCycleGenerationScopedSqliteConnectionV1),
  );
}

function directStatement(direct: DirectConnection, source: string): DirectStatement {
  return direct.prepare(source) as unknown as DirectStatement;
}

function exactResult(value: unknown, expected: Readonly<Record<string, unknown>>): void {
  assert.deepEqual(value, expected);
  assert.equal(Object.isFrozen(value as object), true);
  assert.doesNotMatch(JSON.stringify(value), /(?:fixture|database|sqlite|path|token|payload|generation|error|stack)/i);
}

function sqliteErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

async function appendRoot(client: PrismaClient, now: () => Date): Promise<number> {
  const result = await appendHCycleActivationEventV1(
    { client, clock: { now } },
    { schema: "h_cycle_activation_event_input_v1", eventKind: "packet_attested", activationFloorWeekKey: "2026-W35" },
  );
  assert.deepEqual(result, { ok: true, featureState: "off", created: true });
  const root = await client.hCycleActivationEvent.findFirstOrThrow({ orderBy: { sequence: "asc" } });
  return root.sequence;
}

async function appendDisable(client: PrismaClient, now: () => Date): Promise<void> {
  const result = await appendHCycleActivationEventV1(
    { client, clock: { now } },
    { schema: "h_cycle_activation_event_input_v1", eventKind: "disabled" },
  );
  assert.deepEqual(result, { ok: true, featureState: "off", created: true });
}

async function appendReenable(client: PrismaClient, now: () => Date, activationFloorWeekKey: string): Promise<number> {
  const result = await appendHCycleActivationEventV1(
    { client, clock: { now } },
    { schema: "h_cycle_activation_event_input_v1", eventKind: "re_enabled", activationFloorWeekKey },
  );
  assert.deepEqual(result, { ok: true, featureState: "off", created: true });
  const root = await client.hCycleActivationEvent.findFirstOrThrow({ orderBy: { sequence: "desc" } });
  return root.sequence;
}

async function insertHcycleFixtureJob(input: Readonly<{
  client: PrismaClient;
  id: string;
  dedupeKey: string;
  targetWeekKey: string;
  generationSequence: number | null;
  now: Date;
  payloadJson?: string;
  payloadHash?: string;
}>): Promise<void> {
  const canonical = hCyclePayloadJson(input.targetWeekKey);
  await input.client.loopJob.create({
    data: {
      id: input.id,
      kind: H_CYCLE_KIND,
      dedupeKey: input.dedupeKey,
      payloadJson: input.payloadJson ?? canonical.payloadJson,
      payloadHash: input.payloadHash ?? canonical.payloadHash,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      availableAt: input.now,
      lockedAt: null,
      leaseExpiresAt: null,
      lockedBy: null,
      leaseToken: null,
      lastError: null,
      createdAt: input.now,
      updatedAt: input.now,
      finishedAt: null,
      executionGenerationSequence: input.generationSequence,
    },
  });
}

test("A8C3B-CG1-T1 keeps H-CYCLE generation-scoped and generic queue paths inert", async () => {
  await withFixture(async (_fixture, client, direct) => {
    const loopJobSql = directStatement(
      direct,
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'LoopJob'`,
    ).all()[0];
    assert.equal(typeof loopJobSql?.sql, "string");
    assert.match(loopJobSql?.sql as string, /executionGenerationSequence/);
    assert.match(loopJobSql?.sql as string, /LoopJob_executionGenerationSequence_fkey/);
    assert.match(loopJobSql?.sql as string, /LoopJob_execution_generation_shape_check/);
    const indexRows = directStatement(direct, `
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'LoopJob' AND name NOT LIKE 'sqlite_autoindex%'
      ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(indexRows, [
      "LoopJob_dedupeKey_key",
      "LoopJob_kind_executionGenerationSequence_status_availableAt_idx",
      "LoopJob_kind_executionGenerationSequence_status_leaseExpiresAt_idx",
      "LoopJob_status_availableAt_idx",
      "LoopJob_status_leaseExpiresAt_idx",
    ]);

    assert.throws(() => directStatement(direct, `
      INSERT INTO "LoopJob" (
        "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
        "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
        "updatedAt", "finishedAt", "executionGenerationSequence"
      ) VALUES (
        'job_ffffffffffffffffffffffffffffffff', 'h_cycle_evaluate', 'fixture-invalid-generation', '{}',
        '${"a".repeat(64)}', 'queued', 0, 1, '2026-08-24T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL,
        '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', NULL, 999999
      )
    `).run(), (error: unknown) => sqliteErrorCode(error) === "SQLITE_CONSTRAINT_FOREIGNKEY");

    let now = new Date(ROOT_NOW);
    const rootSequence = await appendRoot(client, () => new Date(now));
    const scoped = createHCycleGenerationScopedExecutionV1({
      runImmediate: immediateRunner(direct),
      clock: { now: () => new Date(now) },
      randomBytes: entropy(1),
    });
    const generic = createLoopJobQueue({
      client,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      clock: {
        now: () => new Date(now),
        addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
        fromStorage: (value) => new Date(value),
      },
      randomBytes: entropy(100),
    });

    const beforeGenericEnqueue = await client.loopJob.count();
    const genericEnqueue = await generic.enqueue({
      kind: H_CYCLE_KIND,
      payload: hCyclePayload("2026-W35"),
      maxAttempts: 3,
      availableAt: new Date(now),
    });
    assert.deepEqual(genericEnqueue, { ok: false, code: "invalid_payload" });
    assert.equal(await client.loopJob.count(), beforeGenericEnqueue);

    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W35",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W35",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "already_enqueued" });

    const queued = await client.loopJob.findFirstOrThrow({ where: { kind: H_CYCLE_KIND } });
    assert.equal(queued.executionGenerationSequence, rootSequence);
    assert.match(queued.dedupeKey, new RegExp(`:g${rootSequence}$`));
    assert.deepEqual(await generic.claim({ leaseDurationMs: 1_000 }), { code: "no_job" });
    assert.deepEqual(await generic.claimKind({ kind: H_CYCLE_KIND, leaseDurationMs: 1_000 }), { code: "storage_failure" });
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: queued.id } })).status, "queued");

    const claim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 1_000 });
    assert.equal(claim.ok, true);
    assert.equal(claim.ok && claim.code, "claimed");
    if (!claim.ok || claim.code !== "claimed") assert.fail("scoped claim must receive the current-generation row");
    assert.deepEqual(Reflect.ownKeys(claim.capability), []);
    assert.equal(Object.getPrototypeOf(claim.capability), null);
    assert.equal(Object.isFrozen(claim.capability), true);
    assert.doesNotMatch(JSON.stringify(claim), /(?:generation|payload|token|fixture|database)/i);

    const running = await client.loopJob.findUniqueOrThrow({ where: { id: queued.id } });
    assert.equal(running.status, "running");
    assert.equal(running.executionGenerationSequence, rootSequence);
    assert.notEqual(running.leaseToken, null);
    if (running.leaseToken === null) assert.fail("scoped claim must retain its private lease only in storage");
    assert.deepEqual(
      await generic.renew({ jobId: running.id, leaseToken: running.leaseToken, leaseDurationMs: 1_000 }),
      { ok: false, code: "lease_lost" },
    );
    assert.deepEqual(
      await generic.succeedOwned({ jobId: running.id, leaseToken: running.leaseToken }),
      { ok: false, code: "lease_lost" },
    );
    assert.deepEqual(
      await generic.failOwned({
        jobId: running.id,
        leaseToken: running.leaseToken,
        lastError: "handler_failed",
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterEntropy: 0.5,
      }),
      { ok: false, code: "lease_lost" },
    );
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: running.id } })).status, "running");

    let genericMutationCalls = 0;
    const genericDelivery = await runOneDelivery({
      queue: {
        claim: async () => ({ code: "claimed" as const, job: running }),
        failOwned: async () => {
          genericMutationCalls += 1;
          return { ok: true as const, code: "retry_scheduled" as const, availableAt: new Date(now) };
        },
        succeedOwned: async () => {
          genericMutationCalls += 1;
          return { ok: true as const };
        },
      } as unknown as LoopJobQueue,
      registry: H_CYCLE_EVALUATE_JOB_REGISTRY,
      handlers: {},
      leaseDurationMs: 1_000,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterEntropy: 0.5,
    });
    assert.deepEqual(genericDelivery, { ok: false, code: "storage_failure" });
    assert.equal(genericMutationCalls, 0);
    const kindDelivery = await runOneKindDelivery({ kind: H_CYCLE_KIND } as never);
    assert.deepEqual(kindDelivery, { ok: false, code: "storage_failure" });

    now = new Date(now.getTime() + 1_001);
    assert.deepEqual(await generic.recoverExpired(), { ok: true, recovered: false });
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: running.id } })).status, "running");
    exactResult(scoped.recoverExpired({ schema: "h_cycle_generation_scoped_recover_v1" }), {
      ok: true,
      featureState: "off",
      code: "recovered",
    });
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: running.id } })).status, "retry_wait");

    await client.loopJob.deleteMany();
    await insertHcycleFixtureJob({
      client,
      id: "job_11111111111111111111111111111111",
      dedupeKey: "legacy-null-h-cycle",
      targetWeekKey: "2026-W35",
      generationSequence: null,
      now,
    });
    const legacyBefore = await client.loopJob.findUniqueOrThrow({ where: { id: "job_11111111111111111111111111111111" } });
    exactResult(scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 1_000 }), {
      ok: false,
      featureState: "off",
      code: "execution_fenced",
    });
    assert.deepEqual(await client.loopJob.findUniqueOrThrow({ where: { id: legacyBefore.id } }), legacyBefore);

    await client.loopJob.deleteMany();
    await insertHcycleFixtureJob({
      client,
      id: "job_22222222222222222222222222222222",
      dedupeKey: "pre-floor-h-cycle",
      targetWeekKey: "2026-W34",
      generationSequence: rootSequence,
      now,
    });
    exactResult(scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 1_000 }), {
      ok: false,
      featureState: "off",
      code: "execution_fenced",
    });

    await client.loopJob.deleteMany();
    const malformedPayloadJson = "{}";
    await insertHcycleFixtureJob({
      client,
      id: "job_33333333333333333333333333333333",
      dedupeKey: "malformed-h-cycle",
      targetWeekKey: "2026-W35",
      generationSequence: rootSequence,
      now,
      payloadJson: malformedPayloadJson,
      payloadHash: createHash("sha256").update(malformedPayloadJson, "utf8").digest("hex"),
    });
    exactResult(scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 1_000 }), {
      ok: false,
      featureState: "off",
      code: "execution_fenced",
    });

    await client.loopJob.deleteMany();
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W36",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    await appendDisable(client, () => new Date(now));
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W36",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: false, featureState: "off", code: "execution_fenced" });

    now = new Date("2026-08-31T00:00:00.000Z");
    const generationTwo = await appendReenable(client, () => new Date(now), "2026-W36");
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W36",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    const sameTargetRows = await client.loopJob.findMany({ where: { kind: H_CYCLE_KIND }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      sameTargetRows.map((row) => row.executionGenerationSequence).sort((left, right) => (left ?? 0) - (right ?? 0)),
      [rootSequence, generationTwo],
    );
    const g2Claim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 1_000 });
    assert.equal(g2Claim.ok, true);
    assert.equal(g2Claim.ok && g2Claim.code, "claimed");
    const g1 = sameTargetRows.find((row) => row.executionGenerationSequence === rootSequence);
    const g2 = sameTargetRows.find((row) => row.executionGenerationSequence === generationTwo);
    assert.ok(g1 && g2);
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: g1.id } })).status, "queued");
    assert.equal((await client.loopJob.findUniqueOrThrow({ where: { id: g2.id } })).status, "running");
  });
});

test("A8C3C-CG1-T1 atomically fences record/reconcile/success to one current generation", async () => {
  await withFixture(async (_fixture, client, direct) => {
    let now = new Date(ROOT_NOW);
    const generationOne = await appendRoot(client, () => new Date(now));
    now = new Date("2026-09-27T23:20:00.000Z");
    const scoped = createHCycleGenerationScopedExecutionV1({
      runImmediate: immediateRunner(direct),
      clock: { now: () => new Date(now) },
      randomBytes: entropy(500),
    });
    const target39 = evaluationFor("2026-W39", now);
    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: Object.freeze(Object.create(null)) as never,
      ...target39,
    }), { ok: false, featureState: "off", code: "invalid_execution_input" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 0);

    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W39",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    const firstClaim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 60_000 });
    assert.equal(firstClaim.ok, true);
    assert.equal(firstClaim.ok && firstClaim.code, "claimed");
    if (!firstClaim.ok || firstClaim.code !== "claimed") assert.fail("current generation target must claim");

    const beforeTimingFence = await client.loopJob.findFirstOrThrow({
      where: { kind: H_CYCLE_KIND, executionGenerationSequence: generationOne, payloadHash: hCyclePayloadJson("2026-W39").payloadHash },
    });
    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: firstClaim.capability,
      ...target39,
      scheduledFor: new Date(target39.scheduledFor.getTime() + 1),
    }), { ok: false, featureState: "off", code: "invalid_evaluation_record" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 0);
    assert.deepEqual(
      await client.loopJob.findUniqueOrThrow({ where: { id: beforeTimingFence.id } }),
      beforeTimingFence,
      "timing metadata must be canonical before either durable mutation",
    );

    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: firstClaim.capability,
      ...target39,
    }), { ok: true, featureState: "off", code: "recorded_and_succeeded" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 1);
    const firstRecord = await client.hCycleEvaluationRecord.findFirstOrThrow({
      where: { targetWeekKey: "2026-W39" },
    });
    const firstJob = await client.loopJob.findFirstOrThrow({
      where: { kind: H_CYCLE_KIND, executionGenerationSequence: generationOne, payloadHash: hCyclePayloadJson("2026-W39").payloadHash },
    });
    assert.equal(firstJob.status, "succeeded");
    assert.equal(firstJob.leaseToken, null);

    const target38 = evaluationFor("2026-W38", now);
    const legacyRecord = await persistHCycleEvaluationRecordV1({ client, ...target38 });
    assert.equal(legacyRecord.ok, true);
    assert.equal(legacyRecord.ok && legacyRecord.created, true);
    if (!legacyRecord.ok) assert.fail("fixture record must persist once");
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W38",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    const reconciliationClaim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 60_000 });
    assert.equal(reconciliationClaim.ok, true);
    assert.equal(reconciliationClaim.ok && reconciliationClaim.code, "claimed");
    if (!reconciliationClaim.ok || reconciliationClaim.code !== "claimed") assert.fail("current generation record must claim");
    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: reconciliationClaim.capability,
      ...target38,
    }), { ok: true, featureState: "off", code: "reconciled_and_succeeded" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 2);
    const reconciled = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: legacyRecord.record.id } });
    assert.equal(reconciled.aggregateEnvelopeSha256, legacyRecord.record.aggregateEnvelopeSha256);
    assert.equal(reconciled.recordSha256, legacyRecord.record.recordSha256);

    const target36 = evaluationFor("2026-W36", now);
    const conflicting36 = conflictingEvaluationFor("2026-W36", now);
    const original36 = await persistHCycleEvaluationRecordV1({ client, ...target36 });
    assert.equal(original36.ok, true);
    assert.equal(original36.ok && original36.created, true);
    if (!original36.ok) assert.fail("fixture record must persist once");
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W36",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    const mismatchClaim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 60_000 });
    assert.equal(mismatchClaim.ok, true);
    assert.equal(mismatchClaim.ok && mismatchClaim.code, "claimed");
    if (!mismatchClaim.ok || mismatchClaim.code !== "claimed") assert.fail("conflicting record target must claim");
    const beforeMismatchFence = await client.loopJob.findFirstOrThrow({
      where: { kind: H_CYCLE_KIND, executionGenerationSequence: generationOne, payloadHash: hCyclePayloadJson("2026-W36").payloadHash },
    });
    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: mismatchClaim.capability,
      ...conflicting36,
    }), { ok: false, featureState: "off", code: "evaluation_record_integrity_failure" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 3);
    assert.deepEqual(
      await client.loopJob.findUniqueOrThrow({ where: { id: beforeMismatchFence.id } }),
      beforeMismatchFence,
      "digest mismatch leaves the claimed job unchanged",
    );

    const target37 = evaluationFor("2026-W37", now);
    exactResult(scoped.enqueue({
      schema: "h_cycle_generation_scoped_enqueue_v1",
      targetWeekKey: "2026-W37",
      maxAttempts: 3,
      availableAt: new Date(now),
    }), { ok: true, featureState: "off", code: "enqueued" });
    const disabledClaim = scoped.claim({ schema: "h_cycle_generation_scoped_claim_v1", leaseDurationMs: 60_000 });
    assert.equal(disabledClaim.ok, true);
    assert.equal(disabledClaim.ok && disabledClaim.code, "claimed");
    if (!disabledClaim.ok || disabledClaim.code !== "claimed") assert.fail("due current generation target must claim");
    const beforeDisableFence = await client.loopJob.findFirstOrThrow({
      where: { kind: H_CYCLE_KIND, executionGenerationSequence: generationOne, payloadHash: hCyclePayloadJson("2026-W37").payloadHash },
    });
    await appendDisable(client, () => new Date(now));
    exactResult(scoped.recordAndSucceed({
      schema: "h_cycle_generation_scoped_record_and_succeed_v1",
      capability: disabledClaim.capability,
      ...target37,
    }), { ok: false, featureState: "off", code: "execution_fenced" });
    assert.equal(await client.hCycleEvaluationRecord.count(), 3);
    assert.deepEqual(
      await client.loopJob.findUniqueOrThrow({ where: { id: beforeDisableFence.id } }),
      beforeDisableFence,
      "disable-first leaves neither record nor job mutation",
    );
    const retainedFirstRecord = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: firstRecord.id } });
    assert.equal(retainedFirstRecord.aggregateEnvelopeSha256, firstRecord.aggregateEnvelopeSha256);
  });
});
