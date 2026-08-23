import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildHarnessRunPersistenceData,
  buildHarnessRunUpsertArgs,
  parseHarnessRunPayload,
} from "./harness-run-ingestion";

const fingerprint = `sha256:${"a".repeat(64)}`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    harness: "codex",
    sessionId: "session-a5",
    model: "gpt-5.6",
    repo: "applied-loop",
    tools: [{ name: "functions.exec", kind: "builtin", calls: 2 }],
    tokensIn: 100,
    tokensOut: 20,
    cacheRead: 80,
    cacheCreate: 0,
    thinking: 3,
    turns: 1,
    startedAt: "2026-08-23T00:00:00.000Z",
    endedAt: "2026-08-23T00:05:00.000Z",
    collectorVersion: "harness-collector-v2",
    contextFingerprint: fingerprint,
    ...overrides,
  };
}

test("A5-CG2-T1 accepts raw/source metadata and derives evidence only on the server", () => {
  const parsed = parseHarnessRunPayload(payload());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.deepEqual(buildHarnessRunPersistenceData(parsed.data), {
    model: "gpt-5.6",
    repo: "applied-loop",
    tools: JSON.stringify([{ name: "functions.exec", kind: "builtin", calls: 2 }]),
    tokensIn: 100,
    tokensOut: 20,
    cacheRead: 80,
    cacheCreate: 0,
    thinking: 3,
    turns: 1,
    startedAt: new Date("2026-08-23T00:00:00.000Z"),
    endedAt: new Date("2026-08-23T00:05:00.000Z"),
    collectorVersion: "harness-collector-v2",
    contextFingerprint: fingerprint,
    inputTotalTokens: 100,
    inputUncachedTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: null,
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
    usageNormalizationReason: null,
  });
  const upsert = buildHarnessRunUpsertArgs(parsed.data);
  assert.deepEqual(upsert.where, {
    harness_sessionId: { harness: "codex", sessionId: "session-a5" },
  });
  assert.equal(upsert.create.harness, "codex");
  assert.equal(upsert.create.sessionId, "session-a5");
  assert.deepEqual(upsert.update, buildHarnessRunPersistenceData(parsed.data));
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(upsert.create).filter(([key]) => key !== "harness" && key !== "sessionId"),
    ),
    upsert.update,
  );

  const legacy = parseHarnessRunPayload(payload({ collectorVersion: undefined, contextFingerprint: undefined }));
  assert.equal(legacy.success, true);
  if (!legacy.success) return;
  const legacyPersistence = buildHarnessRunPersistenceData(legacy.data);
  assert.equal(legacyPersistence.collectorVersion, null);
  assert.equal(legacyPersistence.contextFingerprint, null);
});

test("A5-CG2-T2 rejects forged derived evidence and malformed source metadata", () => {
  const forged = parseHarnessRunPayload(payload({ inputTotalTokens: 1 }));
  assert.equal(forged.success, false);

  for (const source of [
    payload({ collectorVersion: "Collector V2" }),
    payload({ collectorVersion: "a".repeat(65) }),
    payload({ contextFingerprint: "sha256:UPPERCASE" }),
    payload({ contextFingerprint: `sha256:${"a".repeat(63)}` }),
  ]) {
    assert.equal(parseHarnessRunPayload(source).success, false);
  }
});

test("A5-CG2-T3 makes the collector identify its source without broadening its metadata allowlist", () => {
  const source = readFileSync(join(process.cwd(), "scripts/collect-harness.mjs"), "utf8");
  assert.match(source, /const COLLECTOR_VERSION = "harness-collector-v2";/);
  assert.match(source, /collectorVersion: COLLECTOR_VERSION,/);
  assert.match(source, /"collectorVersion",/);
  assert.doesNotMatch(source, /(?:promptBody|conversationBody|messageText|toolArguments)/);
});

test("A5-CG2-T4 persists server-derived evidence through the real authenticated route on a disposable DB", () => {
  type FixtureDatabase = {
    prepare(sql: string): { get(...values: unknown[]): unknown };
    close(): void;
  };
  type FixtureDatabaseConstructor = new (path: string) => FixtureDatabase;
  const fixtureDir = mkdtempSync(join(tmpdir(), "harness-a5-route-"));
  const fixturePath = join(fixtureDir, "route.db");
  const token = "a5-route-test-token";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${fixturePath}`,
    MCP_TOKEN: token,
  };
  const childSource = [
    'import { POST } from "./src/app/api/harness-runs/route";',
    'const run = async () => {',
    `  const token = ${JSON.stringify(token)};`,
    `  const payload = ${JSON.stringify(payload())};`,
    '  const response = await POST(new Request("http://localhost/api/harness-runs", {',
    '  method: "POST",',
    '  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },',
    '  body: JSON.stringify(payload),',
    '  }));',
    '  console.log(JSON.stringify({ status: response.status, body: await response.json() }));',
    '  const forged = await POST(new Request("http://localhost/api/harness-runs", {',
    '  method: "POST",',
    '  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },',
    '  body: JSON.stringify({ ...payload, inputTotalTokens: 1 }),',
    '  }));',
    '  console.log(JSON.stringify({ forgedStatus: forged.status }));',
    '};',
    'void run().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join("\n");

  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const route = spawnSync("npx", ["tsx", "-e", childSource], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(route.status, 0, route.stderr);
    assert.equal(route.stderr, "");
    const [accepted, forged] = route.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ok, true);
    assert.equal(typeof accepted.body.id, "string");
    assert.equal(forged.forgedStatus, 400);

    const adapterRequire = createRequire(
      createRequire(import.meta.url).resolve("@prisma/adapter-better-sqlite3"),
    );
    const Database = adapterRequire("better-sqlite3") as FixtureDatabaseConstructor;
    const fixture = new Database(fixturePath);
    try {
      const row = fixture.prepare(
        "SELECT tokensIn, cacheRead, cacheCreate, inputTotalTokens, inputUncachedTokens, cacheReadTokens, cacheWriteTokens, usageSemanticsVersion, usageNormalizationStatus, usageNormalizationReason, collectorVersion, contextFingerprint FROM HarnessRun",
      ).get() as Record<string, unknown>;
      assert.deepEqual(row, {
        tokensIn: 100,
        cacheRead: 80,
        cacheCreate: 0,
        inputTotalTokens: 100,
        inputUncachedTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        usageSemanticsVersion: "harness-usage-v1",
        usageNormalizationStatus: "supported",
        usageNormalizationReason: null,
        collectorVersion: "harness-collector-v2",
        contextFingerprint: fingerprint,
      });
    } finally {
      fixture.close();
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
