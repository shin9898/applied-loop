import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import ts from "typescript";

import { PrismaClient } from "../generated/prisma/client";
import type { HCycleEvidenceSnapshotV1 } from "./h-cycle-evidence-adapter";
import {
  runHCycleEvidencePreviewCli,
  type HCycleEvidencePreviewCliDependencies,
} from "./h-cycle-evidence-preview";

const EMPTY_SNAPSHOT: HCycleEvidenceSnapshotV1 = {
  sourceRevisions: [],
  promotions: [],
  gateStateEvents: [],
  failureCaptures: [],
  followupObservations: [],
};

const SUPPORTED_TWO_WEEK_SNAPSHOT: HCycleEvidenceSnapshotV1 = {
  sourceRevisions: [
    {
      sourceKind: "daily",
      textbookKey: "2026-08-03",
      source: "auto",
      checkIndex: 1,
      sourceRevisionHash: "a".repeat(64),
      firstObservedAt: new Date("2026-08-03T00:00:00.000Z"),
      masteryEvents: [{ mastery: "partial", recordedAt: new Date("2026-08-03T00:01:00.000Z") }],
    },
    {
      sourceKind: "daily",
      textbookKey: "2026-08-10",
      source: "auto",
      checkIndex: 2,
      sourceRevisionHash: "b".repeat(64),
      firstObservedAt: new Date("2026-08-10T00:00:00.000Z"),
      masteryEvents: [{ mastery: "partial", recordedAt: new Date("2026-08-10T00:01:00.000Z") }],
    },
  ],
  promotions: [
    {
      gateId: "gate-w32",
      sourceKind: "daily",
      textbookKey: "2026-08-03",
      source: "auto",
      checkIndex: 1,
      sourceRevisionHash: "a".repeat(64),
      originCreatedAt: new Date("2026-08-03T00:02:00.000Z"),
    },
    {
      gateId: "gate-w33",
      sourceKind: "daily",
      textbookKey: "2026-08-10",
      source: "auto",
      checkIndex: 2,
      sourceRevisionHash: "b".repeat(64),
      originCreatedAt: new Date("2026-08-10T00:02:00.000Z"),
    },
  ],
  gateStateEvents: [
    { id: "w32-answered", gateId: "gate-w32", ordinal: 1, status: "answered", recordedAt: new Date("2026-08-03T00:03:00.000Z") },
    { id: "w32-grading", gateId: "gate-w32", ordinal: 2, status: "grading", recordedAt: new Date("2026-08-03T00:04:00.000Z") },
    { id: "w32-passed", gateId: "gate-w32", ordinal: 3, status: "passed", recordedAt: new Date("2026-08-03T00:05:00.000Z") },
    { id: "w33-answered", gateId: "gate-w33", ordinal: 1, status: "answered", recordedAt: new Date("2026-08-10T00:03:00.000Z") },
    { id: "w33-grading", gateId: "gate-w33", ordinal: 2, status: "grading", recordedAt: new Date("2026-08-10T00:04:00.000Z") },
    { id: "w33-passed", gateId: "gate-w33", ordinal: 3, status: "passed", recordedAt: new Date("2026-08-10T00:05:00.000Z") },
  ],
  failureCaptures: [],
  followupObservations: [],
};

type RunResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  queryCalls: readonly string[];
}>;

async function runCli(
  args: readonly string[],
  options: Readonly<{
    databaseUrl?: string;
    now?: Date;
    snapshot?: HCycleEvidenceSnapshotV1;
    queryError?: boolean;
  }> = {},
): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const queryCalls: string[] = [];
  const dependencies: HCycleEvidencePreviewCliDependencies = {
    databaseUrl: options.databaseUrl,
    now: () => options.now ?? new Date("2026-08-20T00:00:00.000Z"),
    querySnapshot: async (url) => {
      queryCalls.push(url);
      if (options.queryError) throw new Error("driver secret must not escape");
      return options.snapshot ?? EMPTY_SNAPSHOT;
    },
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  };
  return {
    exitCode: await runHCycleEvidencePreviewCli(args, dependencies),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    queryCalls,
  };
}

async function withFixture<T>(run: (client: PrismaClient, databasePath: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7c-preview-"));
  const databasePath = join(directory, "fixture.db");
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databasePath, fileMustExist: true }),
    });
    try {
      return await run(client, databasePath);
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sqliteArtifacts(databasePath: string): Readonly<Record<string, string | null>> {
  return Object.freeze(Object.fromEntries(
    ["", "-wal", "-shm", "-journal"].map((suffix) => {
      const artifactPath = `${databasePath}${suffix}`;
      return [suffix || "main", existsSync(artifactPath)
        ? createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
        : null];
    }),
  ));
}

function invokePreview(databasePath: string, args: readonly string[]) {
  return spawnSync("npm", ["run", "--silent", "harness:preview-cycle-evidence", "--", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    encoding: "utf8",
    timeout: 20_000,
  });
}

function staticImportSpecifiers(relativePath: string): string[] {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(join(process.cwd(), relativePath), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
  return source.statements
    .filter(ts.isImportDeclaration)
    .flatMap((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [])
    .sort();
}

test("A7C-CG1-T1 rejects missing and invalid input without opening a database or echoing the URL", async () => {
  const cases: readonly Readonly<{ args: readonly string[]; databaseUrl?: string; code: string }>[] = [
    { args: [], databaseUrl: "file:/tmp/fixture.db", code: "missing_required_option" },
    { args: ["--week"], databaseUrl: "file:/tmp/fixture.db", code: "missing_option_value" },
    { args: ["--week", "2026-W33"], databaseUrl: "file:/tmp/fixture.db", code: "missing_required_option" },
    { args: ["--json"], databaseUrl: "file:/tmp/fixture.db", code: "missing_required_option" },
    { args: ["--week", "2026-W33", "--json", "--json"], databaseUrl: "file:/tmp/fixture.db", code: "duplicate_option" },
    { args: ["--week", "2026-W33", "--week", "2026-W32", "--json"], databaseUrl: "file:/tmp/fixture.db", code: "duplicate_option" },
    { args: ["--week", "2026-W33", "--json", "--unknown"], databaseUrl: "file:/tmp/fixture.db", code: "unknown_option" },
    { args: ["--", "--week", "2026-W33", "--json"], databaseUrl: "file:/tmp/fixture.db", code: "unknown_option" },
    { args: ["--week", "2026-W54", "--json"], databaseUrl: "file:/tmp/fixture.db", code: "invalid_iso_week" },
    { args: ["--week", "2026-W33", "--json"], code: "missing_database_url" },
    { args: ["--week", "2026-W33", "--json"], databaseUrl: "", code: "invalid_database_url" },
    { args: ["--week", "2026-W33", "--json"], databaseUrl: "sqlite:///tmp/fixture.db", code: "invalid_database_url" },
    { args: ["--week", "2026-W33", "--json"], databaseUrl: "file://remote-host/tmp/fixture.db", code: "invalid_database_url" },
    { args: ["--week", "2026-W33", "--json"], databaseUrl: "file:relative.db", code: "invalid_database_url" },
    { args: ["--week", "2026-W33", "--json"], databaseUrl: "file:/tmp/fixture.db?secret=do-not-echo", code: "invalid_database_url" },
  ];

  for (const entry of cases) {
    const result = await runCli(entry.args, { databaseUrl: entry.databaseUrl });
    assert.equal(result.exitCode, 1, JSON.stringify(entry));
    assert.equal(result.stdout, "", JSON.stringify(entry));
    assert.equal(result.stderr, `error: ${entry.code}\n`, JSON.stringify(entry));
    assert.deepEqual(result.queryCalls, [], JSON.stringify(entry));
    assert.doesNotMatch(result.stderr, /fixture|secret|remote-host|relative/);
  }
});

test("A7C-CG1-T2 rejects current and future JST ISO weeks before query", async () => {
  for (const week of ["2026-W34", "2026-W35"]) {
    const result = await runCli(["--week", week, "--json"], {
      databaseUrl: "file:/tmp/fixture.db",
      now: new Date("2026-08-20T00:00:00.000Z"),
    });
    assert.equal(result.exitCode, 1, week);
    assert.equal(result.stdout, "", week);
    assert.equal(result.stderr, "error: week_not_completed\n", week);
    assert.deepEqual(result.queryCalls, [], week);
  }
});

test("A7C-CG1-T3 projects exactly previous and requested completed JST weeks from one snapshot", async () => {
  const result = await runCli(["--json", "--week", "2026-W33"], {
    databaseUrl: "file:/tmp/fixture.db",
    now: new Date("2026-08-20T00:00:00.000Z"),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.queryCalls, ["file:/tmp/fixture.db"]);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(output.schema, "h_cycle_evidence_preview_v1");
  assert.equal(output.policyVersion, "h_cycle_evidence_v1");
  assert.equal(output.targetWeekKey, "2026-W33");
  assert.deepEqual(
    (output.projections as Array<{ period: { weekKey: string } }>).map((projection) => projection.period.weekKey),
    ["2026-W32", "2026-W33"],
  );
  assert.deepEqual((output.policy as { evaluatedWeekKeys: string[] }).evaluatedWeekKeys, ["2026-W32", "2026-W33"]);
  assert.equal((output.policy as { status: string }).status, "inconclusive");
});

test("A7C-CG1-T3b keeps the exact JST boundary and prior ISO year when building the two-week pair", async () => {
  const atBoundary = await runCli(["--week", "2026-W33", "--json"], {
    databaseUrl: "file:/tmp/fixture.db",
    now: new Date("2026-08-16T15:00:00.000Z"),
  });
  assert.equal(atBoundary.exitCode, 0);
  assert.deepEqual(atBoundary.queryCalls, ["file:/tmp/fixture.db"]);

  const yearBoundary = await runCli(["--week", "2026-W01", "--json"], {
    databaseUrl: "file:/tmp/fixture.db",
    now: new Date("2026-01-10T00:00:00.000Z"),
  });
  assert.equal(yearBoundary.exitCode, 0);
  const output = JSON.parse(yearBoundary.stdout) as {
    targetWeekKey: string;
    projections: Array<{ period: { weekKey: string } }>;
  };
  assert.equal(output.targetWeekKey, "2026-W01");
  assert.deepEqual(output.projections.map((projection) => projection.period.weekKey), ["2025-W52", "2026-W01"]);
});

test("A7C-CG1-T3c keeps a supported two-week policy as a successful observation", async () => {
  const result = await runCli(["--week", "2026-W33", "--json"], {
    databaseUrl: "file:/tmp/fixture.db",
    snapshot: SUPPORTED_TWO_WEEK_SNAPSHOT,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout) as { policy: { status: string } };
  assert.equal(output.policy.status, "supported");
});

test("A7C-CG1-T4 maps readonly query failures to one fixed error without driver output", async () => {
  const result = await runCli(["--week", "2026-W33", "--json"], {
    databaseUrl: "file:/tmp/fixture.db",
    queryError: true,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "error: query_failed\n");
  assert.doesNotMatch(result.stderr, /driver|secret|fixture/);
});

test("A7C-CG3-T1 child preview is a single JSON document, leaves SQLite artifacts unchanged, and never echoes raw evidence", async () => {
  await withFixture(async (client, databasePath) => {
    const secret = "A7C_SECRET_NEVER_ECHO";
    const sourceRevisionHash = "a".repeat(64);
    await client.textbookCheckEvidence.create({
      data: {
        sourceKind: "daily",
        textbookKey: "2026-08-10",
        source: "auto",
        checkIndex: 1,
        sourceRevisionHash,
        questionHash: "b".repeat(64),
        firstObservedAt: new Date("2026-08-10T00:00:00.000Z"),
        masteryEvents: { create: { mastery: "partial", recordedAt: new Date("2026-08-10T00:01:00.000Z") } },
      },
    });
    const gate = await client.gate.create({
      data: { kind: "textbook_check", question: `${secret} question` },
    });
    await client.textbookCheckGateOrigin.create({
      data: {
        gateId: gate.id,
        sourceKind: "daily",
        textbookKey: "2026-08-10",
        source: "auto",
        checkIndex: 1,
        sourceRevisionHash,
        questionHash: "b".repeat(64),
        referenceHash: "c".repeat(64),
        referenceJson: "[]",
        createdAt: new Date("2026-08-10T00:02:00.000Z"),
      },
    });
    const failed = await client.textbookCheckGateStateEvent.create({
      data: { gateId: gate.id, ordinal: 1, status: "failed", recordedAt: new Date("2026-08-10T00:03:00.000Z") },
    });
    const misconception = await client.misconception.create({
      data: { concept: `${secret} concept`, nextReviewAt: new Date("2026-08-13T00:00:00.000Z") },
    });
    const capture = await client.capture.create({
      data: {
        title: `${secret} title`,
        note: `${secret} answer/diff/prompt`,
        sourceTool: "gate",
        sourceContext: `gateId:${gate.id};${secret}`,
        status: "accepted",
        capturedAt: new Date("2026-08-10T00:04:00.000Z"),
        reviewedAt: new Date("2026-08-10T00:05:00.000Z"),
        misconceptionId: misconception.id,
      },
    });
    const mapping = await client.textbookCheckGateFailureCapture.create({
      data: { failedStateEventId: failed.id, captureId: capture.id, recordedAt: new Date("2026-08-10T00:04:00.000Z") },
    });
    await client.textbookCheckGateFollowupObservation.create({
      data: {
        failureCaptureId: mapping.id,
        misconceptionId: misconception.id,
        scheduledFor: new Date("2026-08-13T00:00:00.000Z"),
        observedAt: new Date("2026-08-10T00:05:00.000Z"),
      },
    });

    const before = sqliteArtifacts(databasePath);
    const result = invokePreview(databasePath, ["--week", "2026-W33", "--json"]);
    const after = sqliteArtifacts(databasePath);

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^\{[\s\S]*\}\n$/);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(output.schema, "h_cycle_evidence_preview_v1");
    assert.equal(output.targetWeekKey, "2026-W33");
    assert.deepEqual(before, after);
    const combined = `${result.stdout}${result.stderr}`;
    for (const forbidden of [secret, gate.id, capture.id, misconception.id, sourceRevisionHash, `file:${databasePath}`]) {
      assert.equal(combined.includes(forbidden), false, forbidden);
    }
  });
});

test("A7C-CG3-T2 missing SQLite input remains absent and returns only query_failed", () => {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7c-missing-"));
  const databasePath = join(directory, "missing.db");
  try {
    const before = sqliteArtifacts(databasePath);
    const result = invokePreview(databasePath, ["--week", "2026-W33", "--json"]);
    const after = sqliteArtifacts(databasePath);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "error: query_failed\n");
    assert.deepEqual(before, after);
    assert.equal(existsSync(databasePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("A7C-CG4-T1 exposes one exact manual script and no activation-capable import edge", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts["harness:preview-cycle-evidence"], "tsx scripts/preview-h-cycle-evidence.ts");
  assert.equal(Object.keys(packageJson.scripts).filter((name) => name.includes("preview-cycle-evidence")).length, 1);

  assert.deepEqual(staticImportSpecifiers("scripts/preview-h-cycle-evidence.ts"), [
    "../src/lib/h-cycle-evidence-preview",
    "../src/lib/h-cycle-evidence-preview-query",
  ]);
  assert.deepEqual(staticImportSpecifiers("src/lib/h-cycle-evidence-preview.ts"), [
    "./h-cycle-evidence-adapter",
    "./h-cycle-projection",
    "node:path",
    "node:url",
  ]);
  assert.deepEqual(staticImportSpecifiers("src/lib/h-cycle-evidence-preview-query.ts"), [
    "../generated/prisma/client",
    "./h-cycle-evidence-adapter",
    "@prisma/adapter-better-sqlite3",
  ]);

  const querySource = readFileSync(join(process.cwd(), "src/lib/h-cycle-evidence-preview-query.ts"), "utf8");
  assert.match(querySource, /readonly:\s*true/);
  assert.match(querySource, /fileMustExist:\s*true/);
  assert.equal([...querySource.matchAll(/\$transaction\(/g)].length, 1);
  assert.match(querySource, /\$transaction\(\(transaction\) => readHCycleEvidenceSnapshotV1\(transaction\)\)/);
  const adapterSource = readFileSync(join(process.cwd(), "src/lib/h-cycle-evidence-adapter.ts"), "utf8");
  for (const relation of [
    "client.textbookCheckEvidence.findMany",
    "client.textbookCheckGateOrigin.findMany",
    "client.textbookCheckGateStateEvent.findMany",
    "client.textbookCheckGateFailureCapture.findMany",
    "client.textbookCheckGateFollowupObservation.findMany",
  ]) {
    assert.match(adapterSource, new RegExp(relation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(adapterSource, /client\.(?:gate|misconception)\./);

  for (const relativePath of [
    "scripts/preview-h-cycle-evidence.ts",
    "src/lib/h-cycle-evidence-preview.ts",
    "src/lib/h-cycle-evidence-preview-query.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /(?:db\.ts|loop-jobs|worker|scheduler|queue|headless-llm|dotenv|node:fs|node:child_process|node:http|node:https|console\.)/);
  }
});
