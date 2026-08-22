import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  buildHarnessCacheAuditReport,
  parseHarnessAuditWeek,
} from "./harness-cache-audit";
import { runHarnessCacheAuditCli } from "./harness-cache-audit-cli";
import {
  queryHarnessCacheAudit,
  queryReadonlyHarnessCacheAudit,
  type HarnessAuditQueryClient,
} from "./harness-cache-audit-query";

describe("harness cache audit adapter and CLI", () => {
  it("A1-CG3-T1 performs one minimal half-open query and always disconnects", async () => {
    const parsedWeek = parseHarnessAuditWeek("2026-W34");
    assert.equal(parsedWeek.ok, true);
    if (!parsedWeek.ok) return;

    const calls: unknown[] = [];
    let disconnectCount = 0;
    const emptyClient: HarnessAuditQueryClient = {
      harnessRun: {
        findMany: async (args) => {
          calls.push(args);
          return [];
        },
      },
      $disconnect: async () => {
        disconnectCount += 1;
      },
    };
    const emptyReport = await queryHarnessCacheAudit(emptyClient, parsedWeek);
    assert.deepEqual(calls, [
      {
        where: {
          startedAt: {
            gte: new Date("2026-08-16T15:00:00.000Z"),
            lt: new Date("2026-08-23T15:00:00.000Z"),
          },
        },
        select: {
          harness: true,
          tokensIn: true,
          cacheRead: true,
          cacheCreate: true,
        },
      },
    ]);
    assert.equal(disconnectCount, 1);
    assert.equal(emptyReport.summary.queried, 0);
    assert.deepEqual(emptyReport.segments, []);

    let rejectedDisconnectCount = 0;
    const rejectingClient: HarnessAuditQueryClient = {
      harnessRun: {
        findMany: async () => {
          throw new Error("query exploded");
        },
      },
      $disconnect: async () => {
        rejectedDisconnectCount += 1;
      },
    };
    await assert.rejects(
      queryHarnessCacheAudit(rejectingClient, parsedWeek),
      /query exploded/,
    );
    assert.equal(rejectedDisconnectCount, 1);

    const fixtureDir = mkdtempSync(join(tmpdir(), "harness-audit-missing-"));
    try {
      const missingDb = join(fixtureDir, "does-not-exist.db");
      await assert.rejects(
        queryReadonlyHarnessCacheAudit(`file:${missingDb}`, parsedWeek),
      );
      assert.equal(existsSync(missingDb), false);
      assert.deepEqual(readdirSync(fixtureDir), []);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("A1-CG3-T2 keeps option errors stable and output automation-safe", async () => {
    const parsedWeek = parseHarnessAuditWeek("2026-W34");
    assert.equal(parsedWeek.ok, true);
    if (!parsedWeek.ok) return;

    const emptyReport = buildHarnessCacheAuditReport(parsedWeek, []);
    const optionCases = [
      { args: [], code: "missing_required_option" },
      { args: ["--week"], code: "missing_option_value" },
      { args: ["--unknown"], code: "unknown_option" },
      {
        args: ["--week", "2026-W34", "--week", "2026-W34"],
        code: "duplicate_option",
      },
      {
        args: ["--week", "2026-W34", "--week", "2026-W35"],
        code: "duplicate_option",
      },
      { args: ["--week", "2021-W53"], code: "invalid_iso_week" },
    ] as const;

    for (const testCase of optionCases) {
      let stdout = "";
      let stderr = "";
      let queryCount = 0;
      const exitCode = await runHarnessCacheAuditCli(testCase.args, {
        query: async () => {
          queryCount += 1;
          return emptyReport;
        },
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
      });
      assert.equal(exitCode, 1, testCase.code);
      assert.equal(stdout, "", testCase.code);
      assert.equal(stderr, `error: ${testCase.code}\n`, testCase.code);
      assert.equal(queryCount, 0, testCase.code);
    }

    let jsonStdout = "";
    let jsonStderr = "";
    let jsonQueryCount = 0;
    const jsonExit = await runHarnessCacheAuditCli(
      ["--json", "--week", "2026-W34", "--json", "--json"],
      {
        query: async () => {
          jsonQueryCount += 1;
          return emptyReport;
        },
        stdout: (text) => {
          jsonStdout += text;
        },
        stderr: (text) => {
          jsonStderr += text;
        },
      },
    );
    assert.equal(jsonExit, 0);
    assert.equal(jsonStderr, "");
    assert.equal(jsonQueryCount, 1);
    assert.deepEqual(JSON.parse(jsonStdout), emptyReport);
    assert.equal(jsonStdout, `${JSON.stringify(emptyReport)}\n`);

    let failedStdout = "";
    let failedStderr = "";
    const failedExit = await runHarnessCacheAuditCli(
      ["--week", "2026-W34", "--json"],
      {
        query: async () => {
          throw new Error("database unavailable");
        },
        stdout: (text) => {
          failedStdout += text;
        },
        stderr: (text) => {
          failedStderr += text;
        },
      },
    );
    assert.equal(failedExit, 1);
    assert.equal(failedStdout, "");
    assert.equal(failedStderr, "error: query_failed\n");

    const humanReport = buildHarnessCacheAuditReport(parsedWeek, [
      { harness: "claude", tokensIn: 10, cacheRead: 30, cacheCreate: 10 },
    ]);
    let humanStdout = "";
    const humanExit = await runHarnessCacheAuditCli(["--week", "2026-W34"], {
      query: async () => humanReport,
      stdout: (text) => {
        humanStdout += text;
      },
      stderr: () => {},
    });
    assert.equal(humanExit, 0);
    assert.match(humanStdout, /Normalized cache-reuse rate: 60\.000%/);

    const unsupportedReport = buildHarnessCacheAuditReport(parsedWeek, [
      { harness: "other", tokensIn: 1, cacheRead: 0, cacheCreate: 0 },
    ]);
    let unsupportedStdout = "";
    const unsupportedExit = await runHarnessCacheAuditCli(
      ["--week", "2026-W34", "--json"],
      {
        query: async () => unsupportedReport,
        stdout: (text) => {
          unsupportedStdout += text;
        },
        stderr: () => {},
      },
    );
    assert.equal(unsupportedExit, 0);
    assert.equal(JSON.parse(unsupportedStdout).summary.excluded, 1);

    const overflowReport = buildHarnessCacheAuditReport(parsedWeek, [
      {
        harness: "codex",
        tokensIn: Number.MAX_SAFE_INTEGER,
        cacheRead: 1,
        cacheCreate: 0,
      },
    ]);
    let overflowStdout = "";
    let overflowStderr = "";
    const overflowExit = await runHarnessCacheAuditCli(
      ["--week", "2026-W34", "--json"],
      {
        query: async () => overflowReport,
        stdout: (text) => {
          overflowStdout += text;
        },
        stderr: (text) => {
          overflowStderr += text;
        },
      },
    );
    assert.equal(overflowExit, 1);
    assert.equal(JSON.parse(overflowStdout).summary.calculationErrorCount, 1);
    assert.equal(overflowStderr, "error: aggregate_overflow\n");
  });

  it("A1-CG3-T3 audits a disposable SQLite fixture without changing it", () => {
    type FixtureDatabase = {
      exec(sql: string): void;
      prepare(sql: string): { run(...values: unknown[]): unknown };
      close(): void;
    };
    type FixtureDatabaseConstructor = new (path: string) => FixtureDatabase;
    const Database = createRequire(import.meta.url)(
      "better-sqlite3",
    ) as FixtureDatabaseConstructor;
    const fixtureDir = mkdtempSync(join(tmpdir(), "harness-audit-smoke-"));
    const fixturePath = join(fixtureDir, "fixture.db");
    const sidecarNames = [
      "fixture.db-wal",
      "fixture.db-shm",
      "fixture.db-journal",
    ];
    const adjacentSidecars = () =>
      readdirSync(fixtureDir)
        .filter((name) => sidecarNames.includes(name))
        .sort();
    const sha256 = () =>
      createHash("sha256").update(readFileSync(fixturePath)).digest("hex");
    const commandEnv = (databaseUrl: string) => {
      const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
      for (const key of Object.keys(env)) {
        const normalizedKey = key.toLowerCase();
        if (
          normalizedKey === "npm_config_loglevel" ||
          normalizedKey === "npm_config_silent"
        ) {
          delete env[key];
        }
      }
      return env;
    };

    try {
      const fixture = new Database(fixturePath);
      fixture.exec(`
        CREATE TABLE HarnessRun (
          id TEXT PRIMARY KEY NOT NULL,
          harness TEXT NOT NULL,
          sessionId TEXT NOT NULL,
          tokensIn INTEGER NOT NULL DEFAULT 0,
          cacheRead INTEGER NOT NULL DEFAULT 0,
          cacheCreate INTEGER NOT NULL DEFAULT 0,
          startedAt DATETIME NOT NULL
        )
      `);
      const insert = fixture.prepare(
        "INSERT INTO HarnessRun (id, harness, sessionId, tokensIn, cacheRead, cacheCreate, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run("in-claude", "claude", "c1", 10, 30, 10, "2026-08-17T00:00:00.000Z");
      insert.run("in-codex", "codex", "x1", 100, 80, 0, "2026-08-20T00:00:00.000Z");
      insert.run(
        "end-exclusive",
        "claude",
        "c2",
        999,
        999,
        999,
        "2026-08-23T15:00:00.000Z",
      );
      fixture.close();

      const beforeHash = sha256();
      const beforeSidecars = adjacentSidecars();
      const command = spawnSync(
        "npm",
        [
          "run",
          "--silent",
          "harness:audit-cache",
          "--",
          "--week",
          "2026-W34",
          "--json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: commandEnv(`file:${fixturePath}`),
        },
      );
      assert.equal(command.status, 0, command.stderr);
      assert.equal(command.stderr, "");
      const report = JSON.parse(command.stdout);
      assert.equal(command.stdout, `${JSON.stringify(report)}\n`);
      assert.equal(report.week, "2026-W34");
      assert.deepEqual(report.window, {
        timezone: "Asia/Tokyo",
        startInclusive: "2026-08-16T15:00:00.000Z",
        endExclusive: "2026-08-23T15:00:00.000Z",
      });
      assert.equal(report.summary.queried, 2);
      assert.deepEqual(
        report.segments.map((segment: { harness: string; rawTotals: unknown }) => ({
          harness: segment.harness,
          rawTotals: segment.rawTotals,
        })),
        [
          {
            harness: "claude",
            rawTotals: { tokensIn: 10, cacheRead: 30, cacheCreate: 10 },
          },
          {
            harness: "codex",
            rawTotals: { tokensIn: 100, cacheRead: 80, cacheCreate: 0 },
          },
        ],
      );
      assert.equal(sha256(), beforeHash);
      assert.deepEqual(adjacentSidecars(), beforeSidecars);

      const missingDir = join(fixtureDir, "missing");
      const missingPath = join(missingDir, "missing.db");
      const missingCommand = spawnSync(
        "npm",
        [
          "run",
          "--silent",
          "harness:audit-cache",
          "--",
          "--week",
          "2026-W34",
          "--json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: commandEnv(`file:${missingPath}`),
        },
      );
      assert.notEqual(missingCommand.status, 0);
      assert.equal(missingCommand.stdout, "");
      assert.match(missingCommand.stderr, /error: query_failed/);
      assert.equal(existsSync(missingPath), false);
      assert.equal(existsSync(`${missingPath}-wal`), false);
      assert.equal(existsSync(`${missingPath}-shm`), false);
      assert.equal(existsSync(`${missingPath}-journal`), false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
