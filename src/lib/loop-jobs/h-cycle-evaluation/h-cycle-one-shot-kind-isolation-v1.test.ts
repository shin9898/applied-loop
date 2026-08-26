import assert from "node:assert/strict";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import type { LoopJob } from "../../../generated/prisma/client";
import { PrismaClient } from "../../../generated/prisma/client";
import {
  canonicalJson,
  createLoopJobQueue,
  defineLoopJobRegistry,
  type LoopJobClient,
  type LoopJobQueue,
} from "../state-machine";
import { runOneKindDelivery, type LoopJobHandler } from "../delivery";

const FIXED_NOW = new Date("2026-08-24T00:00:00.000Z");
const A8C2_CLAIM_CHILD_FIXTURE_PREFIX = "applied-loop-a8c2-cg1-";
const C3_SCOPED_PROBE_KIND = "c3_scoped_probe";
const JOB_KEYS = [
  "id",
  "kind",
  "dedupeKey",
  "payloadJson",
  "payloadHash",
  "status",
  "attempts",
  "maxAttempts",
  "availableAt",
  "lockedAt",
  "leaseExpiresAt",
  "lockedBy",
  "leaseToken",
  "lastError",
  "createdAt",
  "updatedAt",
  "finishedAt",
  "executionGenerationSequence",
] as const;

const registry = defineLoopJobRegistry({
  [C3_SCOPED_PROBE_KIND]: {
    version: "v1",
    fields: {
      hypothesis: { type: "enum", values: ["h_cycle"] as const },
      cadence: { type: "enum", values: ["weekly"] as const },
      targetWeekKey: { type: "iso_week" },
      policyVersion: { type: "enum", values: ["h_cycle_evidence_v1"] as const },
      projectionSchemaVersion: { type: "enum", values: ["h_cycle_evidence_preview_v1"] as const },
    },
    dedupeFields: ["hypothesis", "cadence", "targetWeekKey", "policyVersion", "projectionSchemaVersion"] as const,
  },
  foreign_probe: {
    version: "v1",
    fields: {
      operation: { type: "enum", values: ["inspect"] as const },
    },
    dedupeFields: ["operation"] as const,
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
      { url: databasePath, fileMustExist: true, timeout: 1_000 },
      { timestampFormat: "iso8601" },
    ),
  });
}

type ValidatedClaimChildDatabase = Readonly<{
  canonicalPath: string;
  canonicalFixtureRoot: string;
  device: number;
  inode: number;
  linkCount: 1;
}>;

function validateClaimChildDatabasePath(
  rawDatabasePath: unknown,
  rawFixtureRoot: unknown,
): ValidatedClaimChildDatabase | undefined {
  if (typeof rawDatabasePath !== "string" || typeof rawFixtureRoot !== "string") return undefined;
  try {
    const canonicalTempRoot = realpathSync(tmpdir());
    const resolvedFixtureRoot = resolve(rawFixtureRoot);
    const fixtureRootInfo = lstatSync(resolvedFixtureRoot);
    if (fixtureRootInfo.isSymbolicLink() || !fixtureRootInfo.isDirectory()) return undefined;
    const canonicalFixtureRoot = realpathSync(resolvedFixtureRoot);
    const fixtureName = basename(canonicalFixtureRoot);
    const fixtureSuffix = fixtureName.slice(A8C2_CLAIM_CHILD_FIXTURE_PREFIX.length);
    if (dirname(canonicalFixtureRoot) !== canonicalTempRoot || !fixtureName.startsWith(A8C2_CLAIM_CHILD_FIXTURE_PREFIX) ||
        !/^[A-Za-z0-9]+$/.test(fixtureSuffix)) {
      return undefined;
    }

    const resolvedDatabasePath = resolve(rawDatabasePath);
    const expectedResolvedDatabasePath = join(resolvedFixtureRoot, "disposable.db");
    const expectedCanonicalDatabasePath = join(canonicalFixtureRoot, "disposable.db");
    if (resolvedDatabasePath !== expectedResolvedDatabasePath || basename(resolvedDatabasePath) !== "disposable.db") {
      return undefined;
    }
    const databaseInfo = lstatSync(resolvedDatabasePath);
    if (databaseInfo.isSymbolicLink() || !databaseInfo.isFile() || databaseInfo.nlink !== 1) return undefined;
    const canonicalDatabasePath = realpathSync(resolvedDatabasePath);
    return canonicalDatabasePath === expectedCanonicalDatabasePath
      ? Object.freeze({
          canonicalPath: canonicalDatabasePath,
          canonicalFixtureRoot,
          device: databaseInfo.dev,
          inode: databaseInfo.ino,
          linkCount: 1,
        })
      : undefined;
  } catch {
    return undefined;
  }
}

function claimChildDatabaseIdentityIsStable(validated: ValidatedClaimChildDatabase): boolean {
  try {
    const repeated = validateClaimChildDatabasePath(validated.canonicalPath, validated.canonicalFixtureRoot);
    if (!repeated) return false;
    return repeated.canonicalPath === validated.canonicalPath &&
      repeated.canonicalFixtureRoot === validated.canonicalFixtureRoot &&
      repeated.device === validated.device && repeated.inode === validated.inode && repeated.linkCount === 1;
  } catch {
    return false;
  }
}

function assertExactDataObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value as object), keys);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, true);
    assert.equal("value" in descriptor, true);
    assert.equal(descriptor.get, undefined);
    assert.equal(descriptor.set, undefined);
  }
}

function assertStorageFailure(value: unknown): void {
  assertExactDataObject(value, ["code"]);
  assert.equal(value.code, "storage_failure");
}

function assertExactDeliveryResult(value: unknown): asserts value is Record<string, unknown> {
  assertExactDataObject(value, ["ok", "code"]);
  assert.equal(typeof value.ok, "boolean");
  assert.equal(typeof value.code, "string");
  assert.equal(Object.values(value).every((entry) => entry === null || typeof entry !== "object"), true);
}

function makeLoopJob(kind: string): LoopJob {
  const payload = kind === C3_SCOPED_PROBE_KIND
    ? {
        hypothesis: "h_cycle",
        cadence: "weekly",
        targetWeekKey: "2026-W35",
        policyVersion: "h_cycle_evidence_v1",
        projectionSchemaVersion: "h_cycle_evidence_preview_v1",
      }
    : { operation: "inspect" };
  const payloadJson = canonicalJson(payload);
  return {
    id: `job_${(kind === C3_SCOPED_PROBE_KIND ? "a" : "b").repeat(32)}`,
    kind,
    dedupeKey: `${kind}:v1:${"c".repeat(64)}`,
    payloadJson,
    payloadHash: createHash("sha256").update(payloadJson, "utf8").digest("hex"),
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date(FIXED_NOW),
    lockedAt: new Date(FIXED_NOW),
    leaseExpiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    lockedBy: `worker_${"d".repeat(32)}`,
    leaseToken: "e".repeat(64),
    lastError: null,
    createdAt: new Date(FIXED_NOW),
    updatedAt: new Date(FIXED_NOW),
    finishedAt: null,
    executionGenerationSequence: null,
  };
}

function makeDeliveryInput(overrides: Record<string, unknown> = {}) {
  const handler: LoopJobHandler = {
    idempotencyKey: "job_id",
    handle: async () => undefined,
  };
  const queue = {
    claimKind: async () => ({ code: "no_job" as const }),
    failOwned: async () => ({ ok: true as const, code: "retry_scheduled" as const, availableAt: new Date(FIXED_NOW) }),
    succeedOwned: async () => ({ ok: true as const }),
  };
  return {
    kind: C3_SCOPED_PROBE_KIND,
    queue: queue as unknown as LoopJobQueue,
    registry,
    handlers: { [C3_SCOPED_PROBE_KIND]: handler },
    leaseDurationMs: 60_000,
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
    jitterEntropy: 0.5,
    ...overrides,
  };
}

function assertDecoderDominance(): void {
  const deliveryPath = join(process.cwd(), "src/lib/loop-jobs/delivery.ts");
  const source = ts.createSourceFile(
    deliveryPath,
    readFileSync(deliveryPath, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "runOneKindDelivery",
  );
  assert.ok(declaration?.body, "intentional RED: runOneKindDelivery is absent");

  const decoderIdentifiers: ts.Identifier[] = [];
  const prohibitedFlow: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "decodeLoopJobPayload") decoderIdentifiers.push(node);
    if (node !== declaration && (
      ts.isFunctionLike(node) || ts.isLabeledStatement(node) || ts.isTryStatement(node) && node.finallyBlock !== undefined
    )) prohibitedFlow.push(node);
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  assert.equal(decoderIdentifiers.length, 1, "scoped delivery must contain exactly one decoder reference");
  const decoderIdentifier = decoderIdentifiers[0];
  assert.ok(ts.isCallExpression(decoderIdentifier.parent) && decoderIdentifier.parent.expression === decoderIdentifier);
  const decoderStatement = declaration.body.statements.find((statement) =>
    decoderIdentifier.getStart(source) >= statement.getStart(source) && decoderIdentifier.getEnd() <= statement.getEnd(),
  );
  assert.ok(decoderStatement && ts.isVariableStatement(decoderStatement));
  const decoderIndex = declaration.body.statements.indexOf(decoderStatement);
  assert.ok(decoderIndex > 0);
  const guard = declaration.body.statements[decoderIndex - 1];
  assert.ok(ts.isIfStatement(guard), "kind mismatch guard must immediately precede decode");
  assert.equal(guard.elseStatement, undefined);
  assert.equal(guard.expression.getText(source), "claim.job.kind !== snapshottedKind");
  assert.ok(ts.isBlock(guard.thenStatement));
  assert.equal(guard.thenStatement.statements.length, 1);
  const mismatchReturn = guard.thenStatement.statements[0];
  assert.ok(ts.isReturnStatement(mismatchReturn));
  assert.equal(mismatchReturn.expression?.getText(source), '{ ok: false, code: "storage_failure" }');
  assert.equal(prohibitedFlow.length, 0, "scoped delivery body must not hide decode in closure/finally/label flow");
  assert.equal(
    declaration.body.statements.slice(0, decoderIndex - 1).some((statement) =>
      statement.getText(source).includes("decodeLoopJobPayload")),
    false,
  );
}

function snapshotJob(job: LoopJob) {
  return Object.fromEntries(JOB_KEYS.map((key) => [
    key,
    job[key] instanceof Date ? job[key].toISOString() : job[key],
  ]));
}

type ChildResult = Readonly<{ code: "claimed" | "no_job" | "storage_failure" }>;
type ClaimChild = Readonly<{
  process: ChildProcess;
  ready: Promise<void>;
  result: Promise<ChildResult>;
  exited: Promise<void>;
}>;

async function runClaimChild(): Promise<void> {
  const validatedDatabase = validateClaimChildDatabasePath(
    process.env.A8C2_TEST_DATABASE_PATH,
    process.env.A8C2_TEST_FIXTURE_ROOT,
  );
  const seed = Number(process.env.A8C2_TEST_ENTROPY_SEED);
  if (!validatedDatabase || !Number.isInteger(seed)) {
    process.exitCode = 2;
    process.disconnect?.();
    return;
  }
  const client = makeClient(validatedDatabase.canonicalPath);
  try {
    // PrismaBetterSqlite3.connect constructs one better-sqlite3 client that the adapter retains;
    // this literal query forces that connection before the filesystem identity is rechecked.
    const probe = await client.$queryRaw<Array<{ identityProbe: bigint | number }>>`SELECT 1 AS "identityProbe"`;
    if (probe.length !== 1 || Number(probe[0]?.identityProbe) !== 1) throw new Error("closed identity probe failure");
    if (process.env.A8C2_TEST_IDENTITY_SWAP_HOOK === "pause_after_open") {
      process.send?.({ type: "identity_opened" });
      await new Promise<void>((resolveHook) => {
        process.once("message", (message: unknown) => {
          if (typeof message === "object" && message !== null &&
              (message as { type?: string }).type === "continue_identity_check") resolveHook();
          else resolveHook();
        });
      });
    }
    if (!claimChildDatabaseIdentityIsStable(validatedDatabase)) {
      await client.$disconnect();
      process.exitCode = 2;
      process.disconnect?.();
      return;
    }
  } catch {
    await client.$disconnect().catch(() => undefined);
    process.exitCode = 2;
    process.disconnect?.();
    return;
  }
  const queue = createLoopJobQueue({
    client,
    registry,
    clock: clockAt(FIXED_NOW),
    randomBytes: entropy(seed),
  });
  process.send?.({ type: "ready" });
  process.once("message", async (message: unknown) => {
    if (typeof message !== "object" || message === null || (message as { type?: string }).type !== "go") {
      await client.$disconnect();
      process.exitCode = 3;
      process.disconnect?.();
      return;
    }
    try {
      const result = await queue.claimKind({ kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 60_000 });
      const closed: ChildResult = { code: result.code };
      await client.$disconnect();
      process.send?.({ type: "result", result: closed }, () => process.disconnect?.());
    } catch {
      await client.$disconnect();
      process.exitCode = 4;
      process.disconnect?.();
    }
  });
}

function startClaimChild(databasePath: string, dotenvConfigPath: string, seed: number): ClaimChild {
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      A8C2_TEST_MODE: "claim-child",
      A8C2_TEST_DATABASE_PATH: databasePath,
      A8C2_TEST_FIXTURE_ROOT: dirname(databasePath),
      A8C2_TEST_ENTROPY_SEED: String(seed),
      DOTENV_CONFIG_PATH: dotenvConfigPath,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let markReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (result: ChildResult) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ChildResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const stderr: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
  child.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    if ((message as { type?: string }).type === "ready") markReady();
    if ((message as { type?: string }).type === "result") {
      resolveResult((message as { result: ChildResult }).result);
    }
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      rejectReady(error);
      rejectResult(error);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`A8C2 claim child failed code=${String(code)} stderr-bytes=${stderr.join("").length}`);
        rejectReady(error);
        rejectResult(error);
        reject(error);
      }
    });
  });
  return { process: child, ready, result, exited };
}

async function raceClaims(left: ClaimChild, right: ClaimChild): Promise<[ChildResult, ChildResult]> {
  await Promise.all([left.ready, right.ready]);
  left.process.send?.({ type: "go" });
  right.process.send?.({ type: "go" });
  const results = await Promise.all([left.result, right.result]);
  await Promise.all([left.exited, right.exited]);
  return results;
}

if (process.env.A8C2_TEST_MODE === "claim-child") {
  void runClaimChild();
} else {
  test("A8C2-CG1-T1 claimKind atomically ignores earlier foreign work", async () => {
    const rawSource = readFileSync(join(process.cwd(), "src/lib/loop-jobs/raw-state-adapter.ts"), "utf8");
    const markerStart = "// A8-C2 BEGIN: single-kind raw claim";
    const markerEnd = "// A8-C2 END: single-kind raw claim";
    const start = rawSource.indexOf(markerStart);
    const end = rawSource.indexOf(markerEnd);
    assert.notEqual(start, -1, "intentional RED: scoped raw claim marker is absent");
    assert.ok(end > start, "scoped raw claim marker order");
    const rawClaimSource = rawSource.slice(start, end + markerEnd.length);
    assert.equal((rawClaimSource.match(/AND "kind" = \$\{kind\}/g) ?? []).length, 2);
    const candidateStart = rawClaimSource.indexOf('WHERE "id" = (');
    const candidateEnd = rawClaimSource.indexOf('\n    )', candidateStart);
    assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
    assert.match(rawClaimSource.slice(candidateStart, candidateEnd), /AND "kind" = \$\{kind\}/);
    assert.match(rawClaimSource.slice(candidateEnd), /AND "kind" = \$\{kind\}/);
    assert.doesNotMatch(rawClaimSource, /(?:--|\/\*)[^`]*AND "kind"/);

    const fixtureRoot = mkdtempSync(join(tmpdir(), "applied-loop-a8c2-cg1-"));
    const databasePath = join(fixtureRoot, "disposable.db");
    const dotenvConfigPath = join(fixtureRoot, "dotenv-never-exists");
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`,
        DOTENV_CONFIG_PATH: dotenvConfigPath,
      },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = makeClient(databasePath);

    try {
      let clockCalls = 0;
      let entropyCalls = 0;
      let rawCalls = 0;
      let accessorCalls = 0;
      let proxyTrapCalls = 0;
      const boundaryClient = {
        loopJob: client.loopJob,
        $queryRaw: (...args: unknown[]) => {
          rawCalls += 1;
          return Reflect.apply(client.$queryRaw, client, args);
        },
      } as unknown as LoopJobClient;
      const boundaryQueue = createLoopJobQueue({
        client: boundaryClient,
        registry,
        clock: {
          now: () => {
            clockCalls += 1;
            return new Date(FIXED_NOW);
          },
          addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
          fromStorage: (value) => new Date(value),
        },
        randomBytes: (length) => {
          entropyCalls += 1;
          return entropy(1)(length);
        },
      });

      const inherited = Object.assign(Object.create({ kind: C3_SCOPED_PROBE_KIND }), { leaseDurationMs: 1_000 });
      const accessor = Object.create(null) as Record<string, unknown>;
      Object.defineProperties(accessor, {
        kind: {
          enumerable: true,
          get: () => {
            accessorCalls += 1;
            return C3_SCOPED_PROBE_KIND;
          },
        },
        leaseDurationMs: { enumerable: true, value: 1_000 },
      });
      const nonEnumerable = { kind: C3_SCOPED_PROBE_KIND } as Record<string, unknown>;
      Object.defineProperty(nonEnumerable, "leaseDurationMs", { enumerable: false, value: 1_000 });
      const symbolKey = Symbol("must-not-echo");
      const statefulProxy = new Proxy(
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_000 },
        {
          ownKeys: () => {
            proxyTrapCalls += 1;
            return ["kind", "leaseDurationMs"];
          },
          getOwnPropertyDescriptor: (target, property) => {
            proxyTrapCalls += 1;
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
          getPrototypeOf: (target) => {
            proxyTrapCalls += 1;
            return Reflect.getPrototypeOf(target);
          },
        },
      );
      const throwingProxy = new Proxy(
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_000 },
        {
          ownKeys: () => {
            proxyTrapCalls += 1;
            throw new Error("must-not-echo");
          },
          getPrototypeOf: () => {
            proxyTrapCalls += 1;
            throw new Error("must-not-echo");
          },
          getOwnPropertyDescriptor: () => {
            proxyTrapCalls += 1;
            throw new Error("must-not-echo");
          },
        },
      );
      const invalidInputs: unknown[] = [
        inherited,
        accessor,
        nonEnumerable,
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_000, [symbolKey]: "must-not-echo" },
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_000, extra: "must-not-echo" },
        { kind: C3_SCOPED_PROBE_KIND },
        { kind: "H_CYCLE_EVALUATE", leaseDurationMs: 1_000 },
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 0 },
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1.5 },
        { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: Number.MAX_SAFE_INTEGER + 1 },
        statefulProxy,
        throwingProxy,
        null,
        [],
      ];
      await client.loopJob.create({
        data: {
          id: `job_${"9".repeat(32)}`,
          kind: "foreign_probe",
          dedupeKey: `foreign_probe:v1:${"8".repeat(64)}`,
          payloadJson: '{"operation":"inspect"}',
          payloadHash: "7".repeat(64),
          status: "queued",
          attempts: 0,
          maxAttempts: 3,
          availableAt: new Date(FIXED_NOW.getTime() - 5_000),
          lockedAt: null,
          leaseExpiresAt: null,
          lockedBy: null,
          leaseToken: null,
          lastError: null,
          createdAt: new Date(FIXED_NOW.getTime() - 5_000),
          updatedAt: new Date(FIXED_NOW.getTime() - 5_000),
          finishedAt: null,
        },
      });
      const beforeInvalid = await client.loopJob.findMany({ orderBy: { id: "asc" } });
      for (const invalidInput of invalidInputs) {
        assertStorageFailure(await boundaryQueue.claimKind(invalidInput as never));
      }
      assert.equal(accessorCalls, 0);
      assert.equal(proxyTrapCalls, 0);
      assert.equal(clockCalls, 0);
      assert.equal(entropyCalls, 0);
      assert.equal(rawCalls, 0);
      assert.deepEqual(await client.loopJob.findMany({ orderBy: { id: "asc" } }), beforeInvalid);

      const accepted = { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_234 };
      const capturedRawValues: unknown[][] = [];
      const snapshotClient = {
        loopJob: client.loopJob,
        $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          capturedRawValues.push(values);
          accepted.kind = "foreign_probe";
          accepted.leaseDurationMs = 9_999;
          return [];
        },
      } as unknown as LoopJobClient;
      const snapshotQueue = createLoopJobQueue({
        client: snapshotClient,
        registry,
        clock: {
          now: () => {
            accepted.kind = "foreign_probe";
            accepted.leaseDurationMs = 9_999;
            return new Date(FIXED_NOW);
          },
          addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
          fromStorage: (value) => new Date(value),
        },
        randomBytes: (length) => {
          accepted.kind = "foreign_probe";
          accepted.leaseDurationMs = 9_999;
          return entropy(20)(length);
        },
      });
      const noJob = await snapshotQueue.claimKind(accepted);
      assertExactDataObject(noJob, ["code"]);
      assert.equal(noJob.code, "no_job");
      assert.equal(capturedRawValues.length, 1);
      assert.equal(capturedRawValues[0].filter((value) => value === C3_SCOPED_PROBE_KIND).length, 2);
      assert.equal(capturedRawValues[0].includes("foreign_probe"), false);
      assert.equal(
        capturedRawValues[0].some(
          (value) => value instanceof Date && value.getTime() === FIXED_NOW.getTime() + 1_234,
        ),
        true,
      );

      const failingClient = {
        loopJob: client.loopJob,
        $queryRaw: async () => {
          throw new Error("database path and payload must-not-echo");
        },
      } as unknown as LoopJobClient;
      const failure = await createLoopJobQueue({
        client: failingClient,
        registry,
        clock: clockAt(FIXED_NOW),
        randomBytes: entropy(30),
      }).claimKind({ kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 1_000 });
      assertStorageFailure(failure);

      await client.loopJob.deleteMany();
      const queue = createLoopJobQueue({ client, registry, clock: clockAt(FIXED_NOW), randomBytes: entropy(40) });
      const foreign = await queue.enqueue({
        kind: "foreign_probe",
        payload: { operation: "inspect" },
        maxAttempts: 3,
        availableAt: new Date(FIXED_NOW.getTime() - 2_000),
      });
      assert.equal(foreign.ok, true);
      const hCycle = await queue.enqueue({
        kind: C3_SCOPED_PROBE_KIND,
        payload: {
          hypothesis: "h_cycle",
          cadence: "weekly",
          targetWeekKey: "2026-W35",
          policyVersion: "h_cycle_evidence_v1",
          projectionSchemaVersion: "h_cycle_evidence_preview_v1",
        },
        maxAttempts: 3,
        availableAt: new Date(FIXED_NOW.getTime() - 1_000),
      });
      assert.equal(hCycle.ok, true);
      const foreignBefore = await client.loopJob.findUniqueOrThrow({
        where: { id: foreign.ok ? foreign.job.id : assert.fail("foreign enqueue failed") },
      });
      const claimed = await queue.claimKind({ kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 60_000 });
      assertExactDataObject(claimed, ["code", "job"]);
      assert.equal(claimed.code, "claimed");
      if (claimed.code !== "claimed") assert.fail("scoped row not claimed");
      assertExactDataObject(claimed.job, JOB_KEYS);
      assert.equal(claimed.job.kind, C3_SCOPED_PROBE_KIND);
      assert.equal(claimed.job.id, hCycle.ok ? hCycle.job.id : "");
      const foreignAfter = await client.loopJob.findUniqueOrThrow({ where: { id: foreignBefore.id } });
      assert.deepEqual(snapshotJob(foreignAfter), snapshotJob(foreignBefore));
      const none = await queue.claimKind({ kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 60_000 });
      assertExactDataObject(none, ["code"]);
      assert.equal(none.code, "no_job");
      assert.deepEqual(snapshotJob(await client.loopJob.findUniqueOrThrow({ where: { id: foreignBefore.id } })), snapshotJob(foreignBefore));

      await client.loopJob.deleteMany();
      const raceQueue = createLoopJobQueue({ client, registry, clock: clockAt(FIXED_NOW), randomBytes: entropy(80) });
      const due = await raceQueue.enqueue({
        kind: C3_SCOPED_PROBE_KIND,
        payload: {
          hypothesis: "h_cycle",
          cadence: "weekly",
          targetWeekKey: "2026-W35",
          policyVersion: "h_cycle_evidence_v1",
          projectionSchemaVersion: "h_cycle_evidence_preview_v1",
        },
        maxAttempts: 3,
      });
      assert.equal(due.ok, true);
      const [left, right] = await raceClaims(
        startClaimChild(databasePath, dotenvConfigPath, 100),
        startClaimChild(databasePath, dotenvConfigPath, 140),
      );
      assert.equal([left, right].filter((result) => result.code === "claimed").length, 1);
      assert.equal([left, right].filter((result) => result.code === "no_job").length, 1);
      const stored = await client.loopJob.findUniqueOrThrow({
        where: { id: due.ok ? due.job.id : assert.fail("race enqueue failed") },
      });
      assert.equal(stored.status, "running");
      assert.equal(stored.attempts, 1);
    } finally {
      await client.$disconnect();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("A8C2-CG2-T1 one-kind delivery never fails foreign queued work", async () => {
    assertDecoderDominance();

    const exactResults: unknown[] = [];
    let claimCalls = 0;
    const base = makeDeliveryInput();
    const validNoJob = await runOneKindDelivery({
      ...base,
      queue: {
        claimKind: async (options: unknown) => {
          claimCalls += 1;
          assert.deepEqual(options, { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 60_000 });
          return { code: "no_job" as const };
        },
        failOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
        succeedOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
      } as unknown as LoopJobQueue,
    });
    exactResults.push(validNoJob);
    assert.deepEqual(validNoJob, { ok: true, code: "no_job" });
    assert.equal(claimCalls, 1);

    const kindAccessorInput = makeDeliveryInput() as Record<string, unknown>;
    let kindAccessorCalls = 0;
    Object.defineProperty(kindAccessorInput, "kind", {
      enumerable: true,
      get: () => {
        kindAccessorCalls += 1;
        return C3_SCOPED_PROBE_KIND;
      },
    });
    const inheritedKindInput = Object.assign(Object.create({ kind: C3_SCOPED_PROBE_KIND }), makeDeliveryInput());
    delete inheritedKindInput.kind;
    const nonEnumerableKindInput = makeDeliveryInput() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableKindInput, "kind", { enumerable: false, value: C3_SCOPED_PROBE_KIND });
    const symbolKindInput = makeDeliveryInput() as Record<PropertyKey, unknown>;
    delete symbolKindInput.kind;
    symbolKindInput[Symbol("kind-must-not-echo")] = C3_SCOPED_PROBE_KIND;
    let inputProxyTraps = 0;
    const throwingInputProxy = new Proxy(makeDeliveryInput(), {
      getOwnPropertyDescriptor: () => {
        inputProxyTraps += 1;
        throw new Error("input-proxy-must-not-echo");
      },
      get: () => {
        inputProxyTraps += 1;
        throw new Error("input-proxy-must-not-echo");
      },
    });
    for (const invalidInput of [
      kindAccessorInput,
      inheritedKindInput,
      nonEnumerableKindInput,
      symbolKindInput,
      throwingInputProxy,
      makeDeliveryInput({ kind: "" }),
      makeDeliveryInput({ kind: "H_CYCLE" }),
      makeDeliveryInput({ leaseDurationMs: 0 }),
      makeDeliveryInput({ leaseDurationMs: 1.5 }),
    ]) {
      const result = await runOneKindDelivery(invalidInput as never);
      exactResults.push(result);
      assert.deepEqual(result, { ok: false, code: "storage_failure" });
    }
    assert.equal(kindAccessorCalls, 0);
    assert.equal(inputProxyTraps, 0);

    let registryAccessorCalls = 0;
    const invalidRegistries: unknown[] = [
      {},
      Object.create({ [C3_SCOPED_PROBE_KIND]: registry[C3_SCOPED_PROBE_KIND] }),
      Object.defineProperty({}, C3_SCOPED_PROBE_KIND, {
        enumerable: true,
        get: () => {
          registryAccessorCalls += 1;
          return registry[C3_SCOPED_PROBE_KIND];
        },
      }),
      new Proxy({ [C3_SCOPED_PROBE_KIND]: registry[C3_SCOPED_PROBE_KIND] }, {
        getOwnPropertyDescriptor: () => {
          throw new Error("registry-proxy-must-not-echo");
        },
      }),
    ];
    for (const invalidRegistry of invalidRegistries) {
      let handlerInteractions = 0;
      const handlers = new Proxy({ [C3_SCOPED_PROBE_KIND]: base.handlers[C3_SCOPED_PROBE_KIND] }, {
        get: (target, property, receiver) => {
          handlerInteractions += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor: (target, property) => {
          handlerInteractions += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        ownKeys: (target) => {
          handlerInteractions += 1;
          return Reflect.ownKeys(target);
        },
        has: (target, property) => {
          handlerInteractions += 1;
          return Reflect.has(target, property);
        },
      });
      const result = await runOneKindDelivery(makeDeliveryInput({ registry: invalidRegistry, handlers }) as never);
      exactResults.push(result);
      assert.deepEqual(result, { ok: false, code: "storage_failure" });
      assert.equal(handlerInteractions, 0, "registry rejection must precede every handler interaction");
    }
    assert.equal(registryAccessorCalls, 0);

    const validHandler: LoopJobHandler = { idempotencyKey: "job_id", handle: async () => undefined };
    let handlerEntryAccessorCalls = 0;
    const handlerAccessor = Object.defineProperty({}, C3_SCOPED_PROBE_KIND, {
      enumerable: true,
      get: () => {
        handlerEntryAccessorCalls += 1;
        return validHandler;
      },
    });
    const inheritedHandler = Object.create({ [C3_SCOPED_PROBE_KIND]: validHandler });
    const inheritedIdempotency = Object.create({ idempotencyKey: "job_id" }) as Record<string, unknown>;
    inheritedIdempotency.handle = async () => undefined;
    const inheritedHandle = Object.create({ handle: async () => undefined }) as Record<string, unknown>;
    inheritedHandle.idempotencyKey = "job_id";
    let handlerIdAccessorCalls = 0;
    const handlerIdAccessor = Object.defineProperty({ handle: async () => undefined }, "idempotencyKey", {
      get: () => {
        handlerIdAccessorCalls += 1;
        return "job_id";
      },
    });
    let handlerHandleAccessorCalls = 0;
    const handlerHandleAccessor = Object.defineProperty({ idempotencyKey: "job_id" }, "handle", {
      get: () => {
        handlerHandleAccessorCalls += 1;
        return async () => undefined;
      },
    });
    let handlerProxyTraps = 0;
    let handlerProxyCallableCalls = 0;
    const proxiedHandle = new Proxy(async () => undefined, {
      apply: async () => {
        handlerProxyCallableCalls += 1;
        return undefined;
      },
    });
    const invalidHandlers: unknown[] = [
      {},
      inheritedHandler,
      handlerAccessor,
      new Proxy({ [C3_SCOPED_PROBE_KIND]: validHandler }, {
        getOwnPropertyDescriptor: () => {
          handlerProxyTraps += 1;
          throw new Error("handler-proxy-must-not-echo");
        },
      }),
      { [C3_SCOPED_PROBE_KIND]: { handle: async () => undefined } },
      { [C3_SCOPED_PROBE_KIND]: { idempotencyKey: "other", handle: async () => undefined } },
      { [C3_SCOPED_PROBE_KIND]: inheritedIdempotency },
      { [C3_SCOPED_PROBE_KIND]: handlerIdAccessor },
      { [C3_SCOPED_PROBE_KIND]: { idempotencyKey: "job_id" } },
      { [C3_SCOPED_PROBE_KIND]: { idempotencyKey: "job_id", handle: 1 } },
      { [C3_SCOPED_PROBE_KIND]: inheritedHandle },
      { [C3_SCOPED_PROBE_KIND]: handlerHandleAccessor },
      { [C3_SCOPED_PROBE_KIND]: { idempotencyKey: "job_id", handle: proxiedHandle } },
    ];
    for (const handlers of invalidHandlers) {
      let invalidHandlerClaimCalls = 0;
      const queue = {
        claimKind: async () => {
          invalidHandlerClaimCalls += 1;
          return { code: "no_job" as const };
        },
        failOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
        succeedOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
      } as unknown as LoopJobQueue;
      const result = await runOneKindDelivery(makeDeliveryInput({ handlers, queue }) as never);
      exactResults.push(result);
      assert.deepEqual(result, { ok: false, code: "storage_failure" });
      assert.equal(invalidHandlerClaimCalls, 0);
    }
    assert.equal(handlerEntryAccessorCalls, 0);
    assert.equal(handlerIdAccessorCalls, 0);
    assert.equal(handlerHandleAccessorCalls, 0);
    assert.equal(handlerProxyTraps, 0);
    assert.equal(handlerProxyCallableCalls, 0);

    const queueMethodNames = ["claimKind", "failOwned", "succeedOwned"] as const;
    let queueAccessorCalls = 0;
    let queueProxyTraps = 0;
    let queueProxyCallableCalls = 0;
    for (const methodName of queueMethodNames) {
      for (const invalidMode of ["missing", "inherited", "accessor", "noncallable", "proxy", "proxy-callable"] as const) {
        let invalidQueueClaimCalls = 0;
        const ownQueue: Record<string, unknown> = {
          claimKind: async () => {
            invalidQueueClaimCalls += 1;
            return { code: "no_job" as const };
          },
          failOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
          succeedOwned: async () => ({ ok: false as const, code: "storage_failure" as const }),
        };
        let queue: unknown = ownQueue;
        if (invalidMode === "missing") delete ownQueue[methodName];
        if (invalidMode === "inherited") {
          const inherited = ownQueue[methodName];
          delete ownQueue[methodName];
          queue = Object.assign(Object.create({ [methodName]: inherited }), ownQueue);
        }
        if (invalidMode === "accessor") {
          Object.defineProperty(ownQueue, methodName, {
            enumerable: true,
            get: () => {
              queueAccessorCalls += 1;
              return async () => ({ code: "no_job" });
            },
          });
        }
        if (invalidMode === "noncallable") ownQueue[methodName] = "queue-value-must-not-echo";
        if (invalidMode === "proxy") {
          queue = new Proxy(ownQueue, {
            getOwnPropertyDescriptor: () => {
              queueProxyTraps += 1;
              throw new Error("queue-proxy-must-not-echo");
            },
          });
        }
        if (invalidMode === "proxy-callable") {
          ownQueue[methodName] = new Proxy(async () => ({ code: "no_job" }), {
            apply: async () => {
              queueProxyCallableCalls += 1;
              return { code: "no_job" };
            },
          });
        }
        const result = await runOneKindDelivery(makeDeliveryInput({ queue }) as never);
        exactResults.push(result);
        assert.deepEqual(result, { ok: false, code: "storage_failure" });
        assert.equal(invalidQueueClaimCalls, 0);
      }
    }
    assert.equal(queueAccessorCalls, 0);
    assert.equal(queueProxyTraps, 0);
    assert.equal(queueProxyCallableCalls, 0);

    const mutableRegistry: Record<string, unknown> = { [C3_SCOPED_PROBE_KIND]: registry[C3_SCOPED_PROBE_KIND] };
    let successHandlerCalls = 0;
    const mutableHandler: Record<string, unknown> = {
      idempotencyKey: "job_id",
      handle: async function () {
        assert.equal(this, mutableHandler);
        successHandlerCalls += 1;
      },
    };
    let snapshottedSucceedCalls = 0;
    let mutatedSucceedCalls = 0;
    const snapshotQueue: Record<string, unknown> = {
      claimKind: async function () {
        assert.equal(this, snapshotQueue);
        mutableRegistry[C3_SCOPED_PROBE_KIND] = { version: "invalid" };
        mutableHandler.handle = async () => {
          throw new Error("mutated-handler-must-not-run");
        };
        snapshotQueue.succeedOwned = async () => {
          mutatedSucceedCalls += 1;
          return { ok: false, code: "storage_failure" };
        };
        return { code: "claimed", job: makeLoopJob(C3_SCOPED_PROBE_KIND) };
      },
      failOwned: async () => ({ ok: false, code: "storage_failure" }),
      succeedOwned: async function () {
        assert.equal(this, snapshotQueue);
        snapshottedSucceedCalls += 1;
        return { ok: true };
      },
    };
    const snapshottedSuccess = await runOneKindDelivery(makeDeliveryInput({
      registry: mutableRegistry,
      handlers: { [C3_SCOPED_PROBE_KIND]: mutableHandler },
      queue: snapshotQueue,
    }) as never);
    exactResults.push(snapshottedSuccess);
    assert.deepEqual(snapshottedSuccess, { ok: true, code: "job_succeeded" });
    assert.equal(successHandlerCalls, 1);
    assert.equal(snapshottedSucceedCalls, 1);
    assert.equal(mutatedSucceedCalls, 0);

    let snapshottedFailCalls = 0;
    let mutatedFailCalls = 0;
    const throwingHandler: Record<string, unknown> = {
      idempotencyKey: "job_id",
      handle: async () => {
        throw new Error("handler-secret-must-not-echo");
      },
    };
    const failureSnapshotQueue: Record<string, unknown> = {
      claimKind: async function () {
        assert.equal(this, failureSnapshotQueue);
        failureSnapshotQueue.failOwned = async () => {
          mutatedFailCalls += 1;
          return { ok: false, code: "storage_failure" };
        };
        return { code: "claimed", job: makeLoopJob(C3_SCOPED_PROBE_KIND) };
      },
      failOwned: async function () {
        assert.equal(this, failureSnapshotQueue);
        snapshottedFailCalls += 1;
        return { ok: true, code: "retry_scheduled", availableAt: new Date(FIXED_NOW) };
      },
      succeedOwned: async () => ({ ok: false, code: "storage_failure" }),
    };
    const snapshottedFailure = await runOneKindDelivery(makeDeliveryInput({
      handlers: { [C3_SCOPED_PROBE_KIND]: throwingHandler },
      queue: failureSnapshotQueue,
    }) as never);
    exactResults.push(snapshottedFailure);
    assert.deepEqual(snapshottedFailure, { ok: true, code: "job_retry_scheduled" });
    assert.equal(snapshottedFailCalls, 1);
    assert.equal(mutatedFailCalls, 0);

    const mutableSuccessJob = makeLoopJob(C3_SCOPED_PROBE_KIND);
    const successJobIdentity = {
      id: mutableSuccessJob.id,
      kind: mutableSuccessJob.kind,
      leaseToken: mutableSuccessJob.leaseToken,
    };
    let mutableSuccessHandlerCalls = 0;
    let mutableSuccessFailCalls = 0;
    let mutableSuccessSucceedCalls = 0;
    const mutableSuccessQueue = {
      claimKind: async () => ({ code: "claimed" as const, job: mutableSuccessJob }),
      failOwned: async () => {
        mutableSuccessFailCalls += 1;
        return { ok: false as const, code: "storage_failure" as const };
      },
      succeedOwned: async (options: unknown) => {
        mutableSuccessSucceedCalls += 1;
        assert.deepEqual(options, { jobId: successJobIdentity.id, leaseToken: successJobIdentity.leaseToken });
        return { ok: true as const };
      },
    };
    const mutationSafeSuccess = await runOneKindDelivery(makeDeliveryInput({
      queue: mutableSuccessQueue,
      handlers: {
        [C3_SCOPED_PROBE_KIND]: {
          idempotencyKey: "job_id",
          handle: async ({ idempotencyKey }: { idempotencyKey: string }) => {
            mutableSuccessHandlerCalls += 1;
            assert.equal(idempotencyKey, successJobIdentity.id);
            mutableSuccessJob.id = "job_mutated-id-must-not-echo";
            mutableSuccessJob.kind = "foreign_probe";
            mutableSuccessJob.leaseToken = "mutated-lease-token-must-not-echo";
            mutableSuccessJob.payloadJson = '{"operation":"inspect"}';
            mutableSuccessJob.payloadHash = "f".repeat(64);
          },
        },
      },
    }) as never);
    exactResults.push(mutationSafeSuccess);
    assert.deepEqual(mutationSafeSuccess, { ok: true, code: "job_succeeded" });
    assert.equal(successJobIdentity.kind, C3_SCOPED_PROBE_KIND);
    assert.equal(mutableSuccessHandlerCalls, 1);
    assert.equal(mutableSuccessFailCalls, 0);
    assert.equal(mutableSuccessSucceedCalls, 1);

    const mutableFailureJob = makeLoopJob(C3_SCOPED_PROBE_KIND);
    const failureJobIdentity = {
      id: mutableFailureJob.id,
      kind: mutableFailureJob.kind,
      leaseToken: mutableFailureJob.leaseToken,
    };
    let mutableFailureFailCalls = 0;
    let mutableFailureSucceedCalls = 0;
    const mutableFailureQueue = {
      claimKind: async () => ({ code: "claimed" as const, job: mutableFailureJob }),
      failOwned: async (options: unknown) => {
        mutableFailureFailCalls += 1;
        assert.deepEqual(options, {
          jobId: failureJobIdentity.id,
          leaseToken: failureJobIdentity.leaseToken,
          lastError: "handler_failed",
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          jitterEntropy: 0.5,
        });
        return { ok: true as const, code: "retry_scheduled" as const, availableAt: new Date(FIXED_NOW) };
      },
      succeedOwned: async () => {
        mutableFailureSucceedCalls += 1;
        return { ok: false as const, code: "storage_failure" as const };
      },
    };
    const mutationSafeFailure = await runOneKindDelivery(makeDeliveryInput({
      queue: mutableFailureQueue,
      handlers: {
        [C3_SCOPED_PROBE_KIND]: {
          idempotencyKey: "job_id",
          handle: async ({ idempotencyKey }: { idempotencyKey: string }) => {
            assert.equal(idempotencyKey, failureJobIdentity.id);
            mutableFailureJob.id = "job_mutated-failure-id-must-not-echo";
            mutableFailureJob.kind = "foreign_probe";
            mutableFailureJob.leaseToken = "mutated-failure-lease-must-not-echo";
            throw new Error("mutated-handler-error-must-not-echo");
          },
        },
      },
    }) as never);
    exactResults.push(mutationSafeFailure);
    assert.deepEqual(mutationSafeFailure, { ok: true, code: "job_retry_scheduled" });
    assert.equal(failureJobIdentity.kind, C3_SCOPED_PROBE_KIND);
    assert.equal(mutableFailureFailCalls, 1);
    assert.equal(mutableFailureSucceedCalls, 0);

    let mismatchHandlerCalls = 0;
    let mismatchFailCalls = 0;
    let mismatchSucceedCalls = 0;
    let recoverExpiredCalls = 0;
    const mismatchQueue = {
      claimKind: async (options: unknown) => {
        assert.deepEqual(options, { kind: C3_SCOPED_PROBE_KIND, leaseDurationMs: 60_000 });
        return { code: "claimed" as const, job: makeLoopJob("foreign_probe") };
      },
      failOwned: async () => {
        mismatchFailCalls += 1;
        return { ok: false as const, code: "storage_failure" as const };
      },
      succeedOwned: async () => {
        mismatchSucceedCalls += 1;
        return { ok: false as const, code: "storage_failure" as const };
      },
      recoverExpired: async () => {
        recoverExpiredCalls += 1;
        return { ok: true as const, recovered: false as const };
      },
    };
    const mismatch = await runOneKindDelivery(makeDeliveryInput({
      queue: mismatchQueue,
      handlers: {
        [C3_SCOPED_PROBE_KIND]: {
          idempotencyKey: "job_id",
          handle: async () => {
            mismatchHandlerCalls += 1;
          },
        },
      },
    }) as never);
    exactResults.push(mismatch);
    assert.deepEqual(mismatch, { ok: false, code: "storage_failure" });
    assert.equal(mismatchHandlerCalls, 0);
    assert.equal(mismatchFailCalls, 0);
    assert.equal(mismatchSucceedCalls, 0);
    assert.equal(recoverExpiredCalls, 0);

    const fixtureRoot = mkdtempSync(join(tmpdir(), "applied-loop-a8c2-cg2-"));
    const databasePath = join(fixtureRoot, "disposable.db");
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`,
        DOTENV_CONFIG_PATH: join(fixtureRoot, "dotenv-never-exists"),
      },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = makeClient(databasePath);
    try {
      const queue = createLoopJobQueue({ client, registry, clock: clockAt(FIXED_NOW), randomBytes: entropy(190) });
      const foreign = await queue.enqueue({
        kind: "foreign_probe",
        payload: { operation: "inspect" },
        maxAttempts: 3,
        availableAt: new Date(FIXED_NOW.getTime() - 2_000),
      });
      const hCycle = await queue.enqueue({
        kind: C3_SCOPED_PROBE_KIND,
        payload: {
          hypothesis: "h_cycle",
          cadence: "weekly",
          targetWeekKey: "2026-W35",
          policyVersion: "h_cycle_evidence_v1",
          projectionSchemaVersion: "h_cycle_evidence_preview_v1",
        },
        maxAttempts: 3,
        availableAt: new Date(FIXED_NOW.getTime() - 1_000),
      });
      assert.equal(foreign.ok, true);
      assert.equal(hCycle.ok, true);
      if (!foreign.ok || !hCycle.ok) assert.fail("fixture enqueue failed");
      const foreignBefore = snapshotJob(await client.loopJob.findUniqueOrThrow({ where: { id: foreign.job.id } }));
      const handledPayloads: unknown[] = [];
      let fixtureRecoverCalls = 0;
      const observedQueue = {
        ...queue,
        recoverExpired: async () => {
          fixtureRecoverCalls += 1;
          return queue.recoverExpired();
        },
      };
      const delivered = await runOneKindDelivery({
        kind: C3_SCOPED_PROBE_KIND,
        queue: observedQueue,
        registry,
        handlers: {
          [C3_SCOPED_PROBE_KIND]: {
            idempotencyKey: "job_id",
            handle: async ({ idempotencyKey, payload }) => {
              assert.equal(idempotencyKey, hCycle.job.id);
              handledPayloads.push(payload);
            },
          },
        },
        leaseDurationMs: 60_000,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        jitterEntropy: 0.5,
      });
      exactResults.push(delivered);
      assert.deepEqual(delivered, { ok: true, code: "job_succeeded" });
      assert.equal(handledPayloads.length, 1);
      assert.equal(fixtureRecoverCalls, 0);
      assert.deepEqual(
        snapshotJob(await client.loopJob.findUniqueOrThrow({ where: { id: foreign.job.id } })),
        foreignBefore,
      );
      const none = await runOneKindDelivery({
        kind: C3_SCOPED_PROBE_KIND,
        queue: observedQueue,
        registry,
        handlers: { [C3_SCOPED_PROBE_KIND]: validHandler },
        leaseDurationMs: 60_000,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        jitterEntropy: 0.5,
      });
      exactResults.push(none);
      assert.deepEqual(none, { ok: true, code: "no_job" });
      assert.equal(fixtureRecoverCalls, 0);
      assert.deepEqual(
        snapshotJob(await client.loopJob.findUniqueOrThrow({ where: { id: foreign.job.id } })),
        foreignBefore,
      );
    } finally {
      await client.$disconnect();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }

    for (const result of exactResults) assertExactDeliveryResult(result);
    assert.equal(JSON.stringify(exactResults).includes("must-not-echo"), false);
    assert.equal(JSON.stringify(exactResults).includes(C3_SCOPED_PROBE_KIND), false);
    assert.equal(JSON.stringify(exactResults).includes("foreign_probe"), false);
  });

  test("A8C2-CG3-T1 scoped one-shot capability remains unreachable by default", async () => {
    const baseSha = "9a551964240c67a1123c48ae0ab59aa1beca28ba";
    const protectedTreeEntryCount = 603;
    const protectedTreeSha256 = "20fed7356656c4a2ded1080fe6b3455fdbe547f23d0ae328c1927b474de9eb1c";
    const allowedPaths = [
      "docs/adr/0033-h-cycle-generation-fenced-execution.md",
      "docs/adr/0034-h-cycle-sqlite-write-transaction-primitive.md",
      "docs/adr/0035-harness-evaluation-next-action-proposals.md",
      "docs/phase-progress.md",
      "prisma/migrations/20260826100000_h_cycle_generation_scoped_execution/migration.sql",
      "prisma/schema.prisma",
      "src/lib/h-cycle-evaluation-record.ts",
      "src/lib/loop-jobs/raw-state-adapter.ts",
      "src/lib/loop-jobs/state-machine.ts",
      "src/lib/loop-jobs/delivery.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-one-shot-kind-isolation-v1.test.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.test.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.test.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-disable-child.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.test.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.ts",
      "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
      "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
      "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.test.ts",
      "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts",
    ].sort();
    const allowedPathSet = new Set(allowedPaths);
    const allowedPathBuffers = allowedPaths.map((path) => Buffer.from(path, "utf8"));
    const runGit = (args: readonly string[], encoding: "buffer" | "utf8" = "utf8") => {
      const result = spawnSync("git", [...args], { cwd: process.cwd(), encoding });
      assert.equal(result.error, undefined, `git ${args[0]} must start`);
      assert.equal(result.signal, null, `git ${args[0]} must not be signalled`);
      return result;
    };
    const splitNulRecords = (output: Buffer): Buffer[] => {
      const records: Buffer[] = [];
      let cursor = 0;
      for (let index = 0; index < output.length; index += 1) {
        if (output[index] !== 0) continue;
        if (index > cursor) records.push(output.subarray(cursor, index));
        cursor = index + 1;
      }
      assert.equal(cursor, output.length, "Git -z output must end with NUL");
      return records;
    };
    const decodeGitPath = (rawPath: Buffer): string => {
      const decoded = rawPath.toString("utf8");
      assert.equal(
        Buffer.from(decoded, "utf8").equals(rawPath),
        true,
        `non-UTF8 Git path forbidden: ${rawPath.toString("hex")}`,
      );
      return decoded;
    };
    const gitNulPathRecords = (args: readonly string[]): Buffer[] => {
      const result = runGit(args, "buffer");
      assert.equal(result.status, 0, String(result.stderr));
      return splitNulRecords(result.stdout as Buffer);
    };
    const gitNulPaths = (args: readonly string[]): string[] => {
      return gitNulPathRecords(args).map(decodeGitPath);
    };
    const untrackedPaths = gitNulPaths(["ls-files", "--others", "--exclude-standard", "-z"]);
    const frozenReviewSupportArtifacts = new Map<string, string>([
      [
        "docs/plans/2026-08-26-a8-c3-generation-fenced-execution.md",
        "077242bf56f1549b2df47c8b5a9a733da75641f8958b48a15282bcf7542b5eb0",
      ],
      [
        "docs/plans/2026-08-26-a8-c3p-sqlite-transaction-primitive.md",
        "95fa7af479d56b9000cd42a5676f1f8b3207633ab60ab84ea819ba308d6866de",
      ],
    ]);
    const exactNonImplementationSupportPaths = new Set([
      "docs/plans/2026-08-24-a8-c2-one-shot-observability.md",
      ...frozenReviewSupportArtifacts.keys(),
    ]);
    assert.deepEqual(
      untrackedPaths.filter((path) => !allowedPathSet.has(path) && !exactNonImplementationSupportPaths.has(path)),
      [],
      "untracked paths must be an exact allowed implementation path or the exact frozen design support path",
    );
    for (const [path, expectedSha256] of frozenReviewSupportArtifacts) {
      if (!untrackedPaths.includes(path)) continue;
      assert.equal(
        createHash("sha256").update(readFileSync(join(process.cwd(), path))).digest("hex"),
        expectedSha256,
        `${path} must retain its independently reviewed bytes when present locally`,
      );
    }
    const untrackedImplementation = untrackedPaths.filter((path) => allowedPathSet.has(path));

    type ProtectedTreeEvidence = Readonly<{
      mode: "protected_tree_digest";
      entryCount: number;
      sha256: string;
    }>;
    const inspectProtectedTree = (): ProtectedTreeEvidence => {
      const unstagedPaths = gitNulPaths(["diff", "--name-only", "-z", "--"]);
      assert.deepEqual(
        unstagedPaths.filter((path) => !allowedPathSet.has(path)),
        [],
        "fallback must reject unstaged changes outside the exact allowed surface",
      );

      const indexResult = runGit(["ls-files", "--stage", "-z"], "buffer");
      assert.equal(indexResult.status, 0, String(indexResult.stderr));
      const protectedEntries = splitNulRecords(indexResult.stdout as Buffer)
        .map((record) => {
          const firstSpace = record.indexOf(0x20);
          const secondSpace = record.indexOf(0x20, firstSpace + 1);
          const tab = record.indexOf(0x09, secondSpace + 1);
          assert.equal(firstSpace, 6, `unexpected index mode field: ${record.toString("hex")}`);
          assert.ok(secondSpace > firstSpace && tab === secondSpace + 2, `unexpected index metadata: ${record.toString("hex")}`);
          const mode = record.subarray(0, firstSpace);
          const oid = record.subarray(firstSpace + 1, secondSpace);
          const stage = record.subarray(secondSpace + 1, tab);
          const path = record.subarray(tab + 1);
          assert.match(mode.toString("ascii"), /^\d{6}$/);
          assert.match(oid.toString("ascii"), /^[0-9a-f]{40,64}$/);
          assert.equal(stage.equals(Buffer.from("0", "ascii")), true, `unmerged index entry forbidden: ${decodeGitPath(path)}`);
          decodeGitPath(path);
          return { mode, oid, path };
        })
        .filter((entry) => !allowedPathBuffers.some((allowedPath) => allowedPath.equals(entry.path)));
      const normalized = Buffer.concat(protectedEntries.map((entry) =>
        Buffer.concat([entry.mode, Buffer.from(" "), entry.oid, Buffer.from("\t"), entry.path, Buffer.from("\0")])));
      const evidence = Object.freeze({
        mode: "protected_tree_digest" as const,
        entryCount: protectedEntries.length,
        sha256: createHash("sha256").update(normalized).digest("hex"),
      });
      assert.deepEqual(evidence, {
        mode: "protected_tree_digest",
        entryCount: protectedTreeEntryCount,
        sha256: protectedTreeSha256,
      });
      return evidence;
    };
    type BaseCommitAvailability = "available" | "unavailable";
    const probeBaseCommitAvailability = (): BaseCommitAvailability => {
      const baseProbe = runGit(["cat-file", "-e", `${baseSha}^{commit}`]);
      const stderr = String(baseProbe.stderr);
      if (baseProbe.status === 0) {
        assert.equal(stderr, "", "available base probe must not emit stderr");
        return "available";
      }
      assert.equal(baseProbe.status, 128, stderr);
      assert.match(
        stderr,
        new RegExp(`^fatal: Not a valid object name ${baseSha}\\^\\{commit\\}\\r?\\n?$`),
        "fallback is allowed only for the exact unavailable base object",
      );
      return "unavailable";
    };
    const inspectImplementationScope = (simulateBaseUnavailable = false) => {
      const baseAvailability: BaseCommitAvailability = simulateBaseUnavailable
        ? "unavailable"
        : probeBaseCommitAvailability();

      if (baseAvailability === "available") {
        const trackedChanges = gitNulPaths(["diff", "--name-only", "-z", baseSha, "--"]);
        const implementationChanges = [...new Set([...trackedChanges, ...untrackedImplementation])].sort();
        assert.deepEqual(
          implementationChanges,
          allowedPaths,
          "all historical and C3a/C3p/C3b/C3c/evaluation-contract/report static compatibility paths must be classified",
        );
        return Object.freeze({ mode: "base_diff" as const, baseSha, paths: implementationChanges });
      }
      return inspectProtectedTree();
    };

    const independentBaseAvailability = probeBaseCommitAvailability();
    const scopeEvidence = inspectImplementationScope();
    assert.deepEqual(
      scopeEvidence,
      independentBaseAvailability === "available"
        ? { mode: "base_diff", baseSha, paths: allowedPaths }
        : { mode: "protected_tree_digest", entryCount: protectedTreeEntryCount, sha256: protectedTreeSha256 },
      "normal checkout must select exactly the independently observed scope proof",
    );
    assert.deepEqual(
      inspectImplementationScope(true),
      {
        mode: "protected_tree_digest",
        entryCount: protectedTreeEntryCount,
        sha256: protectedTreeSha256,
      },
      "simulated shallow checkout must execute the pinned protected-tree proof",
    );

    type SnippetSpec = Readonly<{
      label: string;
      begin: string;
      end: string;
      leading: string;
      trailing: string;
      sha256: string;
    }>;
    type C3RegionSpec = Readonly<{
      path: string;
      label: string;
      parentBegin?: string;
      parentEnd?: string;
      begin: string;
      end: string;
      leading: string;
      trailing: string;
      sha256: string;
    }>;
    const protectedRuntime: ReadonlyArray<Readonly<{
      path: string;
      baseSha256: string;
      snippets: readonly SnippetSpec[];
    }>> = [
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        baseSha256: "a4e0d301647e61a639af7b4ab110d06af91d596bc4ecf35a29f87a0c33ddc5ff",
        snippets: [{
          label: "single-kind raw claim",
          begin: "// A8-C2 BEGIN: single-kind raw claim",
          end: "// A8-C2 END: single-kind raw claim",
          leading: "",
          trailing: "\n\n",
          sha256: "b6fe07536a1a7b0aeb0435a461fd3c0fef30083b0cb094196b354bd0e3ff6c4b",
        }],
      },
      {
        path: "src/lib/loop-jobs/state-machine.ts",
        baseSha256: "b682d057d2c7617434229cba0eb5cad555cbc07fcba4071b930a546b4ab73001",
        snippets: [
          {
            label: "single-kind raw claim import",
            begin: "// A8-C2 BEGIN: single-kind raw claim import",
            end: "// A8-C2 END: single-kind raw claim import",
            leading: "",
            trailing: "\n\n",
            sha256: "4ab8ea519b5cec723e2dcd1d9b7c5be98706a2125e945462ca1ae224e9172721",
          },
          {
            label: "queue claimKind method",
            begin: "    // A8-C2 BEGIN: queue claimKind method",
            end: "    // A8-C2 END: queue claimKind method",
            leading: "",
            trailing: "\n\n",
            sha256: "f75b1a2d62b42f5947a193b92d1c9f4022f64c44c673aa72fe09cfd6795e7673",
          },
        ],
      },
      {
        path: "src/lib/loop-jobs/delivery.ts",
        baseSha256: "4062126950275118d7ee2d5f772e9a05926c2fda67ec8e48d94142ad3e80bc67",
        snippets: [
          {
            label: "scoped capability snapshot helpers",
            begin: "// A8-C2 BEGIN: scoped capability snapshot helpers",
            end: "// A8-C2 END: scoped capability snapshot helpers",
            leading: "",
            trailing: "\n\n",
            sha256: "5b9140eb5d872fd8ad14d0a35e28ac92f9a000dc6b18db62a1d128a727c64030",
          },
          {
            label: "runOneKindDelivery",
            begin: "// A8-C2 BEGIN: runOneKindDelivery",
            end: "// A8-C2 END: runOneKindDelivery",
            leading: "\n",
            trailing: "\n",
            sha256: "31a44b63d35e385b0c87513af0805c571aaaf3cc9379a1f6becdacc4dd09000e",
          },
        ],
      },
    ];

    // C3b explicitly freezes every generic reserved-kind fence. A region may
    // be nested in a C2 snippet or be source-level; the latter must prove that
    // it is outside every C2 snippet so it cannot silently expand a C2 delta.
    const c3RegionManifest: readonly C3RegionSpec[] = [
      {
        path: "prisma/schema.prisma",
        label: "LoopJob execution generation metadata",
        begin: "// A8-C3 BEGIN: LoopJob execution generation metadata",
        end: "// A8-C3 END: LoopJob execution generation metadata",
        leading: "  ",
        trailing: "\n",
        sha256: "20a0b4df160e430dd0132f071ebf9115b1aa8ee5f38723197e84a61d2a6cc555",
      },
      {
        path: "prisma/schema.prisma",
        label: "LoopJob execution generation indexes",
        begin: "// A8-C3 BEGIN: LoopJob execution generation indexes",
        end: "// A8-C3 END: LoopJob execution generation indexes",
        leading: "  ",
        trailing: "\n",
        sha256: "daea4933f94fb602b63e084e80b8bde74a8e3219c517de22a41fbed95cfc5354",
      },
      {
        path: "prisma/schema.prisma",
        label: "HCycle activation execution jobs relation",
        begin: "// A8-C3 BEGIN: HCycle activation execution jobs relation",
        end: "// A8-C3 END: HCycle activation execution jobs relation",
        leading: "  ",
        trailing: "\n",
        sha256: "cbe3421cd0b7730a73fe4d8707bb6da4529ed7e1ca4b406d83d48e3ef3cc364c",
      },
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        label: "generic raw claim candidate reserved-kind fence",
        begin: "-- A8-C3 BEGIN: generic raw claim candidate reserved-kind fence",
        end: "-- A8-C3 END: generic raw claim candidate reserved-kind fence",
        leading: "        ",
        trailing: "\n",
        sha256: "d5551e6a9a3e7d2c91166203c19aba2737c03a6dc0255d82202b90b01a3ee67f",
      },
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        label: "generic raw claim outer reserved-kind fence",
        begin: "-- A8-C3 BEGIN: generic raw claim outer reserved-kind fence",
        end: "-- A8-C3 END: generic raw claim outer reserved-kind fence",
        leading: "      ",
        trailing: "\n",
        sha256: "28e6c27eccc6af5388351baa14974e2d9192662f38453c15ad54e5835200bc0d",
      },
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        label: "generic renew reserved-kind fence",
        begin: "-- A8-C3 BEGIN: generic renew reserved-kind fence",
        end: "-- A8-C3 END: generic renew reserved-kind fence",
        leading: "      ",
        trailing: "\n",
        sha256: "f3634a8bbe6be5f554f23310666fa850e28a321d20398d9018a376f93dbbd355",
      },
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        label: "generic recovery candidate reserved-kind fence",
        begin: "-- A8-C3 BEGIN: generic recovery candidate reserved-kind fence",
        end: "-- A8-C3 END: generic recovery candidate reserved-kind fence",
        leading: "        ",
        trailing: "\n",
        sha256: "0a78b07451654cf76e10404ae02e8262d3a342ca00e285c6cbdf665487954b11",
      },
      {
        path: "src/lib/loop-jobs/raw-state-adapter.ts",
        label: "generic recovery outer reserved-kind fence",
        begin: "-- A8-C3 BEGIN: generic recovery outer reserved-kind fence",
        end: "-- A8-C3 END: generic recovery outer reserved-kind fence",
        leading: "      ",
        trailing: "\n",
        sha256: "aa751bbbb35fe888a253697cf6f15fa7048ab4cb4486cd126c1618d7506e537f",
      },
      {
        path: "src/lib/loop-jobs/state-machine.ts",
        label: "generic owned mutation reserved-kind fence",
        begin: "// A8-C3 BEGIN: generic owned mutation reserved-kind fence",
        end: "// A8-C3 END: generic owned mutation reserved-kind fence",
        leading: "    ",
        trailing: "\n",
        sha256: "7e169d807992dc7664d686d338ac79fc277657b1a9e9d8359b712d1845daed04",
      },
      {
        path: "src/lib/loop-jobs/state-machine.ts",
        label: "generic queue enqueue reserved-kind fence",
        begin: "// A8-C3 BEGIN: generic queue enqueue reserved-kind fence",
        end: "// A8-C3 END: generic queue enqueue reserved-kind fence",
        leading: "      ",
        trailing: "\n",
        sha256: "e3931c84f0c2b3db0a3ea938fb5c620c5c847bae348d474834e95a1f51c838e9",
      },
      {
        path: "src/lib/loop-jobs/state-machine.ts",
        label: "generic queue claimKind reserved-kind fence",
        parentBegin: "    // A8-C2 BEGIN: queue claimKind method",
        parentEnd: "    // A8-C2 END: queue claimKind method",
        begin: "// A8-C3 BEGIN: generic queue claimKind reserved-kind fence",
        end: "// A8-C3 END: generic queue claimKind reserved-kind fence",
        leading: "        ",
        trailing: "\n",
        sha256: "556d6b14c3bb40056a6bafe427ed942adb063a24d82808ff22c4016ef1c7ad61",
      },
      {
        path: "src/lib/loop-jobs/delivery.ts",
        label: "generic delivery reserved-kind post-claim fence",
        begin: "// A8-C3 BEGIN: generic delivery reserved-kind post-claim fence",
        end: "// A8-C3 END: generic delivery reserved-kind post-claim fence",
        leading: "  ",
        trailing: "\n",
        sha256: "333a51cda70a9b1b95a931cba06a3ef545a3ea86b22392887dfcabe4d2c4c682",
      },
      {
        path: "src/lib/loop-jobs/delivery.ts",
        label: "kind-isolated delivery reserved-kind pre-claim fence",
        parentBegin: "// A8-C2 BEGIN: runOneKindDelivery",
        parentEnd: "// A8-C2 END: runOneKindDelivery",
        begin: "// A8-C3 BEGIN: kind-isolated delivery reserved-kind pre-claim fence",
        end: "// A8-C3 END: kind-isolated delivery reserved-kind pre-claim fence",
        leading: "    ",
        trailing: "\n",
        sha256: "9166b8753fa723d9ac6390a812504c4f95db51908203ddde325775d604a159d6",
      },
    ];
    type C3CommentToken = Readonly<{ text: string; start: number; end: number }>;
    const c3CommentTokens = (source: string): readonly C3CommentToken[] => {
      const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, source);
      const tokens: C3CommentToken[] = [];
      while (true) {
        const kind = scanner.scan();
        if (kind === ts.SyntaxKind.EndOfFileToken) break;
        if (kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const text = scanner.getTokenText();
        if (!text.includes("A8-C3")) continue;
        const start = scanner.getTokenPos();
        tokens.push(Object.freeze({ text, start, end: start + text.length }));
      }
      // TypeScript's scanner currently skips comment trivia embedded in some
      // template-literal paths, so retain its token walk and add an anchored
      // line scan for the exact `//` and SQL `--` marker grammars.
      const lineMarker = /^[\t ]*((?:\/\/|--) A8-C3 (?:BEGIN|END): [^\r\n]+)$/gm;
      for (let match = lineMarker.exec(source); match; match = lineMarker.exec(source)) {
        const text = match[1];
        assert.notEqual(text, undefined, "C3 marker capture must exist");
        const start = match.index + match[0].indexOf(text);
        if (tokens.some((token) => token.start === start && token.text === text)) continue;
        tokens.push(Object.freeze({ text, start, end: start + text.length }));
      }
      return tokens.sort((left, right) => left.start - right.start);
    };
    const projectC3Regions = (
      source: string,
      path: string,
      parentSnippets: readonly Pick<SnippetSpec, "begin" | "end">[],
      regions: readonly C3RegionSpec[],
    ): string => {
      const pathRegions = regions.filter((region) => region.path === path);
      const expectedMarkers = pathRegions.flatMap((region) => [region.begin, region.end]).sort();
      assert.equal(new Set(expectedMarkers).size, expectedMarkers.length, `${path}: C3 marker literals must be unique`);
      const actualTokens = c3CommentTokens(source);
      assert.deepEqual(
        actualTokens.map((token) => token.text).sort(),
        expectedMarkers,
        `${path}: C3 markers must be exact single-line comment tokens declared by the manifest`,
      );
      const tokenByText = new Map(actualTokens.map((token) => [token.text, token]));
      assert.equal(tokenByText.size, actualTokens.length, `${path}: actual C3 marker tokens must be unique`);

      const intervals: Array<Readonly<{ start: number; end: number; label: string }>> = [];
      for (const region of pathRegions) {
        assert.equal(
          (region.parentBegin === undefined) === (region.parentEnd === undefined),
          true,
          `${path}: ${region.label} parent declaration must be complete or absent`,
        );
        const beginToken = tokenByText.get(region.begin);
        const endToken = tokenByText.get(region.end);
        assert.ok(beginToken && endToken, `${path}: ${region.label} must have both actual comment tokens`);
        assert.ok(beginToken.start < endToken.start, `${path}: ${region.label} C3 marker order`);
        const start = beginToken.start - region.leading.length;
        const end = endToken.end + region.trailing.length;
        assert.equal(source.slice(start, beginToken.start), region.leading, `${path}: ${region.label} leading delimiter`);
        assert.equal(source.slice(endToken.end, end), region.trailing, `${path}: ${region.label} trailing delimiter`);
        if (region.parentBegin !== undefined && region.parentEnd !== undefined) {
          const parent = parentSnippets.find((snippet) =>
            snippet.begin === region.parentBegin && snippet.end === region.parentEnd,
          );
          assert.ok(parent, `${path}: ${region.label} must name an exact enclosing C2 snippet`);
          assert.equal(source.split(parent.begin).length - 1, 1, `${path}: ${region.label} parent begin count`);
          assert.equal(source.split(parent.end).length - 1, 1, `${path}: ${region.label} parent end count`);
          const parentBegin = source.indexOf(parent.begin);
          const parentEnd = source.indexOf(parent.end, parentBegin + parent.begin.length);
          assert.ok(parentBegin >= 0 && parentEnd > parentBegin, `${path}: ${region.label} parent marker order`);
          assert.ok(start >= parentBegin + parent.begin.length, `${path}: ${region.label} must start inside C2`);
          assert.ok(end <= parentEnd, `${path}: ${region.label} must end inside C2`);
        } else {
          for (const parent of parentSnippets) {
            const parentBegin = source.indexOf(parent.begin);
            const parentEnd = source.indexOf(parent.end, parentBegin + parent.begin.length);
            assert.ok(parentBegin >= 0 && parentEnd > parentBegin, `${path}: source-level parent marker order`);
            assert.equal(
              !(start >= parentBegin && end <= parentEnd),
              true,
              `${path}: ${region.label} nested C3 must name its enclosing C2 snippet`,
            );
          }
        }
        assert.equal(
          createHash("sha256").update(source.slice(start, end)).digest("hex"),
          region.sha256,
          `${path}: ${region.label} frozen C3 region`,
        );
        intervals.push(Object.freeze({ start, end, label: region.label }));
      }
      const ascending = [...intervals].sort((left, right) => left.start - right.start);
      for (let index = 1; index < ascending.length; index += 1) {
        assert.ok(ascending[index - 1].end <= ascending[index].start, `${path}: C3 regions must not overlap`);
      }
      let projected = source;
      for (const interval of [...intervals].sort((left, right) => right.start - left.start)) {
        projected = projected.slice(0, interval.start) + projected.slice(interval.end);
      }
      return projected;
    };

    const c3FixturePath = "src/lib/loop-jobs/delivery.ts";
    const c3FixtureBase = [
      "// A8-C2 BEGIN: fixture parent",
      'const decoy = "// A8-C3 BEGIN: fixture decoy";',
      "// A8-C2 END: fixture parent",
      "",
    ].join("\n");
    const c3FixtureRegion = [
      "// A8-C3 BEGIN: fixture projection",
      "const c3Only = true;",
      "// A8-C3 END: fixture projection",
      "",
    ].join("\n");
    const c3FixtureSource = c3FixtureBase.replace(
      "// A8-C2 END: fixture parent\n",
      `${c3FixtureRegion}// A8-C2 END: fixture parent\n`,
    );
    assert.equal(
      projectC3Regions(
        c3FixtureSource,
        c3FixturePath,
        [{ begin: "// A8-C2 BEGIN: fixture parent", end: "// A8-C2 END: fixture parent" }],
        [{
          path: c3FixturePath,
          label: "fixture projection",
          parentBegin: "// A8-C2 BEGIN: fixture parent",
          parentEnd: "// A8-C2 END: fixture parent",
          begin: "// A8-C3 BEGIN: fixture projection",
          end: "// A8-C3 END: fixture projection",
          leading: "",
          trailing: "\n",
          sha256: "0b46055eec3170cbbdb715ba8b3e96e3f27ff44fbc5013c79ef30ec6caf5119c",
        }],
      ),
      c3FixtureBase,
      "C3 projection must remove only declared actual-comment regions and reconstruct C2 bytes",
    );

    const c3ProjectedSchema = projectC3Regions(
      readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8"),
      "prisma/schema.prisma",
      [],
      c3RegionManifest,
    );
    const a8c1SchemaStart = c3ProjectedSchema.indexOf("// A8-C1: redacted control facts only.");
    const a8c1SchemaEnd = c3ProjectedSchema.indexOf("// 学び", a8c1SchemaStart);
    assert.ok(a8c1SchemaStart >= 0 && a8c1SchemaEnd > a8c1SchemaStart, "C3-projected A8-C1 schema block");
    assert.equal(
      createHash("sha256")
        .update(c3ProjectedSchema.slice(0, a8c1SchemaStart) + c3ProjectedSchema.slice(a8c1SchemaEnd), "utf8")
        .digest("hex"),
      "e119fa710fbe71648ef1389a36a5fb64fa06926a30b4d6b64526aa4e884251ae",
      "C3 schema projection must reconstruct the pre-A8-C1 schema bytes",
    );

    const allAdditions: string[] = [];
    for (const runtime of protectedRuntime) {
      const source = projectC3Regions(
        readFileSync(join(process.cwd(), runtime.path), "utf8"),
        runtime.path,
        runtime.snippets,
        c3RegionManifest,
      );
      let cursor = 0;
      let reconstructed = "";
      for (const snippet of runtime.snippets) {
        assert.equal(source.split(snippet.begin).length - 1, 1, `${snippet.label} begin marker count`);
        assert.equal(source.split(snippet.end).length - 1, 1, `${snippet.label} end marker count`);
        const markerStart = source.indexOf(snippet.begin);
        const snippetStart = markerStart - snippet.leading.length;
        assert.ok(snippetStart >= cursor, `${snippet.label} marker order/non-overlap`);
        assert.equal(source.slice(snippetStart, markerStart), snippet.leading, `${snippet.label} leading delimiter`);
        const endMarkerStart = source.indexOf(snippet.end, markerStart + snippet.begin.length);
        assert.ok(endMarkerStart > markerStart, `${snippet.label} marker order`);
        const endMarkerEnd = endMarkerStart + snippet.end.length;
        const snippetEnd = endMarkerEnd + snippet.trailing.length;
        assert.equal(source.slice(endMarkerEnd, snippetEnd), snippet.trailing, `${snippet.label} trailing delimiter`);
        const addition = source.slice(snippetStart, snippetEnd);
        assert.equal(createHash("sha256").update(addition).digest("hex"), snippet.sha256, `${snippet.label} frozen addition`);
        reconstructed += source.slice(cursor, snippetStart);
        allAdditions.push(addition);
        cursor = snippetEnd;
      }
      reconstructed += source.slice(cursor);
      assert.equal(
        createHash("sha256").update(reconstructed).digest("hex"),
        runtime.baseSha256,
        `${runtime.path} must reconstruct pre-A8-C2 bytes`,
      );
    }
    assert.equal(protectedRuntime.flatMap((runtime) => runtime.snippets).length, 5);

    const additions = allAdditions.join("\n");
    for (const forbidden of [
      /h[_-]cycle/i,
      /A7-C/,
      /(?:^|[^A-Za-z])(?:llm|cache)(?:[^A-Za-z]|$)/i,
      /promptTokens?|completionTokens?|tokenUsage/i,
      /DATABASE_URL|DOTENV_CONFIG_PATH|process\.env/,
      /PrismaClient|launchd|\.plist/,
    ]) {
      assert.doesNotMatch(additions, forbidden, `new runtime edge forbidden: ${forbidden.source}`);
    }

    const dedicatedTestSource = readFileSync(
      join(process.cwd(), "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-one-shot-kind-isolation-v1.test.ts"),
      "utf8",
    );
    for (const pinnedScopeLiteral of [
      'const baseSha = "9a551964240c67a1123c48ae0ab59aa1beca28ba"',
      "const protectedTreeEntryCount = 603",
      'const protectedTreeSha256 = "20fed7356656c4a2ded1080fe6b3455fdbe547f23d0ae328c1927b474de9eb1c"',
      'gitNulPaths(["diff", "--name-only", "-z", baseSha, "--"])',
      'runGit(["ls-files", "--stage", "-z"], "buffer")',
      "splitNulRecords(indexResult.stdout as Buffer)",
      '.filter((entry) => !allowedPathBuffers.some((allowedPath) => allowedPath.equals(entry.path)))',
      'Buffer.concat([entry.mode, Buffer.from(" "), entry.oid, Buffer.from("\\t"), entry.path, Buffer.from("\\0")])',
      'Buffer.from(decoded, "utf8").equals(rawPath)',
      'const independentBaseAvailability = probeBaseCommitAvailability()',
      "inspectImplementationScope(true)",
    ]) {
      assert.equal(
        dedicatedTestSource.includes(pinnedScopeLiteral),
        true,
        `missing shallow-checkout scope proof: ${pinnedScopeLiteral}`,
      );
    }
    const scopeProofFile = ts.createSourceFile(
      "h-cycle-one-shot-kind-isolation-v1.scope-proof.ts",
      dedicatedTestSource,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    let cg3Callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
    const visitForCg3 = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test" &&
          ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith("A8C2-CG3-T1") &&
          node.arguments[1] && (ts.isArrowFunction(node.arguments[1]) || ts.isFunctionExpression(node.arguments[1]))) {
        cg3Callback = node.arguments[1];
      }
      ts.forEachChild(node, visitForCg3);
    };
    visitForCg3(scopeProofFile);
    assert.ok(cg3Callback && ts.isBlock(cg3Callback.body), "CG3 scope proof must remain an executed test callback");
    const cg3Text = cg3Callback.body.getText(scopeProofFile);
    for (const criticalModeSelection of [
      "const independentBaseAvailability = probeBaseCommitAvailability();",
      "const scopeEvidence = inspectImplementationScope();",
      'independentBaseAvailability === "available"',
      '? { mode: "base_diff", baseSha, paths: allowedPaths }',
      ': { mode: "protected_tree_digest", entryCount: protectedTreeEntryCount, sha256: protectedTreeSha256 }',
      'assert.equal(baseProbe.status, 128, stderr);',
      'return "unavailable";',
      'return inspectProtectedTree();',
      "const c3RegionManifest: readonly C3RegionSpec[] = [",
      "const source = projectC3Regions(",
    ]) {
      assert.equal(cg3Text.includes(criticalModeSelection), true, `missing live mode-selection edge: ${criticalModeSelection}`);
    }
    const c3ProjectionCall = cg3Text.indexOf("const source = projectC3Regions(");
    const c2SnippetReconstruction = cg3Text.indexOf("for (const snippet of runtime.snippets)");
    assert.ok(
      c3ProjectionCall >= 0 && c2SnippetReconstruction > c3ProjectionCall,
      "C3 projection must dominate each preserved C2 snippet hash and byte reconstruction",
    );
    const gitCommands: string[] = [];
    let directGitSpawnCount = 0;
    let localeDependentPathOperationCount = 0;
    let baseProbeFunction: ts.ArrowFunction | undefined;
    const visitScopeProof = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
          node.name.text === "probeBaseCommitAvailability" && node.initializer && ts.isArrowFunction(node.initializer)) {
        baseProbeFunction = node.initializer;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "spawnSync" &&
          ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "git") {
        directGitSpawnCount += 1;
      }
      if (ts.isNewExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(scopeProofFile) === "Intl" && node.expression.name.text === "Collator") {
        localeDependentPathOperationCount += 1;
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "localeCompare") {
        localeDependentPathOperationCount += 1;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ["runGit", "gitNulPathRecords", "gitNulPaths"].includes(node.expression.text) &&
          node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) {
        const command = node.arguments[0].elements[0];
        if (command && ts.isStringLiteral(command)) gitCommands.push(command.text);
      }
      ts.forEachChild(node, visitScopeProof);
    };
    visitScopeProof(cg3Callback.body);
    assert.equal(directGitSpawnCount, 1, "all CG3 Git commands must remain routed through the checked runner");
    assert.equal(localeDependentPathOperationCount, 0, "protected-tree path order and hashing must be byte-canonical");
    assert.equal(gitCommands.includes("fetch"), false, "scope proof must never network-fetch a missing base");
    assert.deepEqual(
      gitCommands.filter((command) => command === "cat-file"),
      ["cat-file"],
      "base availability must have one narrow probe definition reused by both independent observations",
    );
    assert.ok(baseProbeFunction && ts.isBlock(baseProbeFunction.body), "base probe must remain a block-bodied checked function");
    const baseProbeText = baseProbeFunction.body.getText(scopeProofFile);
    const status128Check = baseProbeText.indexOf("assert.equal(baseProbe.status, 128, stderr)");
    const exactUnavailableCheck = baseProbeText.indexOf("new RegExp(`^fatal: Not a valid object name");
    const unavailableReturn = baseProbeText.indexOf('return "unavailable"');
    assert.ok(status128Check >= 0 && exactUnavailableCheck > status128Check && unavailableReturn > exactUnavailableCheck,
      "unavailable mode must remain dominated by exact status and object-name checks");
    assert.deepEqual(
      [...allowedPathSet],
      [
        "docs/adr/0033-h-cycle-generation-fenced-execution.md",
        "docs/adr/0034-h-cycle-sqlite-write-transaction-primitive.md",
        "docs/adr/0035-harness-evaluation-next-action-proposals.md",
        "docs/phase-progress.md",
        "prisma/migrations/20260826100000_h_cycle_generation_scoped_execution/migration.sql",
        "prisma/schema.prisma",
        "src/lib/h-cycle-evaluation-record.ts",
        "src/lib/loop-jobs/delivery.ts",
        "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-one-shot-kind-isolation-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-disable-child.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.test.ts",
        "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.ts",
        "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
        "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.test.ts",
        "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.ts",
        "src/lib/loop-jobs/raw-state-adapter.ts",
        "src/lib/loop-jobs/state-machine.ts",
      ],
      "fallback exclusion set must remain the exact C2-plus-C3a/C3p/C3b/C3c/evaluation-contract/report surface",
    );
    assert.equal(
      (dedicatedTestSource.match(/mkdtempSync\(join\(tmpdir\(\), "applied-loop-a8c2-cg[12]-"\)\)/g) ?? []).length,
      2,
      "both writable fixtures must originate under a fresh OS temporary directory",
    );
    assert.doesNotMatch(
      dedicatedTestSource,
      /process\.env\.DATABASE_URL|dotenv\/config|from ["']dotenv["']|["'](?:file:\/|\/Users\/|dev\.db)/,
      "dedicated tests must not discover or name a selected/local database",
    );
    const dedicatedTestFile = ts.createSourceFile(
      "h-cycle-one-shot-kind-isolation-v1.test.ts",
      dedicatedTestSource,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    const directFileWriteCalls: string[] = [];
    const visitDedicatedTest = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ["appendFileSync", "createWriteStream", "openSync", "writeFileSync"].includes(node.expression.text)) {
        directFileWriteCalls.push(node.expression.text);
      }
      ts.forEachChild(node, visitDedicatedTest);
    };
    visitDedicatedTest(dedicatedTestFile);
    assert.deepEqual(directFileWriteCalls, [], "dedicated tests may write only through disposable SQLite clients");

    const childRunner = dedicatedTestFile.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "runClaimChild",
    );
    const pathValidator = dedicatedTestFile.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "validateClaimChildDatabasePath",
    );
    assert.ok(childRunner?.body && pathValidator?.body, "child path validator and child runner must remain named functions");
    const validatorText = pathValidator.body.getText(dedicatedTestFile);
    for (const requiredBoundary of [
      "realpathSync(tmpdir())",
      "lstatSync(resolvedFixtureRoot)",
      "fixtureRootInfo.isSymbolicLink()",
      "dirname(canonicalFixtureRoot) !== canonicalTempRoot",
      "A8C2_CLAIM_CHILD_FIXTURE_PREFIX",
      'basename(resolvedDatabasePath) !== "disposable.db"',
      "lstatSync(resolvedDatabasePath)",
      "databaseInfo.isSymbolicLink()",
      "databaseInfo.nlink !== 1",
      "realpathSync(resolvedDatabasePath)",
      "device: databaseInfo.dev",
      "inode: databaseInfo.ino",
    ]) {
      assert.equal(validatorText.includes(requiredBoundary), true, `missing child path boundary: ${requiredBoundary}`);
    }
    const validatedDeclaration = childRunner.body.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations.map((declaration) => ({
        declaration,
        flags: statement.declarationList.flags,
      })))
      .find(({ declaration }) => ts.isIdentifier(declaration.name) && declaration.name.text === "validatedDatabase");
    assert.ok(validatedDeclaration?.declaration.initializer &&
      ts.isCallExpression(validatedDeclaration.declaration.initializer) &&
      ts.isIdentifier(validatedDeclaration.declaration.initializer.expression) &&
      validatedDeclaration.declaration.initializer.expression.text === "validateClaimChildDatabasePath");
    assert.equal((validatedDeclaration.flags & ts.NodeFlags.Const) !== 0, true, "validated identity must be const");
    assert.deepEqual(
      validatedDeclaration.declaration.initializer.arguments.map((argument) => argument.getText(dedicatedTestFile)),
      ["process.env.A8C2_TEST_DATABASE_PATH", "process.env.A8C2_TEST_FIXTURE_ROOT"],
    );

    const childCalls: Array<Readonly<{ name: string; start: number; argument?: string }>> = [];
    const identityReassignments: string[] = [];
    const taggedQueries: Array<Readonly<{ tag: string; start: number; template: string }>> = [];
    const readySends: number[] = [];
    const claimRegistrations: number[] = [];
    const visitChildRunner = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ["validateClaimChildDatabasePath", "makeClient", "claimChildDatabaseIdentityIsStable"].includes(node.expression.text)) {
        childCalls.push({
          name: node.expression.text,
          start: node.getStart(dedicatedTestFile),
          argument: node.arguments[0]?.getText(dedicatedTestFile),
        });
      }
      if (ts.isTaggedTemplateExpression(node)) {
        taggedQueries.push({
          tag: node.tag.getText(dedicatedTestFile),
          start: node.getStart(dedicatedTestFile),
          template: node.template.getText(dedicatedTestFile),
        });
      }
      if (ts.isCallExpression(node) && node.expression.getText(dedicatedTestFile) === "process.send" &&
          node.arguments[0]?.getText(dedicatedTestFile) === '{ type: "ready" }') {
        readySends.push(node.getStart(dedicatedTestFile));
      }
      if (ts.isCallExpression(node) && node.expression.getText(dedicatedTestFile) === "process.once" &&
          node.arguments[0]?.getText(dedicatedTestFile) === '"message"' &&
          node.arguments[1] && ts.isArrowFunction(node.arguments[1]) && node.arguments[1].modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
          )) {
        claimRegistrations.push(node.getStart(dedicatedTestFile));
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          node.left.getText(dedicatedTestFile).startsWith("validatedDatabase")) {
        identityReassignments.push(node.getText(dedicatedTestFile));
      }
      ts.forEachChild(node, visitChildRunner);
    };
    visitChildRunner(childRunner.body);
    assert.deepEqual(childCalls.map((call) => call.name), [
      "validateClaimChildDatabasePath",
      "makeClient",
      "claimChildDatabaseIdentityIsStable",
    ]);
    assert.equal(childCalls[1].argument, "validatedDatabase.canonicalPath", "child may open only the validated canonical path");
    assert.equal(childCalls[2].argument, "validatedDatabase", "post-open check must use the captured identity");
    assert.deepEqual(identityReassignments, [], "validated path and identity must never be reassigned");
    assert.deepEqual(taggedQueries.map((query) => [query.tag, query.template]), [
      ["client.$queryRaw", '`SELECT 1 AS "identityProbe"`'],
    ]);
    assert.deepEqual(readySends.length, 1);
    assert.deepEqual(claimRegistrations.length, 1);
    assert.ok(
      childCalls[0].start < childCalls[1].start && childCalls[1].start < taggedQueries[0].start &&
        taggedQueries[0].start < childCalls[2].start && childCalls[2].start < readySends[0] &&
        readySends[0] < claimRegistrations[0],
      "validate -> canonical open -> forced query -> stable identity -> ready -> claim registration order",
    );
    const stableGuard = childRunner.body.statements.find(
      (statement): statement is ts.TryStatement => ts.isTryStatement(statement),
    )?.tryBlock.statements.find((statement): statement is ts.IfStatement => ts.isIfStatement(statement) &&
      statement.expression.getText(dedicatedTestFile) === "!claimChildDatabaseIdentityIsStable(validatedDatabase)");
    assert.ok(stableGuard && ts.isBlock(stableGuard.thenStatement));
    const stableGuardText = stableGuard.thenStatement.getText(dedicatedTestFile);
    for (const closedStep of ["await client.$disconnect()", "process.exitCode = 2", "process.disconnect?.()", "return;"]) {
      assert.equal(stableGuardText.includes(closedStep), true, `post-open mismatch must fail closed: ${closedStep}`);
    }

    const cg3FixtureRoot = mkdtempSync(join(tmpdir(), A8C2_CLAIM_CHILD_FIXTURE_PREFIX));
    const cg3DatabasePath = join(cg3FixtureRoot, "disposable.db");
    const replacementFixtureRoot = mkdtempSync(join(tmpdir(), A8C2_CLAIM_CHILD_FIXTURE_PREFIX));
    const replacementDatabasePath = join(replacementFixtureRoot, "disposable.db");
    const symlinkFixtureRoot = mkdtempSync(join(tmpdir(), A8C2_CLAIM_CHILD_FIXTURE_PREFIX));
    const hardlinkFixtureRoot = mkdtempSync(join(tmpdir(), A8C2_CLAIM_CHILD_FIXTURE_PREFIX));
    try {
      const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: `file:${cg3DatabasePath}`,
          DOTENV_CONFIG_PATH: join(cg3FixtureRoot, "dotenv-never-exists"),
        },
        encoding: "utf8",
      });
      assert.equal(migrate.status, 0, migrate.stderr);
      const replacementMigrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: `file:${replacementDatabasePath}`,
          DOTENV_CONFIG_PATH: join(replacementFixtureRoot, "dotenv-never-exists"),
        },
        encoding: "utf8",
      });
      assert.equal(replacementMigrate.status, 0, replacementMigrate.stderr);
      const acceptedDatabase = validateClaimChildDatabasePath(cg3DatabasePath, cg3FixtureRoot);
      assert.ok(acceptedDatabase, "parent-created disposable fixture must satisfy the child invariant");
      assert.equal(acceptedDatabase.canonicalPath, realpathSync(cg3DatabasePath));
      assert.equal(acceptedDatabase.device, lstatSync(cg3DatabasePath).dev);
      assert.equal(acceptedDatabase.inode, lstatSync(cg3DatabasePath).ino);
      assert.equal(acceptedDatabase.linkCount, 1);
      assert.equal(validateClaimChildDatabasePath(cg3DatabasePath, tmpdir()), undefined, "arbitrary fixture root");
      assert.equal(validateClaimChildDatabasePath(join(cg3FixtureRoot, "selected.db"), cg3FixtureRoot), undefined, "wrong basename");

      const identitySwapChild = fork(fileURLToPath(import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          A8C2_TEST_MODE: "claim-child",
          A8C2_TEST_DATABASE_PATH: cg3DatabasePath,
          A8C2_TEST_FIXTURE_ROOT: cg3FixtureRoot,
          A8C2_TEST_ENTROPY_SEED: "230",
          A8C2_TEST_IDENTITY_SWAP_HOOK: "pause_after_open",
          DOTENV_CONFIG_PATH: join(cg3FixtureRoot, "dotenv-never-exists"),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const identitySwapMessages: string[] = [];
      const identitySwapStdout: Buffer[] = [];
      const identitySwapStderr: Buffer[] = [];
      identitySwapChild.stdout?.on("data", (chunk: Buffer) => identitySwapStdout.push(chunk));
      identitySwapChild.stderr?.on("data", (chunk: Buffer) => identitySwapStderr.push(chunk));
      const identitySwapExitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
        identitySwapChild.once("error", rejectExit);
        identitySwapChild.on("message", (message: unknown) => {
          if (typeof message !== "object" || message === null || typeof (message as { type?: unknown }).type !== "string") return;
          const type = (message as { type: string }).type;
          identitySwapMessages.push(type);
          if (type === "identity_opened") {
            renameSync(cg3DatabasePath, join(cg3FixtureRoot, "opened-original.db"));
            renameSync(replacementDatabasePath, cg3DatabasePath);
            identitySwapChild.send?.({ type: "continue_identity_check" });
          }
        });
        identitySwapChild.once("exit", resolveExit);
      });
      assert.equal(identitySwapExitCode, 2, "post-open inode replacement must fail before ready/claim");
      assert.deepEqual(identitySwapMessages, ["identity_opened"]);
      assert.equal(identitySwapMessages.includes("ready"), false);
      assert.equal(Buffer.concat(identitySwapStdout).length, 0);
      assert.equal(Buffer.concat(identitySwapStderr).length, 0);

      const symlinkDatabasePath = join(symlinkFixtureRoot, "disposable.db");
      symlinkSync(cg3DatabasePath, symlinkDatabasePath);
      assert.equal(
        validateClaimChildDatabasePath(symlinkDatabasePath, symlinkFixtureRoot),
        undefined,
        "symlink escape must fail before database open",
      );
      const originalBeforeRejectedChild = lstatSync(cg3DatabasePath);
      const rejectedChild = fork(fileURLToPath(import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          A8C2_TEST_MODE: "claim-child",
          A8C2_TEST_DATABASE_PATH: symlinkDatabasePath,
          A8C2_TEST_FIXTURE_ROOT: symlinkFixtureRoot,
          A8C2_TEST_ENTROPY_SEED: "240",
          DOTENV_CONFIG_PATH: join(symlinkFixtureRoot, "dotenv-never-exists"),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const rejectedStdout: Buffer[] = [];
      const rejectedStderr: Buffer[] = [];
      rejectedChild.stdout?.on("data", (chunk: Buffer) => rejectedStdout.push(chunk));
      rejectedChild.stderr?.on("data", (chunk: Buffer) => rejectedStderr.push(chunk));
      const rejectedExitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
        rejectedChild.once("error", rejectExit);
        rejectedChild.once("exit", resolveExit);
      });
      assert.equal(rejectedExitCode, 2, "invalid child path must stop before ready/claim");
      assert.equal(Buffer.concat(rejectedStdout).length, 0);
      assert.equal(Buffer.concat(rejectedStderr).length, 0);
      const originalAfterRejectedChild = lstatSync(cg3DatabasePath);
      assert.equal(originalAfterRejectedChild.size, originalBeforeRejectedChild.size);
      assert.equal(originalAfterRejectedChild.mtimeMs, originalBeforeRejectedChild.mtimeMs);

      const hardlinkDatabasePath = join(hardlinkFixtureRoot, "disposable.db");
      linkSync(cg3DatabasePath, hardlinkDatabasePath);
      assert.ok(lstatSync(hardlinkDatabasePath).nlink > 1);
      assert.equal(
        validateClaimChildDatabasePath(hardlinkDatabasePath, hardlinkFixtureRoot),
        undefined,
        "hardlink escape must fail before database open",
      );
    } finally {
      rmSync(hardlinkFixtureRoot, { recursive: true, force: true });
      rmSync(symlinkFixtureRoot, { recursive: true, force: true });
      rmSync(replacementFixtureRoot, { recursive: true, force: true });
      rmSync(cg3FixtureRoot, { recursive: true, force: true });
    }

    const unchangedRuntimePaths = [
      "src/lib/loop-jobs/worker.mjs",
      "src/lib/loop-jobs/worker-phase1.mjs",
      "src/lib/loop-jobs/worker-phase2.ts",
      "src/lib/loop-jobs/worker-phase2-entry.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts",
      "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts",
      "src/lib/h-cycle-evidence-preview.ts",
      "src/lib/h-cycle-evidence-preview-query.ts",
      "scripts/preview-h-cycle-evidence.ts",
    ] as const;
    if (independentBaseAvailability === "available") {
      for (const path of unchangedRuntimePaths) {
        const current = readFileSync(join(process.cwd(), path));
        const base = runGit(["show", `${baseSha}:${path}`], "buffer");
        assert.equal(base.status, 0, String(base.stderr));
        assert.equal(createHash("sha256").update(current).digest("hex"), createHash("sha256").update(base.stdout as Buffer).digest("hex"), `${path} byte drift`);
      }
    } else {
      assert.equal(
        scopeEvidence.mode,
        "protected_tree_digest",
        "base-unavailable runtime immutability must be covered by the pinned protected-tree proof",
      );
    }

    const workerPath = join(process.cwd(), "src/lib/loop-jobs/worker-phase2.ts");
    const workerSource = readFileSync(workerPath, "utf8");
    const workerFile = ts.createSourceFile(workerPath, workerSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const productionRegistries: ts.ObjectLiteralExpression[] = [];
    const productionHandlers: ts.ObjectLiteralExpression[] = [];
    const visitWorker = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "productionRegistry" &&
          node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments.length === 1 &&
          ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
        productionRegistries.push(node.initializer.arguments[0]);
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(workerFile) === "handlers" &&
          ts.isObjectLiteralExpression(node.initializer)) {
        productionHandlers.push(node.initializer);
      }
      ts.forEachChild(node, visitWorker);
    };
    visitWorker(workerFile);
    assert.deepEqual(productionRegistries.map((value) => value.properties.length), [0]);
    assert.deepEqual(productionHandlers.map((value) => value.properties.length), [0]);

    const deliveryPath = join(process.cwd(), "src/lib/loop-jobs/delivery.ts");
    const deliverySource = readFileSync(deliveryPath, "utf8");
    const deliveryFile = ts.createSourceFile(deliveryPath, deliverySource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const scopedDelivery = deliveryFile.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "runOneKindDelivery",
    );
    assert.ok(scopedDelivery?.body);
    let recoverEdges = 0;
    const visitScopedDelivery = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "recoverExpired") recoverEdges += 1;
      ts.forEachChild(node, visitScopedDelivery);
    };
    visitScopedDelivery(scopedDelivery.body);
    assert.equal(recoverEdges, 0, "scoped delivery must never reach global recovery");
  });
}
