import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

import {
  appendHCycleActivationEventV1,
  type HCycleActivationControlLedgerDependenciesV1,
} from "./h-cycle-activation-control-ledger-v1";
import {
  runHCycleSqliteImmediateWriteTransactionV1,
  type HCycleSqliteImmediateWriteConnectionV1,
  type HCycleSqliteImmediateWriteTransactionResultV1,
} from "./h-cycle-sqlite-immediate-write-transaction-v1";

const CURRENT_JST_WEEK = new Date("2026-08-24T00:00:00.000Z");
const READ_READY = 0;
const RELEASE_CREATE = 1;
const RESULT = 2;
const RESULT_READY = 3;
const RESULT_PENDING = 0;
const RESULT_EXPECTED_STORAGE_FAILURE = 1;
const RESULT_UNEXPECTED = 2;
const RESULT_CHILD_FAILURE = 3;
const PARENT_WAIT_TIMEOUT_MS = 1_000;
const C3P_HELPER_PATH = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.ts";
const C3P_TEST_PATH = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.test.ts";
const C3P_CHILD_PATH = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-disable-child.ts";
const C3B_EXECUTION_PATH = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.ts";
const C3B_TEST_PATH = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-generation-scoped-execution-v1.test.ts";
const resolveFromTest = createRequire(import.meta.url);

type DataRecord = Record<string, unknown>;
type DirectStatement = Readonly<{
  all: (parameters?: Readonly<Record<string, unknown>>) => readonly DataRecord[];
  run: (parameters?: Readonly<Record<string, unknown>>) => unknown;
}>;
type DirectConnection = HCycleSqliteImmediateWriteConnectionV1 & Readonly<{
  pragma: (source: string, options?: Readonly<{ simple: boolean }>) => unknown;
  exec: (source: string) => unknown;
  prepare: (source: string) => DirectStatement;
  close: () => void;
}>;
type DirectDatabaseConstructor = new (
  databasePath: string,
  options: Readonly<{ fileMustExist: boolean; timeout: number }>,
) => DirectConnection;
type PrismaClientLike = Readonly<{
  $disconnect: () => Promise<void>;
  hCycleActivationEvent: Readonly<{
    findMany: (args: unknown) => Promise<readonly Readonly<{
      sequence: number;
      eventKind: string;
      generationSequence: number | null;
    }>[]>;
  }>;
}>;
type PrismaClientConstructor = new (options: Readonly<{ adapter: unknown }>) => PrismaClientLike;
type PrismaBetterSqlite3Constructor = new (
  options: Readonly<{ url: string; fileMustExist: boolean; timeout: number }>,
  format: Readonly<{ timestampFormat: "iso8601" }>,
) => unknown;
type Runtime = Readonly<{
  Database: DirectDatabaseConstructor;
  PrismaClient: PrismaClientConstructor;
  PrismaBetterSqlite3: PrismaBetterSqlite3Constructor;
  prismaCliEntry: string;
}>;
type DisposableFixture = Readonly<{
  directory: string;
  databasePath: string;
  databaseUrl: string;
  dotenvConfigPath: string;
}>;
type ProbeRow = Readonly<{
  generationSequence: number;
  targetWeekKey: string;
}>;
type DisableChildWorkerDataV1 = Readonly<{
  fixtureDirectory: string;
  databasePath: string;
  sharedState: SharedArrayBuffer;
}>;

function dataRecord(value: unknown): DataRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as DataRecord;
}

function loadRuntime(): Runtime {
  const adapterEntry = resolveFromTest.resolve("@prisma/adapter-better-sqlite3");
  const requireFromAdapter = createRequire(adapterEntry);
  const nestedDriverEntry = requireFromAdapter.resolve("better-sqlite3");
  const Database = requireFromAdapter("better-sqlite3") as DirectDatabaseConstructor;
  const rootDriverEntry = resolveFromTest.resolve("better-sqlite3");
  const adapterPackageRoot = dirname(dirname(adapterEntry));
  const nestedDriverPackageRoot = join(adapterPackageRoot, "node_modules", "better-sqlite3");
  const nestedDriverRelativePath = relative(nestedDriverPackageRoot, nestedDriverEntry);
  assert.equal(nestedDriverRelativePath === "" || nestedDriverRelativePath.startsWith(".."), false);
  assert.equal(isAbsolute(nestedDriverRelativePath), false);
  assert.notEqual(nestedDriverEntry, rootDriverEntry);

  const adapter = resolveFromTest("@prisma/adapter-better-sqlite3") as Readonly<{
    PrismaBetterSqlite3: PrismaBetterSqlite3Constructor;
  }>;
  const prismaCliEntry = resolveFromTest.resolve("prisma/build/index.js");
  const projectRoot = dirname(dirname(dirname(dirname(prismaCliEntry))));
  const generatedClientEntry = join(projectRoot, "src", "generated", "prisma", "client.ts");
  const requireFromGeneratedClient = createRequire(generatedClientEntry);
  const generated = requireFromGeneratedClient(generatedClientEntry) as Readonly<{
    PrismaClient: PrismaClientConstructor;
  }>;
  return Object.freeze({
    Database,
    PrismaClient: generated.PrismaClient,
    PrismaBetterSqlite3: adapter.PrismaBetterSqlite3,
    prismaCliEntry,
  });
}

function configureDirectConnection(connection: DirectConnection): void {
  connection.pragma("foreign_keys = ON");
  assert.equal(connection.pragma("foreign_keys", { simple: true }), 1);
  connection.pragma("busy_timeout = 0");
  assert.equal(connection.pragma("busy_timeout", { simple: true }), 0);
}

async function withFixture<T>(
  runtime: Runtime,
  run: (fixture: DisposableFixture, client: PrismaClientLike, directA: DirectConnection, directC: DirectConnection) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a8c3p-"));
  const databasePath = join(directory, "fixture.db");
  const dotenvConfigPath = join(directory, "dotenv-never-exists");
  const databaseUrl = `file:${databasePath}`;
  try {
    const migration = spawnSync(
      process.execPath,
      [runtime.prismaCliEntry, "migrate", "deploy", "--schema", join(process.cwd(), "prisma", "schema.prisma")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DOTENV_CONFIG_PATH: dotenvConfigPath,
          DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    assert.equal(migration.error, undefined, "temporary fixture migration must start");
    assert.equal(migration.status, 0, "temporary fixture migration must succeed");
    assert.equal(lstatSync(databasePath).isFile(), true);

    const client = new runtime.PrismaClient({
      adapter: new runtime.PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    let directA: DirectConnection | undefined;
    let directC: DirectConnection | undefined;
    try {
      directA = new runtime.Database(databasePath, { fileMustExist: true, timeout: 0 });
      directC = new runtime.Database(databasePath, { fileMustExist: true, timeout: 0 });
      configureDirectConnection(directA);
      configureDirectConnection(directC);
      return await run(
        Object.freeze({ directory, databasePath, databaseUrl, dotenvConfigPath }),
        client,
        directA,
        directC,
      );
    } finally {
      try {
        directC?.close();
      } finally {
        try {
          directA?.close();
        } finally {
          await client.$disconnect();
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function ledgerDependencies(client: PrismaClientLike): HCycleActivationControlLedgerDependenciesV1 {
  return {
    client: client as unknown as HCycleActivationControlLedgerDependenciesV1["client"],
    clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
  };
}

async function appendRoot(client: PrismaClientLike): Promise<number> {
  const result = await appendHCycleActivationEventV1(
    ledgerDependencies(client),
    {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "packet_attested",
      activationFloorWeekKey: "2026-W35",
    },
  );
  assert.deepEqual(result, { ok: true, featureState: "off", created: true });
  assert.equal(Object.isFrozen(result), true);
  const rows = await client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });
  assert.deepEqual(rows.map((row) => [row.sequence, row.eventKind, row.generationSequence]), [[1, "packet_attested", null]]);
  return rows[0]?.sequence ?? 0;
}

async function appendDisabled(client: PrismaClientLike): Promise<void> {
  const result = await appendHCycleActivationEventV1(
    ledgerDependencies(client),
    { schema: "h_cycle_activation_event_input_v1", eventKind: "disabled" },
  );
  assert.deepEqual(result, { ok: true, featureState: "off", created: true });
  assert.equal(Object.isFrozen(result), true);
}

function createProbeTable(connection: DirectConnection): void {
  connection.exec(`
    CREATE TABLE "HCycleC3pProbe" (
      "sequence" INTEGER NOT NULL PRIMARY KEY,
      "generationSequence" INTEGER NOT NULL,
      "targetWeekKey" TEXT NOT NULL,
      "probeLabel" TEXT NOT NULL,
      CONSTRAINT "HCycleC3pProbe_generationSequence_fkey"
        FOREIGN KEY ("generationSequence") REFERENCES "HCycleActivationEvent" ("sequence")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT "HCycleC3pProbe_generation_target_unique"
        UNIQUE ("generationSequence", "targetWeekKey")
    );
  `);
}

function guardedProbe(
  connection: DirectConnection,
  expectedGeneration: number,
  targetWeekKey: string,
  probeLabel: string,
): readonly ProbeRow[] {
  return connection.prepare(`
    INSERT INTO "HCycleC3pProbe" ("generationSequence", "targetWeekKey", "probeLabel")
    SELECT "root"."sequence", :targetWeekKey, :probeLabel
    FROM "HCycleActivationEvent" AS "root"
    WHERE "root"."sequence" = :expectedGeneration
      AND "root"."eventKind" IN ('packet_attested', 're_enabled')
      AND NOT EXISTS (
        SELECT 1
        FROM "HCycleActivationEvent" AS "newer"
        WHERE "newer"."sequence" > "root"."sequence"
      )
    ON CONFLICT ("generationSequence", "targetWeekKey") DO NOTHING
    RETURNING "generationSequence", "targetWeekKey";
  `).all({ expectedGeneration, targetWeekKey, probeLabel }) as readonly ProbeRow[];
}

function canonicalLogicalSnapshot(connection: DirectConnection): string {
  const rows = (query: string): readonly DataRecord[] => connection.prepare(query).all();
  return JSON.stringify({
    activationEvents: rows(`
      SELECT "sequence", "eventSchema", "eventKind", "generationSequence", "packetSchema", "packetStatus",
        "targetClass", "activationFloorWeekKey", "schedulerClass", "schedulerOwnership", "stopRouteClass",
        "recordedAt", "createdAt"
      FROM "HCycleActivationEvent"
      ORDER BY "sequence" ASC
    `),
    activationEvidence: rows(`
      SELECT "sequence", "evidenceSchema", "generationSequence", "evidenceKind", "targetWeekKey",
        "policyOutcome", "observedAt", "createdAt"
      FROM "HCycleActivationEvidence"
      ORDER BY "sequence" ASC
    `),
    probes: rows(`
      SELECT "sequence", "generationSequence", "targetWeekKey", "probeLabel"
      FROM "HCycleC3pProbe"
      ORDER BY "sequence" ASC
    `),
    sqliteSequence: rows(`
      SELECT "name", "seq"
      FROM "sqlite_sequence"
      WHERE "name" IN ('HCycleActivationEvent', 'HCycleActivationEvidence', 'HCycleC3pProbe')
      ORDER BY "name" ASC
    `),
  });
}

function assertStorageFailure(result: HCycleSqliteImmediateWriteTransactionResultV1): void {
  assert.deepEqual(result, { ok: false, code: "storage_failure" });
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(JSON.stringify(result), /(?:SQLITE|fixture|database|BEGIN|COMMIT|ROLLBACK)/i);
}

function sqliteErrorCode(error: unknown): string | undefined {
  const record = dataRecord(error);
  return record !== null && typeof record.code === "string" ? record.code : undefined;
}

function assertForeignKeyFailure(action: () => unknown): void {
  assert.throws(action, (error: unknown) => sqliteErrorCode(error) === "SQLITE_CONSTRAINT_FOREIGNKEY");
}

function waitForState(state: Int32Array, index: number, expected: number, label: string): void {
  const deadline = Date.now() + PARENT_WAIT_TIMEOUT_MS;
  while (Atomics.load(state, index) !== expected) {
    const observed = Atomics.load(state, index);
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, `${label} must resolve before the bounded timeout`);
    Atomics.wait(state, index, observed, remaining);
  }
}

function releaseChild(state: Int32Array): void {
  Atomics.store(state, RELEASE_CREATE, 1);
  Atomics.notify(state, RELEASE_CREATE, 1);
}

// This is the sole child spawn site. The child is test-only and is never
// registered with an application worker, queue, registry, handler, scheduler,
// or launchd entrypoint.
export function spawnHCycleSqliteImmediateWriteTransactionDisableChildForTestV1(
  workerData: DisableChildWorkerDataV1,
): Worker {
  return new Worker(
    new URL("./h-cycle-sqlite-immediate-write-transaction-disable-child.ts", import.meta.url),
    {
      execArgv: ["--require", "tsx/cjs"],
      workerData,
    },
  );
}

function assertC3pStaticSourceGraph(): void {
  const ts = resolveFromTest("typescript") as typeof import("typescript");
  const root = process.cwd();
  const gitPaths = (args: readonly string[]): readonly string[] => {
    const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.error, undefined, `git ${args[0]} must start`);
    assert.equal(result.status, 0, `git ${args[0]} must succeed`);
    return result.stdout.split("\n").filter(Boolean);
  };
  const sourcePaths = [...new Set([
    ...gitPaths(["ls-files", "src"]),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "src"]),
  ])]
    .filter((path) => /\.(?:ts|tsx|mjs)$/.test(path))
    .sort();
  const targetPath = (importer: string, specifier: string): string | undefined => {
    if (!specifier.startsWith(".")) return undefined;
    const candidate = resolve(root, dirname(importer), specifier);
    const candidates = [
      candidate,
      `${candidate}.ts`,
      `${candidate}.tsx`,
      `${candidate}.mjs`,
      join(candidate, "index.ts"),
      join(candidate, "index.tsx"),
      join(candidate, "index.mjs"),
    ];
    const helperPath = resolve(root, C3P_HELPER_PATH);
    const childPath = resolve(root, C3P_CHILD_PATH);
    if (candidates.includes(helperPath)) return C3P_HELPER_PATH;
    if (candidates.includes(childPath)) return C3P_CHILD_PATH;
    return undefined;
  };
  const helperImportConsumers: string[] = [];
  const childImportConsumers: string[] = [];
  const helperReexportConsumers: string[] = [];
  const childReexportConsumers: string[] = [];
  const childWorkerUrlConsumers: string[] = [];
  const childWorkerCjsPreloadConsumers: string[] = [];
  for (const path of sourcePaths) {
    const source = readFileSync(join(root, path), "utf8");
    const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, scriptKind);
    const visit = (node: import("typescript").Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = targetPath(path, node.moduleSpecifier.text);
        if (target === C3P_HELPER_PATH) helperImportConsumers.push(path);
        if (target === C3P_CHILD_PATH) childImportConsumers.push(path);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = targetPath(path, node.moduleSpecifier.text);
        if (target === C3P_HELPER_PATH) helperReexportConsumers.push(path);
        if (target === C3P_CHILD_PATH) childReexportConsumers.push(path);
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Worker") {
        const firstArgument = node.arguments?.[0];
        if (firstArgument && ts.isNewExpression(firstArgument) && ts.isIdentifier(firstArgument.expression) &&
            firstArgument.expression.text === "URL" && firstArgument.arguments?.[0] &&
            ts.isStringLiteral(firstArgument.arguments[0]) &&
            targetPath(path, firstArgument.arguments[0].text) === C3P_CHILD_PATH) {
          childWorkerUrlConsumers.push(path);
          const options = node.arguments?.[1];
          const execArgv = options && ts.isObjectLiteralExpression(options)
            ? options.properties.find((property): property is import("typescript").PropertyAssignment =>
              ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "execArgv")
            : undefined;
          const argumentsValue = execArgv?.initializer;
          if (argumentsValue && ts.isArrayLiteralExpression(argumentsValue) &&
              argumentsValue.elements.length === 2 &&
              ts.isStringLiteral(argumentsValue.elements[0]) && argumentsValue.elements[0].text === "--require" &&
              ts.isStringLiteral(argumentsValue.elements[1]) && argumentsValue.elements[1].text === "tsx/cjs") {
            childWorkerCjsPreloadConsumers.push(path);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(helperImportConsumers, [C3B_TEST_PATH, C3P_TEST_PATH]);
  assert.deepEqual(childImportConsumers, []);
  assert.deepEqual(helperReexportConsumers, []);
  assert.deepEqual(childReexportConsumers, []);
  assert.deepEqual(childWorkerUrlConsumers, [C3P_TEST_PATH]);
  assert.deepEqual(childWorkerCjsPreloadConsumers, [C3P_TEST_PATH]);

  const helperSource = readFileSync(join(root, C3P_HELPER_PATH), "utf8");
  assert.doesNotMatch(helperSource, /^\s*import\s/m);
  assert.doesNotMatch(
    helperSource,
    /(?:process\.env|DATABASE_URL|DOTENV_CONFIG_PATH|Prisma|createRequire|new\s+Worker|launchd|scheduler|registry|handler)/,
  );
  assert.doesNotMatch(helperSource, /(?:["'`])\s*(?:BEGIN|COMMIT|ROLLBACK|SELECT|INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(helperSource, /\basync\b|\bPromise\b|\.then\(/);

  const c3bExecutionSource = readFileSync(join(root, C3B_EXECUTION_PATH), "utf8");
  assert.doesNotMatch(c3bExecutionSource, /h-cycle-sqlite-immediate-write-transaction-v1/);
  assert.match(c3bExecutionSource, /runImmediate/);
  assert.doesNotMatch(
    c3bExecutionSource,
    /(?:process\.env|DATABASE_URL|DOTENV_CONFIG_PATH|Prisma|createRequire|better-sqlite3|new\s+Worker|launchctl|\.plist|ProgramArguments|StartInterval|StartCalendarInterval|RunAtLoad|KeepAlive|\bscheduler\b|worker-phase|runOneDelivery|runOneKindDelivery)/,
  );

  const childSource = readFileSync(join(root, C3P_CHILD_PATH), "utf8");
  assert.doesNotMatch(childSource, /process\.env|console\./);
  assert.doesNotMatch(
    childSource,
    /(?:defineLoopJobRegistry|createLoopJobQueue|runOneShotWorker|launchctl|\.plist|ProgramArguments|StartInterval|StartCalendarInterval|RunAtLoad|KeepAlive)/,
  );
}

test("A8C3P-CG1-T1 binds named immediate work to the injected connection", async () => {
  const events: string[] = [];
  let receivedConnection: HCycleSqliteImmediateWriteConnectionV1 | undefined;
  const connection: HCycleSqliteImmediateWriteConnectionV1 = {
    transaction(operation) {
      events.push("transaction");
      return Object.freeze({
        immediate: () => {
          events.push("immediate");
          operation();
        },
      });
    },
  };

  const result = runHCycleSqliteImmediateWriteTransactionV1(
    { connection },
    (actualConnection) => {
      receivedConnection = actualConnection;
      return undefined;
    },
  );

  assert.deepEqual(events, ["transaction", "immediate"]);
  assert.strictEqual(receivedConnection, connection);
  assert.deepEqual(result, { ok: true });
  assert.equal(Object.isFrozen(result), true);

  const thenableResult = runHCycleSqliteImmediateWriteTransactionV1(
    { connection },
    (() => Object.freeze({ then: () => undefined })) as unknown as (
      actualConnection: HCycleSqliteImmediateWriteConnectionV1,
    ) => undefined,
  );
  assertStorageFailure(thenableResult);
  assertC3pStaticSourceGraph();

  const runtime = loadRuntime();
  await withFixture(runtime, async (fixture, client, directA, directC) => {
    createProbeTable(directA);
    const rootSequence = await appendRoot(client);

    assertForeignKeyFailure(() => directA.prepare(`
      INSERT INTO "HCycleC3pProbe" ("generationSequence", "targetWeekKey", "probeLabel")
      VALUES (999999, '2026-W35', 'direct-a-invalid-generation')
    `).run());
    assertForeignKeyFailure(() => directC.prepare(`
      INSERT INTO "HCycleC3pProbe" ("generationSequence", "targetWeekKey", "probeLabel")
      VALUES (999999, '2026-W35', 'direct-c-invalid-generation')
    `).run());

    const beforeBusy = canonicalLogicalSnapshot(directA);
    directC.exec("BEGIN EXCLUSIVE");
    let busyCallbackCalls = 0;
    try {
      const busyResult = runHCycleSqliteImmediateWriteTransactionV1(
        { connection: directA },
        () => {
          busyCallbackCalls += 1;
          return undefined;
        },
      );
      assertStorageFailure(busyResult);
      assert.equal(busyCallbackCalls, 0);
    } finally {
      directC.exec("ROLLBACK");
    }
    assert.equal(canonicalLogicalSnapshot(directA), beforeBusy);

    const beforeRollback = canonicalLogicalSnapshot(directA);
    const privateRollbackSentinel = Object.freeze({ marker: "private-c3p-rollback" });
    const rollbackResult = runHCycleSqliteImmediateWriteTransactionV1(
      { connection: directA },
      () => {
        assert.deepEqual(guardedProbe(directA, rootSequence, "2026-W35", "rollback"), [
          { generationSequence: rootSequence, targetWeekKey: "2026-W35" },
        ]);
        throw privateRollbackSentinel;
      },
    );
    assertStorageFailure(rollbackResult);
    assert.doesNotMatch(JSON.stringify(rollbackResult), /private-c3p-rollback/);
    assert.equal(canonicalLogicalSnapshot(directA), beforeRollback);

    const firstDuplicateResult = runHCycleSqliteImmediateWriteTransactionV1(
      { connection: directA },
      () => {
        assert.deepEqual(guardedProbe(directA, rootSequence, "2026-W35", "duplicate-first"), [
          { generationSequence: rootSequence, targetWeekKey: "2026-W35" },
        ]);
        return undefined;
      },
    );
    assert.deepEqual(firstDuplicateResult, { ok: true });
    const secondDuplicateResult = runHCycleSqliteImmediateWriteTransactionV1(
      { connection: directA },
      () => {
        assert.deepEqual(guardedProbe(directA, rootSequence, "2026-W35", "duplicate-second"), []);
        return undefined;
      },
    );
    assert.deepEqual(secondDuplicateResult, { ok: true });
    assert.deepEqual(
      directA.prepare(`
        SELECT "generationSequence", "targetWeekKey"
        FROM "HCycleC3pProbe"
        WHERE "targetWeekKey" = '2026-W35'
        ORDER BY "sequence" ASC
      `).all(),
      [{ generationSequence: rootSequence, targetWeekKey: "2026-W35" }],
    );

    const sharedState = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (RESULT_READY + 1));
    const state = new Int32Array(sharedState);
    assert.equal(Atomics.load(state, RESULT), RESULT_PENDING);
    const child = spawnHCycleSqliteImmediateWriteTransactionDisableChildForTestV1({
      fixtureDirectory: fixture.directory,
      databasePath: fixture.databasePath,
      sharedState,
    });
    let childReleased = false;
    try {
      waitForState(state, READ_READY, 1, "child real findMany barrier");
      const writerFirstResult = runHCycleSqliteImmediateWriteTransactionV1(
        { connection: directA },
        (actualConnection) => {
          assert.strictEqual(actualConnection, directA);
          assert.deepEqual(guardedProbe(directA, rootSequence, "2026-W36", "writer-first"), [
            { generationSequence: rootSequence, targetWeekKey: "2026-W36" },
          ]);
          releaseChild(state);
          childReleased = true;
          waitForState(state, RESULT_READY, 1, "child actual disabled create result");
          const childResult = Atomics.load(state, RESULT);
          assert.equal(childResult, RESULT_EXPECTED_STORAGE_FAILURE);
          assert.notEqual(childResult, RESULT_UNEXPECTED);
          assert.notEqual(childResult, RESULT_CHILD_FAILURE);
          assert.deepEqual(
            directA.prepare(`
              SELECT "sequence", "eventKind", "generationSequence"
              FROM "HCycleActivationEvent"
              ORDER BY "sequence" ASC
            `).all(),
            [{ sequence: rootSequence, eventKind: "packet_attested", generationSequence: null }],
          );
          return undefined;
        },
      );
      assert.deepEqual(writerFirstResult, { ok: true });
      assert.equal(Object.isFrozen(writerFirstResult), true);
    } finally {
      if (!childReleased) releaseChild(state);
      await child.terminate();
    }
    assert.equal(Atomics.load(state, RESULT), RESULT_EXPECTED_STORAGE_FAILURE);
    assert.deepEqual(
      directA.prepare(`
        SELECT "generationSequence", "targetWeekKey"
        FROM "HCycleC3pProbe"
        WHERE "targetWeekKey" = '2026-W36'
        ORDER BY "sequence" ASC
      `).all(),
      [{ generationSequence: rootSequence, targetWeekKey: "2026-W36" }],
    );
    assert.deepEqual(
      (await client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } }))
        .map((row) => [row.sequence, row.eventKind, row.generationSequence]),
      [[rootSequence, "packet_attested", null]],
    );
    await appendDisabled(client);
    assert.deepEqual(
      (await client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } }))
        .map((row) => [row.sequence, row.eventKind, row.generationSequence]),
      [[rootSequence, "packet_attested", null], [rootSequence + 1, "disabled", rootSequence]],
    );
  });

  await withFixture(runtime, async (_fixture, client, directA) => {
    createProbeTable(directA);
    const rootSequence = await appendRoot(client);
    await appendDisabled(client);
    const beforeDisableFirst = canonicalLogicalSnapshot(directA);
    const disableFirstResult = runHCycleSqliteImmediateWriteTransactionV1(
      { connection: directA },
      () => {
        assert.deepEqual(guardedProbe(directA, rootSequence, "2026-W36", "disable-first"), []);
        return undefined;
      },
    );
    assert.deepEqual(disableFirstResult, { ok: true });
    assert.equal(Object.isFrozen(disableFirstResult), true);
    assert.equal(canonicalLogicalSnapshot(directA), beforeDisableFirst);
  });
});
