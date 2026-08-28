import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { workerData } from "node:worker_threads";

import {
  appendHCycleActivationEventV1,
  type HCycleActivationControlLedgerDependenciesV1,
} from "./h-cycle-activation-control-ledger-v1";

const READ_READY = 0;
const RELEASE_CREATE = 1;
const RESULT = 2;
const RESULT_READY = 3;
const RESULT_PENDING = 0;
const RESULT_EXPECTED_STORAGE_FAILURE = 1;
const RESULT_UNEXPECTED = 2;
const RESULT_CHILD_FAILURE = 3;
// Match the parent-side bounded handshake window; CI can spend several
// seconds initializing a Worker before the parent is scheduled again.
const CHILD_WAIT_TIMEOUT_MS = 10_000;
const FIXTURE_DIRECTORY_PREFIX = "applied-loop-a8c3p-";

type DataRecord = Record<string, unknown>;
type PrismaClientLike = Readonly<{
  $disconnect: () => Promise<void>;
}>;
type PrismaClientConstructor = new (options: Readonly<{ adapter: unknown }>) => PrismaClientLike;
type PrismaBetterSqlite3Constructor = new (
  options: Readonly<{ url: string; fileMustExist: boolean; timeout: number }>,
  format: Readonly<{ timestampFormat: "iso8601" }>,
) => unknown;

function dataRecord(value: unknown): DataRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as DataRecord;
}

function markResult(state: Int32Array, result: number): void {
  Atomics.store(state, RESULT, result);
  Atomics.store(state, RESULT_READY, 1);
  Atomics.notify(state, RESULT_READY, 1);
}

function waitForRelease(state: Int32Array): boolean {
  const deadline = Date.now() + CHILD_WAIT_TIMEOUT_MS;
  while (Atomics.load(state, RELEASE_CREATE) !== 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    Atomics.wait(state, RELEASE_CREATE, 0, remaining);
  }
  return true;
}

function validatedFixtureDatabase(data: DataRecord): string {
  const fixtureDirectory = data.fixtureDirectory;
  const databasePath = data.databasePath;
  if (typeof fixtureDirectory !== "string" || typeof databasePath !== "string") {
    throw new Error("invalid fixture worker data");
  }
  if (!isAbsolute(fixtureDirectory) || !isAbsolute(databasePath)) {
    throw new Error("invalid fixture worker data");
  }
  const resolvedFixtureDirectory = resolve(fixtureDirectory);
  const directoryStat = lstatSync(resolvedFixtureDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("invalid fixture worker data");
  }
  const realFixtureDirectory = realpathSync(resolvedFixtureDirectory);
  const canonicalTemporaryDirectory = realpathSync(tmpdir());
  const fixtureName = basename(realFixtureDirectory);
  const fixtureSuffix = fixtureName.slice(FIXTURE_DIRECTORY_PREFIX.length);
  if (
    dirname(realFixtureDirectory) !== canonicalTemporaryDirectory ||
    !fixtureName.startsWith(FIXTURE_DIRECTORY_PREFIX) ||
    !/^[A-Za-z0-9]+$/.test(fixtureSuffix)
  ) {
    throw new Error("invalid fixture worker data");
  }
  const expectedDatabasePath = join(realFixtureDirectory, "fixture.db");
  const resolvedDatabasePath = resolve(databasePath);
  if (relative(resolvedFixtureDirectory, resolvedDatabasePath) !== "fixture.db") {
    throw new Error("invalid fixture worker data");
  }
  const databaseStat = lstatSync(resolvedDatabasePath);
  if (
    !databaseStat.isFile() ||
    databaseStat.isSymbolicLink() ||
    realpathSync(resolvedDatabasePath) !== expectedDatabasePath
  ) {
    throw new Error("invalid fixture worker data");
  }
  return expectedDatabasePath;
}

function loadPrismaRuntime(): Readonly<{
  PrismaClient: PrismaClientConstructor;
  PrismaBetterSqlite3: PrismaBetterSqlite3Constructor;
}> {
  const resolveFromChild = createRequire(import.meta.url);
  const prismaEntry = resolveFromChild.resolve("prisma/build/index.js");
  const projectRoot = dirname(dirname(dirname(dirname(prismaEntry))));
  const generatedClientEntry = join(projectRoot, "src", "generated", "prisma", "client.ts");
  const requireFromGeneratedClient = createRequire(generatedClientEntry);
  const generated = requireFromGeneratedClient(generatedClientEntry) as Readonly<{ PrismaClient: PrismaClientConstructor }>;
  const adapter = resolveFromChild("@prisma/adapter-better-sqlite3") as Readonly<{
    PrismaBetterSqlite3: PrismaBetterSqlite3Constructor;
  }>;
  return Object.freeze({
    PrismaClient: generated.PrismaClient,
    PrismaBetterSqlite3: adapter.PrismaBetterSqlite3,
  });
}

function delegatedLedgerClient(
  client: PrismaClientLike,
  state: Int32Array,
): HCycleActivationControlLedgerDependenciesV1["client"] {
  const clientRecord = dataRecord(client);
  const activationEvent = clientRecord === null ? null : dataRecord(clientRecord.hCycleActivationEvent);
  const findMany = activationEvent === null ? undefined : activationEvent.findMany;
  if (clientRecord === null || activationEvent === null || typeof findMany !== "function") {
    throw new Error("invalid ledger client");
  }
  const delegatedActivationEvent = new Proxy(activationEvent, {
    get(target, property, receiver) {
      if (property === "findMany") {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(findMany, target, args);
          Atomics.store(state, READ_READY, 1);
          Atomics.notify(state, READ_READY, 1);
          if (!waitForRelease(state)) {
            markResult(state, RESULT_CHILD_FAILURE);
            throw new Error("child release timeout");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(clientRecord, {
    get(target, property, receiver) {
      if (property === "hCycleActivationEvent") return delegatedActivationEvent;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as HCycleActivationControlLedgerDependenciesV1["client"];
}

async function runChild(state: Int32Array): Promise<void> {
  const data = dataRecord(workerData);
  if (data === null) throw new Error("invalid fixture worker data");
  const databasePath = validatedFixtureDatabase(data);
  const runtime = loadPrismaRuntime();
  const client = new runtime.PrismaClient({
    adapter: new runtime.PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout: 250 },
      { timestampFormat: "iso8601" },
    ),
  });
  try {
    const result = await appendHCycleActivationEventV1(
      {
        client: delegatedLedgerClient(client, state),
        clock: { now: () => new Date("2026-08-24T00:00:00.000Z") },
      },
      { schema: "h_cycle_activation_event_input_v1", eventKind: "disabled" },
    );
    markResult(
      state,
      result.ok === false && result.code === "activation_event_storage_failure"
        ? RESULT_EXPECTED_STORAGE_FAILURE
        : RESULT_UNEXPECTED,
    );
  } catch {
    markResult(state, RESULT_CHILD_FAILURE);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

const initialWorkerData = dataRecord(workerData);
const sharedState = initialWorkerData === null ? undefined : initialWorkerData.sharedState;
if (!(sharedState instanceof SharedArrayBuffer)) {
  throw new Error("invalid fixture worker data");
}
const state = new Int32Array(sharedState);
if (state.length < RESULT_READY + 1 || Atomics.load(state, RESULT) !== RESULT_PENDING) {
  throw new Error("invalid fixture worker data");
}
void runChild(state).catch(() => {
  markResult(state, RESULT_CHILD_FAILURE);
});
