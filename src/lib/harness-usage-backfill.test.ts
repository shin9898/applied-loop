import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildHarnessUsageBackfillPlan,
  queryHarnessUsageBackfill,
  runHarnessUsageBackfillCli,
  type HarnessUsageBackfillQueryClient,
  type HarnessUsageBackfillRow,
} from "./harness-usage-backfill";

function legacyRow(overrides: Partial<HarnessUsageBackfillRow> = {}): HarnessUsageBackfillRow {
  return {
    harness: "claude",
    tokensIn: 10,
    cacheRead: 30,
    cacheCreate: 10,
    inputTotalTokens: null,
    inputUncachedTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    usageSemanticsVersion: null,
    usageNormalizationStatus: null,
    usageNormalizationReason: null,
    ...overrides,
  };
}

describe("A5 usage evidence backfill plan", () => {
  it("A5-CG4-T1 keeps the migration and HarnessRun evidence surface additive and exact", () => {
    const migrationPath = join(
      process.cwd(),
      "prisma/migrations/20260823145705_harness_usage_evidence/migration.sql",
    );
    assert.equal(
      readFileSync(migrationPath, "utf8"),
      `-- AlterTable
ALTER TABLE "HarnessRun" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "cacheWriteTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "collectorVersion" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "contextFingerprint" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "inputTotalTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "inputUncachedTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "usageNormalizationReason" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "usageNormalizationStatus" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "usageSemanticsVersion" TEXT;
`,
    );

    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const harnessRun = schema.match(/model HarnessRun \{([\s\S]*?)\n\}/);
    assert.notEqual(harnessRun, null);
    if (harnessRun === null) return;
    const fields = harnessRun[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("@@"))
      .map((line) => line.split(/\s+/, 1)[0]);
    assert.deepEqual(fields, [
      "id",
      "harness",
      "sessionId",
      "model",
      "repo",
      "tools",
      "tokensIn",
      "tokensOut",
      "cacheRead",
      "cacheCreate",
      "thinking",
      "turns",
      "inputTotalTokens",
      "inputUncachedTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "usageSemanticsVersion",
      "usageNormalizationStatus",
      "usageNormalizationReason",
      "collectorVersion",
      "contextFingerprint",
      "startedAt",
      "endedAt",
    ]);
  });

  it("A5-CG3-T1 reports only aggregate prospective evidence changes", async () => {
    const rows = [
      legacyRow(),
      legacyRow({ harness: "codex", tokensIn: 0, cacheRead: 0, cacheCreate: 0 }),
      legacyRow({ harness: "codex", tokensIn: 10, cacheRead: 11, cacheCreate: 0 }),
      legacyRow({
        inputTotalTokens: 50,
        inputUncachedTokens: 10,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        usageSemanticsVersion: "harness-usage-v1",
        usageNormalizationStatus: "supported",
      }),
    ];

    assert.deepEqual(buildHarnessUsageBackfillPlan(rows), {
      schemaVersion: "harness-usage-backfill-plan-v1",
      mode: "dry_run",
      source: {
        totalRows: 4,
        legacyUnprojectedRows: 3,
        existingEvidenceRows: 1,
      },
      proposal: {
        wouldWriteRows: 3,
        statusCounts: {
          supported: 1,
          no_sample: 1,
          invalid: 1,
          unsupported: 0,
        },
        reasonCounts: {
          cache_read_exceeds_total: 1,
          zero_total: 1,
        },
        derivedFieldChanges: {
          inputTotalTokens: { nonNull: 2, null: 1 },
          inputUncachedTokens: { nonNull: 2, null: 1 },
          cacheReadTokens: { nonNull: 2, null: 1 },
          cacheWriteTokens: { nonNull: 1, null: 2 },
          usageSemanticsVersion: { nonNull: 3, null: 0 },
          usageNormalizationStatus: { nonNull: 3, null: 0 },
          usageNormalizationReason: { nonNull: 2, null: 1 },
        },
      },
    });

    const calls: unknown[] = [];
    let disconnectCount = 0;
    const client: HarnessUsageBackfillQueryClient = {
      harnessRun: {
        findMany: async (args) => {
          calls.push(args);
          return rows;
        },
      },
      $disconnect: async () => {
        disconnectCount += 1;
      },
    };
    assert.deepEqual(await queryHarnessUsageBackfill(client), buildHarnessUsageBackfillPlan(rows));
    assert.equal(disconnectCount, 1);
    assert.deepEqual(calls, [{
      select: {
        harness: true,
        tokensIn: true,
        cacheRead: true,
        cacheCreate: true,
        inputTotalTokens: true,
        inputUncachedTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        usageSemanticsVersion: true,
        usageNormalizationStatus: true,
        usageNormalizationReason: true,
      },
    }]);
  });

  it("A5-CG3-T2 keeps CLI errors closed and success output automation-safe", async () => {
    const report = buildHarnessUsageBackfillPlan([]);
    for (const testCase of [
      { args: [], code: "missing_required_option" },
      { args: ["--unknown"], code: "unknown_option" },
      { args: ["--json", "--json"], code: "duplicate_option" },
    ] as const) {
      let stdout = "";
      let stderr = "";
      let queryCount = 0;
      const exitCode = await runHarnessUsageBackfillCli(testCase.args, {
        query: async () => {
          queryCount += 1;
          return report;
        },
        stdout: (text) => { stdout += text; },
        stderr: (text) => { stderr += text; },
      });
      assert.equal(exitCode, 1, testCase.code);
      assert.equal(stdout, "", testCase.code);
      assert.equal(stderr, `error: ${testCase.code}\n`, testCase.code);
      assert.equal(queryCount, 0, testCase.code);
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runHarnessUsageBackfillCli(["--json"], {
      query: async () => report,
      stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; },
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.equal(stdout, `${JSON.stringify(report)}\n`);
    assert.deepEqual(JSON.parse(stdout), report);
  });

  it("A5-CG3-T3 runs against a disposable migrated SQLite file without changing it", () => {
    type FixtureDatabase = {
      exec(sql: string): void;
      prepare(sql: string): { run(...values: unknown[]): unknown };
      close(): void;
    };
    type FixtureDatabaseConstructor = new (path: string) => FixtureDatabase;
    const testRequire = createRequire(import.meta.url);
    const adapterRequire = createRequire(testRequire.resolve("@prisma/adapter-better-sqlite3"));
    const Database = adapterRequire("better-sqlite3") as FixtureDatabaseConstructor;
    const fixtureDir = mkdtempSync(join(tmpdir(), "harness-a5-backfill-"));
    const fixturePath = join(fixtureDir, "evidence.db");
    const sidecarNames = ["evidence.db-wal", "evidence.db-shm", "evidence.db-journal"];
    const sidecars = () => readdirSync(fixtureDir).filter((name) => sidecarNames.includes(name)).sort();
    const sha256 = () => createHash("sha256").update(readFileSync(fixturePath)).digest("hex");
    const commandEnv = (databaseUrl: string) => {
      const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === "npm_config_loglevel" || key.toLowerCase() === "npm_config_silent") {
          delete env[key];
        }
      }
      return env;
    };

    try {
      const migration = spawnSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: commandEnv(`file:${fixturePath}`),
        encoding: "utf8",
      });
      assert.equal(migration.status, 0, migration.stderr);

      const fixture = new Database(fixturePath);
      const insert = fixture.prepare(
        "INSERT INTO HarnessRun (id, harness, sessionId, tokensIn, cacheRead, cacheCreate, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run("row_claude", "claude", "c1", 10, 30, 10, "2026-08-23T00:00:00.000Z");
      insert.run("row_codex", "codex", "x1", 100, 80, 0, "2026-08-23T00:00:00.000Z");
      fixture.close();

      const beforeHash = sha256();
      const beforeSidecars = sidecars();
      const command = spawnSync(
        "npm",
        ["run", "--silent", "harness:plan-usage-backfill", "--", "--json"],
        { cwd: process.cwd(), encoding: "utf8", env: commandEnv(`file:${fixturePath}`) },
      );
      assert.equal(command.status, 0, command.stderr);
      assert.equal(command.stderr, "");
      const report = JSON.parse(command.stdout);
      assert.equal(command.stdout, `${JSON.stringify(report)}\n`);
      assert.deepEqual(report.source, {
        totalRows: 2,
        legacyUnprojectedRows: 2,
        existingEvidenceRows: 0,
      });
      assert.equal(report.proposal.wouldWriteRows, 2);
      assert.doesNotMatch(command.stdout, /(?:row_claude|row_codex|\bc1\b|\bx1\b)/);
      assert.equal(sha256(), beforeHash);
      assert.deepEqual(sidecars(), beforeSidecars);

      const missingPath = join(fixtureDir, "missing.db");
      const missing = spawnSync(
        "npm",
        ["run", "--silent", "harness:plan-usage-backfill", "--", "--json"],
        { cwd: process.cwd(), encoding: "utf8", env: commandEnv(`file:${missingPath}`) },
      );
      assert.notEqual(missing.status, 0);
      assert.equal(missing.stdout, "");
      assert.equal(missing.stderr, "error: query_failed\n");
      assert.equal(existsSync(missingPath), false);
      assert.equal(existsSync(`${missingPath}-wal`), false);
      assert.equal(existsSync(`${missingPath}-shm`), false);
      assert.equal(existsSync(`${missingPath}-journal`), false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
