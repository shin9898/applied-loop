import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

const BASE_SHA = "659c916dbe88504a0695bffb56e4be06e38f967e";
// SHA-256 of sorted UTF-8 records `${path}\t${gitBlobSha}\n` for the frozen
// non-A2/A5/A6/A7/A7B/A7C/A8B source surface. Later slices are exact,
// non-activation exceptions below.
const BASE_SRC_AGGREGATE_SHA256 = "b86cdd6a6a656144679b897822d467e30aa10c5a4ec49a42a95737ecc3c10def";
const A5_ALLOWED_SRC_PATHS = [
  "src/app/api/harness-runs/route.ts",
  "src/lib/harness-run-ingestion.test.ts",
  "src/lib/harness-run-ingestion.ts",
  "src/lib/harness-usage-backfill.test.ts",
  "src/lib/harness-usage-backfill.ts",
  "src/lib/harness-usage-evidence.test.ts",
  "src/lib/harness-usage-evidence.ts",
] as const;
const A6_ALLOWED_SRC_PATHS = [
  "src/components/living-atlas/atlas-daily-textbook.tsx",
  "src/components/living-atlas/atlas-weekly-textbook.tsx",
  "src/lib/actions.ts",
  "src/lib/gate-textbook-grading.test.ts",
  "src/lib/gate.ts",
  "src/lib/textbook-check-gate-origin.test.ts",
  "src/lib/textbook-check-gate-origin.ts",
  "src/lib/textbook-check-gate-promotion-core.ts",
  "src/lib/textbook-check-gate-promotion.test.ts",
  "src/lib/textbook-check-gate-promotion.ts",
] as const;
const A6_ADDITIVE_SRC_PATHS = [
  "src/lib/gate-textbook-grading.test.ts",
  "src/lib/textbook-check-gate-origin.test.ts",
  "src/lib/textbook-check-gate-origin.ts",
  "src/lib/textbook-check-gate-promotion-core.ts",
  "src/lib/textbook-check-gate-promotion.test.ts",
  "src/lib/textbook-check-gate-promotion.ts",
] as const;
const A6_MODIFIED_BASE_SRC_BLOBS: Readonly<Record<string, string>> = {
  "src/components/living-atlas/atlas-daily-textbook.tsx": "697089bdb72d3dea72887f5df616a6a4546f8392",
  "src/components/living-atlas/atlas-weekly-textbook.tsx": "85eaf62e4123d791e3509199c51948a3a74f963d",
  "src/lib/actions.ts": "22b6f06168a9882d7dc08ccf9056cd51437e4064",
  "src/lib/gate.ts": "0816b74ce9adb6e08404f5867aa201c851783a54",
};
const A6_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/components/living-atlas/atlas-daily-textbook.tsx",
  "src/components/living-atlas/atlas-weekly-textbook.tsx",
  "src/lib/actions.ts",
  "src/lib/gate.ts",
  "src/lib/textbook-check-gate-origin.ts",
  "src/lib/textbook-check-gate-promotion-core.ts",
  "src/lib/textbook-check-gate-promotion.ts",
] as const;
const A7_ALLOWED_SRC_PATHS = [
  "src/lib/daily-textbook.ts",
  "src/lib/weekly-textbook.ts",
  "src/lib/textbook-check-gate-origin.ts",
  "src/lib/textbook-check-gate-promotion-core.ts",
  "src/lib/textbook-check-evidence.test.ts",
  "src/lib/textbook-check-evidence.ts",
] as const;
const A7_ADDITIVE_SRC_PATHS = [
  "src/lib/textbook-check-evidence.test.ts",
  "src/lib/textbook-check-evidence.ts",
] as const;
const A7_MODIFIED_BASE_SRC_BLOBS: Readonly<Record<string, string>> = {
  "src/lib/daily-textbook.ts": "173faa764e4a702c8fdb822c1a99c5e78701f8cb",
  "src/lib/weekly-textbook.ts": "bc53a9bf196561d0a06e0ef149c708611bf431df",
};
const A7_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/daily-textbook.ts",
  "src/lib/weekly-textbook.ts",
  "src/lib/textbook-check-gate-origin.ts",
  "src/lib/textbook-check-gate-promotion-core.ts",
  "src/lib/textbook-check-evidence.ts",
] as const;
const A7B_ALLOWED_SRC_PATHS = [
  "src/lib/actions.ts",
  "src/lib/capture.ts",
  "src/lib/gate-answer.ts",
  "src/lib/gate-source-context.ts",
  "src/lib/gate.ts",
  "src/lib/h-cycle-evidence-adapter.test.ts",
  "src/lib/h-cycle-evidence-adapter.ts",
  "src/lib/h-cycle-projection.test.ts",
  "src/lib/h-cycle-projection.ts",
  "src/lib/requeue-failed-grading.ts",
  "src/lib/textbook-check-gate-history-writers.test.ts",
  "src/lib/textbook-check-gate-history.test.ts",
  "src/lib/textbook-check-gate-history.ts",
] as const;
const A7B_ADDITIVE_SRC_PATHS = [
  "src/lib/gate-source-context.ts",
  "src/lib/h-cycle-evidence-adapter.test.ts",
  "src/lib/h-cycle-evidence-adapter.ts",
  "src/lib/h-cycle-projection.test.ts",
  "src/lib/h-cycle-projection.ts",
  "src/lib/textbook-check-gate-history-writers.test.ts",
  "src/lib/textbook-check-gate-history.test.ts",
  "src/lib/textbook-check-gate-history.ts",
] as const;
const A7B_MODIFIED_BASE_SRC_BLOBS: Readonly<Record<string, string>> = {
  "src/lib/capture.ts": "4027b409bad6d6e3ad4b1ab54ca4e710442ce5c8",
  "src/lib/gate-answer.ts": "8440d20c14053cfd05e1ddfe8f928b7f2b90c1a8",
  "src/lib/requeue-failed-grading.ts": "12d2f85047ccf0a999a0a5e3491c09573b3275a4",
};
const A7B_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/actions.ts",
  "src/lib/capture.ts",
  "src/lib/gate-answer.ts",
  "src/lib/gate-source-context.ts",
  "src/lib/gate.ts",
  "src/lib/h-cycle-evidence-adapter.ts",
  "src/lib/h-cycle-projection.ts",
  "src/lib/requeue-failed-grading.ts",
  "src/lib/textbook-check-gate-history.ts",
] as const;
const A7C_ALLOWED_SRC_PATHS = [
  "src/lib/h-cycle-evidence-adapter.test.ts",
  "src/lib/h-cycle-evidence-adapter.ts",
  "src/lib/h-cycle-evidence-preview.test.ts",
  "src/lib/h-cycle-evidence-preview.ts",
  "src/lib/h-cycle-evidence-preview-query.ts",
] as const;
const A7C_ADDITIVE_SRC_PATHS = [
  "src/lib/h-cycle-evidence-preview.test.ts",
  "src/lib/h-cycle-evidence-preview.ts",
  "src/lib/h-cycle-evidence-preview-query.ts",
] as const;
const A7C_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/h-cycle-evidence-preview.ts",
  "src/lib/h-cycle-evidence-preview-query.ts",
] as const;
const A8B_ALLOWED_SRC_PATHS = [
  "src/lib/h-cycle-evaluation-record.test.ts",
  "src/lib/h-cycle-evaluation-record.ts",
  "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.ts",
  "src/lib/loop-jobs/state-machine.ts",
] as const;
const A8B_ADDITIVE_SRC_PATHS = [
  "src/lib/h-cycle-evaluation-record.test.ts",
  "src/lib/h-cycle-evaluation-record.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.ts",
] as const;
const A8B_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/h-cycle-evaluation-record.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.ts",
] as const;
const A8B2_ALLOWED_SRC_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts",
] as const;
const A8B2_ADDITIVE_SRC_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts",
] as const;
const A8B2_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts",
] as const;
const A8C0_ALLOWED_SRC_PATHS = [
  "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
] as const;
const A8C0_ADDITIVE_SRC_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts",
] as const;
const A8C0_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts",
] as const;
const A8C1_ALLOWED_SRC_PATHS = [
  "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
] as const;
const A8C1_ADDITIVE_SRC_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts",
] as const;
const A8C1_NON_ACTIVATION_PRODUCTION_PATHS = [
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts",
] as const;
const A8C2_ALLOWED_SRC_PATHS = [
  "src/lib/loop-jobs/raw-state-adapter.ts",
  "src/lib/loop-jobs/state-machine.ts",
  "src/lib/loop-jobs/delivery.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-one-shot-kind-isolation-v1.test.ts",
  "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
  "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts",
] as const;
const workerEntry = join(process.cwd(), "src/lib/loop-jobs/worker.mjs");

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function workerEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("LOOP_JOB_")) delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runEntry(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  entry = workerEntry,
) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: process.cwd(),
    env: workerEnv(overrides),
    encoding: "utf8",
    timeout: 10_000,
  });
}

function expectClosed(result: ReturnType<typeof runEntry>, code: string, exitCode: number) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, exitCode);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, `${JSON.stringify({ code })}\n`);
  assert.equal(result.stderr, "");
}

function combinedOutput(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(
    /(?:^\s*import\s+(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()\s*(["'])(.+?)\1/gm,
  )].map((match) => match[2]);
}

async function snapshot(paths: string[]) {
  const result = new Map<string, string | null>();
  for (const path of paths) {
    try {
      result.set(path, sha256(await readFile(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result.set(path, null);
    }
  }
  return result;
}

function clockAt(instant: Date) {
  return {
    now: () => new Date(instant),
    addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
    fromStorage: (value: string) => new Date(value),
  };
}

async function withDisposableClient<T>(
  databasePath: string,
  run: (fixture: { client: PrismaClient; url: string }) => Promise<T>,
): Promise<T> {
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout: 250 },
      { timestampFormat: "iso8601" },
    ),
  });
  try {
    return await run({ client, url: pathToFileURL(databasePath).href });
  } finally {
    await client.$disconnect();
  }
}

test("A2-CG4-T1 dormant-worker-and-disposable-db", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "applied-loop-a2-cg4-"));
  const nextOutput = join(process.cwd(), ".next");
  const savedNextOutput = join(fixtureRoot, "pre-test-next");
  let hadPreexistingNextOutput = false;
  try {
    await stat(nextOutput);
    hadPreexistingNextOutput = true;
    await rename(nextOutput, savedNextOutput);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const spacedDatabase = join(fixtureRoot, "worker target.db");
  const plainDatabase = join(fixtureRoot, "plain.db");
  const missingDatabase = join(fixtureRoot, "missing.db");
  const malformedDatabase = join(fixtureRoot, "payload-secret-token-secret.db");
  const nonTargetDatabase = join(fixtureRoot, "must-not-open.db");
  await writeFile(malformedDatabase, "payload=SECRET_PAYLOAD token=SECRET_TOKEN", "utf8");
  await writeFile(nonTargetDatabase, "pre-existing non-target sentinel", "utf8");
  const possibleRepositoryDatabases = [
    join(process.cwd(), "dev.db"),
    join(process.cwd(), "prisma/dev.db"),
    "/Users/koki/tools/applied-loop/dev.db",
    "/Users/koki/tools/applied-loop/prisma/dev.db",
  ];
  const protectedPaths = [...new Set(
    [...possibleRepositoryDatabases, nonTargetDatabase].flatMap((path) => [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]),
  )];
  const protectedBefore = await snapshot(protectedPaths);

  try {
    await t.test("phase-1 precedence, poison isolation, and canonical URL matrix", async () => {
      const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      assert.equal(packageJson.scripts["loop:worker"], "node src/lib/loop-jobs/worker.mjs");

      const isolated = join(fixtureRoot, "isolated-phase1");
      await mkdir(isolated);
      await copyFile(workerEntry, join(isolated, "worker.mjs"));
      await copyFile(
        join(process.cwd(), "src/lib/loop-jobs/worker-phase1.mjs"),
        join(isolated, "worker-phase1.mjs"),
      );
      expectClosed(runEntry([], { LOOP_JOB_WORKER_ENABLED: "1" }, join(isolated, "worker.mjs")), "worker_disabled", 1);
      expectClosed(
        runEntry(["--unknown"], { LOOP_JOB_WORKER_ENABLED: "1" }, join(isolated, "worker.mjs")),
        "worker_invalid_arguments",
        1,
      );

      const existingUrl = pathToFileURL(nonTargetDatabase).href;
      expectClosed(runEntry([], { LOOP_JOB_WORKER_ENABLED: "1", LOOP_JOB_DATABASE_URL: existingUrl }), "worker_disabled", 1);
      for (const args of [["--unknown"], ["--once", "extra"], ["extra", "--once"]]) {
        expectClosed(
          runEntry(args, { LOOP_JOB_WORKER_ENABLED: "1", LOOP_JOB_DATABASE_URL: existingUrl }),
          "worker_invalid_arguments",
          1,
        );
      }
      expectClosed(runEntry(["--once"], { LOOP_JOB_DATABASE_URL: "not-a-url" }), "worker_disabled", 1);

      const rejected = [
        undefined,
        nonTargetDatabase,
        "relative.db",
        ":memory:",
        "file:./a.db",
        `file:${nonTargetDatabase}`,
        `file://localhost${nonTargetDatabase}`,
        `file://example.com${nonTargetDatabase}`,
        `file://user@localhost${nonTargetDatabase}`,
        `file:////${nonTargetDatabase.replace(/^\/+/, "")}`,
        `${existingUrl}?mode=ro`,
        `${existingUrl}#fragment`,
        "file:///tmp/bad%escape.db",
        "file:///tmp/bad%00name.db",
        "file:///tmp/encoded%2Fslash.db",
        "file:///tmp/segment/../target.db",
        existingUrl.replace("must-not-open", "%6dust-not-open"),
        existingUrl.replace(/^file:/, "FILE:"),
        existingUrl.replace(/^file:/, "File:"),
      ];
      for (const raw of rejected) {
        expectClosed(
          runEntry(["--once"], { LOOP_JOB_WORKER_ENABLED: "1", LOOP_JOB_DATABASE_URL: raw }),
          "worker_database_url_invalid",
          1,
        );
      }

      const missingUrl = pathToFileURL(missingDatabase).href;
      expectClosed(
        runEntry(["--once"], { LOOP_JOB_WORKER_ENABLED: "1", LOOP_JOB_DATABASE_URL: missingUrl }),
        "worker_database_unavailable",
        1,
      );
      await assert.rejects(stat(missingDatabase), { code: "ENOENT" });
      expectClosed(
        runEntry(["--once"], {
          LOOP_JOB_WORKER_ENABLED: "1",
          LOOP_JOB_DATABASE_URL: pathToFileURL(malformedDatabase).href,
        }),
        "storage_failure",
        1,
      );
    });

    await t.test("artifact-only migration and adapter-resolved disposable runtime", async () => {
      execFileSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${spacedDatabase}` },
        stdio: "pipe",
      });
      await copyFile(spacedDatabase, plainDatabase);

      const adapterRequire = createRequire(require.resolve("@prisma/adapter-better-sqlite3"));
      const nestedMain = adapterRequire.resolve("better-sqlite3");
      let packageRoot = join(nestedMain, "..");
      while (true) {
        try {
          await stat(join(packageRoot, "package.json"));
          break;
        } catch {
          packageRoot = join(packageRoot, "..");
        }
      }
      const nestedPackage = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version: string };
      assert.equal(nestedPackage.version, "12.11.1");
      type DatabaseHandle = {
        prepare: (sql: string) => { get: () => { sql: string }; all: () => Array<{ name: string }> };
        close: () => void;
      };
      const Database = adapterRequire("better-sqlite3") as new (
        path: string,
        options: { fileMustExist: boolean },
      ) => DatabaseHandle;
      const database = new Database(spacedDatabase, { fileMustExist: true });
      const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='LoopJob'").get().sql;
      const indexes = database.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='LoopJob' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
      ).all().map((row) => row.name);
      database.close();
      assert.equal((tableSql.match(/CHECK/g) ?? []).length, 9);
      assert.equal(tableSql.includes("CURRENT_TIMESTAMP"), false);
      assert.deepEqual(indexes, [
        "LoopJob_dedupeKey_key",
        "LoopJob_status_availableAt_idx",
        "LoopJob_status_leaseExpiresAt_idx",
      ]);

      // `npm test` runs files concurrently. Generating into the repository's ignored
      // client directory here used to race A3's static walk and Prisma consumers.
      // Keep the generation proof, but make its output disposable just like this DB.
      const repositoryGeneratedClient = join(process.cwd(), "src/generated/prisma/client.ts");
      const generatedClientBefore = await readFile(repositoryGeneratedClient);
      const sourceSchema = await readFile(join(process.cwd(), "prisma/schema.prisma"), "utf8");
      const isolatedOutputSchema = sourceSchema.replace(
        /^(\s*output\s*=\s*)"[^"]+"\s*$/m,
        '$1"./generated"',
      );
      assert.notEqual(isolatedOutputSchema, sourceSchema, "schema must declare one generator output to isolate");
      const isolatedSchema = join(fixtureRoot, "schema.prisma");
      await writeFile(isolatedSchema, isolatedOutputSchema, "utf8");
      execFileSync("npx", ["prisma", "generate", "--schema", isolatedSchema], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${spacedDatabase}` },
        stdio: "pipe",
      });
      const isolatedClient = join(fixtureRoot, "generated/client.ts");
      assert.equal((await stat(isolatedClient)).isFile(), true);
      assert.deepEqual(await readFile(repositoryGeneratedClient), generatedClientBefore);
      execFileSync("npx", ["tsc", "--noEmit"], { cwd: process.cwd(), stdio: "pipe" });
    });

    await t.test("enabled one-shot opens only canonical existing target and claims at most one", async () => {
      const spacedUrl = pathToFileURL(spacedDatabase).href;
      assert.match(spacedUrl, /%20/);
      const common = {
        LOOP_JOB_WORKER_ENABLED: "1",
        DATABASE_URL: pathToFileURL(nonTargetDatabase).href,
      };
      expectClosed(
        runEntry(["--once"], { ...common, LOOP_JOB_DATABASE_URL: spacedUrl }),
        "no_job",
        0,
      );
      expectClosed(
        runEntry(["--once"], { ...common, LOOP_JOB_DATABASE_URL: pathToFileURL(plainDatabase).href }),
        "no_job",
        0,
      );
      const human = spawnSync("npm", ["run", "loop:worker", "--", "--once"], {
        cwd: process.cwd(),
        env: workerEnv({ ...common, LOOP_JOB_DATABASE_URL: pathToFileURL(plainDatabase).href }),
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(human.error, undefined);
      assert.equal(human.status, 0);
      assert.equal(human.stderr, "");
      assert.match(human.stdout, /\{"code":"no_job"\}\n$/);

      const registry = defineLoopJobRegistry({
        cli_probe: {
          version: "v1",
          fields: {
            entityId: { type: "opaque_id", prefix: "entity" },
            operation: { type: "enum", values: ["probe"] as const },
            artifactHash: { type: "hash" },
          },
          dedupeFields: ["entityId"] as const,
        },
      });
      let next = 1;
      await withDisposableClient(spacedDatabase, async ({ client }) => {
        const queue = createLoopJobQueue({
          client,
          registry,
          clock: clockAt(new Date("2020-01-01T00:00:00.000Z")),
          randomBytes(length) {
            const bytes = new Uint8Array(length);
            for (let index = 0; index < length; index += 1) {
              bytes[index] = next % 256;
              next += 1;
            }
            return bytes;
          },
        });
        for (const byte of ["1", "2"]) {
          const result = await queue.enqueue({
            kind: "cli_probe",
            payload: {
              entityId: `entity_${byte.repeat(32)}`,
              operation: "probe",
              artifactHash: "a".repeat(64),
            },
            maxAttempts: 3,
          });
          assert.equal(result.ok, true);
        }
      });

      const automation = spawnSync("npm", ["run", "--silent", "loop:worker", "--", "--once"], {
        cwd: process.cwd(),
        env: workerEnv({ ...common, LOOP_JOB_DATABASE_URL: spacedUrl }),
        encoding: "utf8",
        timeout: 10_000,
      });
      expectClosed(automation, "job_retry_scheduled", 0);

      const rows = await withDisposableClient(spacedDatabase, async ({ client }) => (
        client.loopJob.findMany({ orderBy: { id: "asc" } })
      ));
      assert.equal(rows.length, 2);
      assert.equal(rows.reduce((sum, row) => sum + row.attempts, 0), 1);
      assert.equal(rows.filter((row) => row.status === "retry_wait").length, 1);
      assert.equal(rows.filter((row) => row.status === "queued").length, 1);
    });

    await t.test("base source bytes and all non-activation entrypoints remain isolated", async () => {
      const trackedSourcePaths = execFileSync("git", ["ls-files", "src"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim().split("\n").filter(Boolean)
        .filter((path) => !path.startsWith("src/lib/loop-jobs/"))
        .filter((path) => !(A5_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A6_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A7_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A7B_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A7C_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A8B_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A8B2_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A8C0_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .filter((path) => !(A8C1_ADDITIVE_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.equal(trackedSourcePaths.length, 258);
      const currentBaseAggregate = trackedSourcePaths.map((path) => {
        const blob = A7_MODIFIED_BASE_SRC_BLOBS[path]
          ?? A6_MODIFIED_BASE_SRC_BLOBS[path]
          ?? A7B_MODIFIED_BASE_SRC_BLOBS[path]
          ?? execFileSync("git", ["hash-object", path], {
            cwd: process.cwd(),
            encoding: "utf8",
          }).trim();
        return `${path}\t${blob}\n`;
      }).join("");
      assert.equal(sha256(currentBaseAggregate), BASE_SRC_AGGREGATE_SHA256);

      const localBaseObject = spawnSync("git", ["cat-file", "-e", `${BASE_SHA}^{commit}`], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      if (localBaseObject.status === 0) {
        const tree = execFileSync("git", ["ls-tree", "-r", BASE_SHA, "src"], {
          cwd: process.cwd(),
          encoding: "utf8",
        }).trim().split("\n").filter(Boolean)
          .filter((line) => {
            const path = line.split("\t")[1];
            return path === undefined
              || (
                !(A5_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
                && !(A6_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A7_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A7B_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A7C_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A8B_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A8B2_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A8C0_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
                && !(A8C1_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
              );
          });
        assert.equal(tree.length, 258);
        for (const line of tree) {
          const match = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
          assert.ok(match, `unexpected ls-tree line: ${line}`);
          const [, expectedBlob, path] = match;
          const modifiedBaseBlob = A7_MODIFIED_BASE_SRC_BLOBS[path]
            ?? A6_MODIFIED_BASE_SRC_BLOBS[path]
            ?? A7B_MODIFIED_BASE_SRC_BLOBS[path];
          if (modifiedBaseBlob !== undefined) {
            assert.equal(expectedBlob, modifiedBaseBlob, path);
            continue;
          }
          assert.equal(
            execFileSync("git", ["hash-object", path], { cwd: process.cwd(), encoding: "utf8" }).trim(),
            expectedBlob,
            path,
          );
        }
      }

      const explicitOwners: Record<string, string> = {
        "src/app/api/events/route.ts": "8363abdb261b7065c2d6e10be0b1ef3177df1503",
        "src/app/api/mcp/route.ts": "ea64596660de738fff0b7ad7128b616d8eade17c",
        "src/lib/weakness.ts": "f045f9e26e0f005fae8b4225eb9acf99028ed8ae",
        "src/lib/harness-patterns.ts": "27f4492a8224f3e5423d677fd950a1e48dccd97b",
        "src/lib/db.ts": "dfe55d5b3eff55d12a0a5307eb12b4691b4d5c5e",
      };
      for (const [path, expectedBlob] of Object.entries(explicitOwners)) {
        const current = await readFile(join(process.cwd(), path));
        assert.equal(
          execFileSync("git", ["hash-object", path], { cwd: process.cwd(), encoding: "utf8" }).trim(),
          expectedBlob,
          path,
        );
        assert.equal(current.includes(Buffer.from("loop-jobs")), false, path);
      }

      const untrackedSource = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "src"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim().split("\n").filter(Boolean);
      assert.equal(
        untrackedSource.every(
          (path) => path.startsWith("src/lib/loop-jobs/")
            || (A5_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A6_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A7_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A7B_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A7C_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A8B_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A8B2_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A8C0_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A8C1_ALLOWED_SRC_PATHS as readonly string[]).includes(path)
            || (A8C2_ALLOWED_SRC_PATHS as readonly string[]).includes(path),
        ),
        true,
      );
      const discoveredA5Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A5_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA5Sources, [...A5_ALLOWED_SRC_PATHS].sort());
      const discoveredA6Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A6_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA6Sources, [...A6_ALLOWED_SRC_PATHS].sort());
      const discoveredA7Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A7_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA7Sources, [...A7_ALLOWED_SRC_PATHS].sort());
      const discoveredA7BSources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A7B_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA7BSources, [...A7B_ALLOWED_SRC_PATHS].sort());
      const discoveredA7CSources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A7C_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA7CSources, [...A7C_ALLOWED_SRC_PATHS].sort());
      const discoveredA8BSources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A8B_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA8BSources, [...A8B_ALLOWED_SRC_PATHS].sort());
      const discoveredA8B2Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A8B2_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA8B2Sources, [...A8B2_ALLOWED_SRC_PATHS].sort());
      const discoveredA8C0Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A8C0_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA8C0Sources, [...A8C0_ALLOWED_SRC_PATHS].sort());
      const discoveredA8C1Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A8C1_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA8C1Sources, [...A8C1_ALLOWED_SRC_PATHS].sort());
      const discoveredA8C2Sources = [
        ...execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
          .trim().split("\n").filter(Boolean),
        ...untrackedSource,
      ]
        .filter((path) => (A8C2_ALLOWED_SRC_PATHS as readonly string[]).includes(path))
        .sort();
      assert.deepEqual(discoveredA8C2Sources, [...A8C2_ALLOWED_SRC_PATHS].sort());
      for (const path of A5_ALLOWED_SRC_PATHS.filter((path) => !path.endsWith(".test.ts"))) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
          path,
        );
      }
      assert.deepEqual(
        Object.keys(A6_MODIFIED_BASE_SRC_BLOBS).sort(),
        A6_ALLOWED_SRC_PATHS.filter((path) => !(A6_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)).sort(),
      );
      assert.deepEqual(
        Object.keys(A7B_MODIFIED_BASE_SRC_BLOBS).sort(),
        A7B_ALLOWED_SRC_PATHS.filter(
          (path) => !(A7B_ADDITIVE_SRC_PATHS as readonly string[]).includes(path)
            && A6_MODIFIED_BASE_SRC_BLOBS[path] === undefined,
        ).sort(),
      );
      for (const path of A6_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
          path,
        );
      }
      for (const path of A7_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
          path,
        );
      }
      for (const path of A7B_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
          path,
        );
      }
      for (const path of A7C_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
          path,
        );
      }
      for (const path of A8B_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|runOneShotWorker|runOneDelivery|runHCycleEvidencePreviewCli)/,
          path,
        );
      }
      for (const path of A8B2_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|runOneShotWorker|runOneDelivery|runHCycleEvidencePreviewCli|queryReadonlyHCycleEvidencePreviewSnapshotV1|createReadonlyHCycleEvidencePreviewClient|DATABASE_URL|PrismaClient|PrismaBetterSqlite3|launchd)/,
          path,
        );
      }
      for (const path of A8C0_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|runOneShotWorker|runOneDelivery|runHCycleEvidencePreviewCli|buildHCycleEvidencePreviewV1|queryHCycleEvidencePreviewSnapshotV1|queryReadonlyHCycleEvidencePreviewSnapshotV1|createReadonlyHCycleEvidencePreviewClient|deriveHCycleEvaluateTimingV1|planHCycleEvaluateV1|createHCycleEvaluateDormantHandlerV1|DATABASE_URL|PrismaClient|PrismaBetterSqlite3|launchd)/,
          path,
        );
      }
      for (const path of A8C1_NON_ACTIVATION_PRODUCTION_PATHS) {
        const source = await readFile(join(process.cwd(), path), "utf8");
        assert.doesNotMatch(
          source,
          /(?:loop:worker|worker-phase[12]|runOneShotWorker|runOneDelivery|runHCycleEvidencePreviewCli|buildHCycleEvidencePreviewV1|queryHCycleEvidencePreviewSnapshotV1|queryReadonlyHCycleEvidencePreviewSnapshotV1|createReadonlyHCycleEvidencePreviewClient|deriveHCycleEvaluateTimingV1|planHCycleEvaluateV1|createHCycleEvaluateDormantHandlerV1|createLoopJobQueue|defineLoopJobRegistry|DATABASE_URL|DOTENV_CONFIG_PATH|PrismaBetterSqlite3|launchctl|\.plist|ProgramArguments|StartInterval|StartCalendarInterval|RunAtLoad|KeepAlive)/,
          path,
        );
      }

      const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      for (const [name, command] of Object.entries(packageJson.scripts)) {
        if (name !== "loop:worker") assert.equal(command.includes("loop:worker"), false, name);
      }
      const workerSource = await readFile(workerEntry, "utf8");
      const phase1Source = await readFile(join(process.cwd(), "src/lib/loop-jobs/worker-phase1.mjs"), "utf8");
      assert.deepEqual(
        importSpecifiers(workerSource).filter((value) => !value.startsWith("node:")),
        ["./worker-phase1.mjs"],
      );
      const phase1Specifiers = importSpecifiers(phase1Source);
      assert.deepEqual(phase1Specifiers, ["node:fs", "node:path", "node:url"]);
      assert.equal(phase1Specifiers.every((specifier) => specifier.startsWith("node:")), true);
      assert.match(workerSource, /\["--import", "tsx", phase2Entry, authorization\.databasePath\]/);
      assert.equal(/(?:prisma|tsx|generated|adapter|state-machine|delivery)/i.test(phase1Source), false);

      const repositoryRealpath = await realpath(process.cwd());
      const nodeModulesRealpath = await realpath(join(process.cwd(), "node_modules"));
      const nodeModulesLocation = relative(repositoryRealpath, nodeModulesRealpath);
      const nodeModulesAreExternal = nodeModulesLocation === ".."
        || nodeModulesLocation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
        || isAbsolute(nodeModulesLocation);
      const buildEnv = workerEnv({
        DATABASE_URL: `file:${spacedDatabase}`,
        MCP_TOKEN: "replace-with-a-long-random-string",
        MCP_SURFACE: "core",
        ENABLE_TERMINAL: "true",
      });
      assert.equal(buildEnv.DATABASE_URL, `file:${spacedDatabase}`);
      assert.equal(Object.keys(buildEnv).some((key) => key.startsWith("LOOP_JOB_")), false);
      const defaultBuild = spawnSync("npm", ["run", "build"], {
        cwd: process.cwd(),
        env: buildEnv,
        encoding: "utf8",
        timeout: 120_000,
      });
      assert.equal(defaultBuild.error, undefined);
      const defaultBuildOutput = combinedOutput(defaultBuild);
      assert.doesNotMatch(defaultBuildOutput, /src\/lib\/loop-jobs/);
      if (!nodeModulesAreExternal) {
        assert.equal(defaultBuild.status, 0, defaultBuildOutput);
      } else {
        assert.notEqual(defaultBuild.status, 0);
        assert.match(defaultBuildOutput, /Next\.js 16\.2\.12 \(Turbopack\)/);
        assert.match(
          defaultBuildOutput,
          /Symlink \[project\]\/node_modules is invalid, it points out of the filesystem root/,
        );
        await rm(nextOutput, { recursive: true, force: true });

        const webpackBuild = spawnSync("npm", ["run", "build", "--", "--webpack"], {
          cwd: process.cwd(),
          env: buildEnv,
          encoding: "utf8",
          timeout: 120_000,
        });
        assert.equal(webpackBuild.error, undefined);
        assert.notEqual(webpackBuild.status, 0);
        const webpackBuildOutput = combinedOutput(webpackBuild);
        assert.match(webpackBuildOutput, /Next\.js 16\.2\.12 \(webpack\)/);
        assert.match(webpackBuildOutput, /Compiled successfully/);
        assert.match(webpackBuildOutput, /src\/app\/\(app\)\/entries\/\[id\]\/page\.tsx/);
        assert.doesNotMatch(webpackBuildOutput, /src\/lib\/loop-jobs/);

        const generatedTypeCheck = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
          cwd: process.cwd(),
          env: workerEnv(),
          encoding: "utf8",
          timeout: 120_000,
        });
        assert.equal(generatedTypeCheck.error, undefined);
        assert.notEqual(generatedTypeCheck.status, 0);
        const generatedTypeOutput = combinedOutput(generatedTypeCheck);
        assert.doesNotMatch(generatedTypeOutput, /src\/lib\/loop-jobs|loop-jobs/);
        const observedTypeDebts = generatedTypeOutput
          .split("\n")
          .filter((line) => line.includes("error TS"))
          .map((line) => {
            const match = line.match(/^\.next\/types\/(.+)\(\d+,\d+\): error TS\d+:/);
            assert.ok(match, `unexpected generated type error: ${line}`);
            return match[1];
          });
        assert.deepEqual(observedTypeDebts, [
          "app/(app)/entries/[id]/page.ts",
          "app/(app)/gates/[id]/page.ts",
          "app/(app)/gates/page.ts",
          "app/(app)/inbox/[id]/page.ts",
          "app/(app)/zukan/[id]/page.ts",
        ]);
      }
    });
  } finally {
    const protectedAfter = await snapshot(protectedPaths);
    assert.deepEqual(protectedAfter, protectedBefore);
    await rm(nextOutput, { recursive: true, force: true });
    if (hadPreexistingNextOutput) await rename(savedNextOutput, nextOutput);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
