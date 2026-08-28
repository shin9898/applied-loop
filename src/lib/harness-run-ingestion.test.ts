import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
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
    collectorVersion: "harness-collector-v3",
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
    collectorVersion: "harness-collector-v3",
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
  assert.match(source, /const COLLECTOR_VERSION = "harness-collector-v3";/);
  assert.match(source, /collectorVersion: COLLECTOR_VERSION,/);
  assert.match(source, /contextFingerprint,/);
  assert.match(source, /toPayload\(parsed, prev\?\.contextFingerprint\)/);
  assert.match(source, /contextFingerprint: payload\.contextFingerprint,/);
  assert.match(source, /"collectorVersion",/);
  assert.match(source, /"contextFingerprint",/);
  assert.doesNotMatch(source, /(?:promptBody|conversationBody|messageText|toolArguments)/);
});

type CollectorSafetyFixture = {
  home: string;
  statePath: string;
  snapshotPath: string;
  firstPath: string;
  env: NodeJS.ProcessEnv;
};

type CollectorReceivedPayload = Record<string, unknown>;

const collectorSafetyScript = join(process.cwd(), "scripts", "collect-harness.mjs");

function createCollectorSafetyFixture(): CollectorSafetyFixture {
  const home = mkdtempSync(join(tmpdir(), "applied-loop-harness-collector-"));
  const sessionsPath = join(home, ".codex", "sessions");
  mkdirSync(sessionsPath, { recursive: true });

  const session = (sessionId: string, timestamp: string) =>
    [
      { type: "session_meta", timestamp, payload: { id: sessionId, cwd: "/tmp/workbench" } },
      { type: "turn_context", timestamp, payload: { model: "gpt-5.6" } },
      { type: "event_msg", timestamp, payload: { type: "user_message" } },
      {
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 20,
              cached_input_tokens: 80,
              reasoning_output_tokens: 5,
            },
          },
        },
      },
    ];
  const writeSession = (path: string, sessionId: string, timestamp: string) => {
    writeFileSync(
      path,
      session(sessionId, timestamp).map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
  };

  const firstPath = join(sessionsPath, "01-a.jsonl");
  writeSession(firstPath, "session-a", "2026-08-28T10:00:00.000Z");
  writeSession(join(sessionsPath, "02-b.jsonl"), "session-b", "2026-08-28T11:00:00.000Z");

  const statePath = join(home, "collector-state.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    APPLIED_LOOP_COLLECT_STATE_PATH: statePath,
    APPLIED_LOOP_URL: "http://127.0.0.1:1",
    MCP_TOKEN: "",
  };
  delete env.APPLIED_LOOP_CONTEXT_FINGERPRINT;
  return {
    home,
    statePath,
    snapshotPath: join(home, "targets.json"),
    firstPath,
    env,
  };
}

function runCollectorSafety(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [collectorSafetyScript, ...args], {
      cwd: process.cwd(),
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (status: number | null) => resolve({ status, stdout, stderr }));
  });
}

async function withCollectorSafetyServer<T>(
  callback: (url: string, received: CollectorReceivedPayload[]) => Promise<T>,
): Promise<T> {
  const received: CollectorReceivedPayload[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CollectorReceivedPayload);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("collector test server did not expose a TCP address");
  }
  try {
    return await callback(`http://127.0.0.1:${address.port}`, received);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("A5-CG2-T5 creates a deterministic bounded snapshot without mutating checkpoint", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const result = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath, "--max-sends", "1"],
      fixture.env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(fixture.statePath), false);
    const snapshot = JSON.parse(readFileSync(fixture.snapshotPath, "utf8")) as {
      targets: Array<Record<string, unknown>>;
      summary: Record<string, unknown>;
    };
    assert.equal(snapshot.targets.length, 1);
    assert.equal(snapshot.targets[0].path, fixture.firstPath);
    assert.equal(snapshot.summary.candidateCount, 2);
    assert.equal(snapshot.summary.eligibleCount, 2);
    assert.equal(snapshot.summary.selectedCount, 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /user_message|token_count/);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("A5-CG2-T6 fails closed before sending stale targets and resumes under a hard limit", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const snapshotResult = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath],
      fixture.env,
    );
    assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
    appendFileSync(fixture.firstPath, "\n");
    await withCollectorSafetyServer(async (url, received) => {
      const stale = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /snapshot_stale/);
      assert.equal(received.length, 0);
      assert.equal(existsSync(fixture.statePath), false);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("A5-CG2-T7 applies a fresh snapshot once per target and resumes after max-sends", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const snapshotResult = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath],
      fixture.env,
    );
    assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
    await withCollectorSafetyServer(async (url, received) => {
      const firstApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath, "--max-sends", "1"],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(firstApply.status, 0, firstApply.stderr);
      assert.match(firstApply.stdout, /sent=1/);
      assert.match(firstApply.stdout, /attempts=1/);
      assert.match(firstApply.stdout, /stoppedAtLimit=true/);
      assert.equal(received.length, 1);
      assert.equal(received[0].collectorVersion, "harness-collector-v3");
      assert.equal(Object.hasOwn(received[0], "message"), false);

      const resumedApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(resumedApply.status, 0, resumedApply.stderr);
      assert.equal(received.length, 2);

      const idempotentApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(idempotentApply.status, 0, idempotentApply.stderr);
      assert.equal(received.length, 2);
      assert.match(idempotentApply.stdout, /skippedUnchanged=2/);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
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
        collectorVersion: "harness-collector-v3",
        contextFingerprint: fingerprint,
      });
    } finally {
      fixture.close();
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("BUGFIX-CG2 reports local HarnessRun schema drift as an actionable 503", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "harness-schema-drift-"));
  const fixturePath = join(fixtureDir, "route.db");
  const token = "schema-drift-token";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${fixturePath}`,
    MCP_TOKEN: token,
  };
  const childSource = [
    'import { POST } from "./src/app/api/harness-runs/route";',
    'const body = { harness: "codex", sessionId: "schema-drift", tokensIn: 1, tokensOut: 0, cacheRead: 0, cacheCreate: 0, thinking: 0, turns: 1, startedAt: "2026-08-28T00:00:00.000Z" };',
    `POST(new Request("http://localhost/api/harness-runs", { method: "POST", headers: { authorization: "Bearer ${token}", "content-type": "application/json" }, body: JSON.stringify(body) }))`,
    '  .then(async (response) => console.log(JSON.stringify({ status: response.status, body: await response.json() })))',
    '  .catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join("\n");

  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const adapterRequire = createRequire(
      createRequire(import.meta.url).resolve("@prisma/adapter-better-sqlite3"),
    );
    const Database = adapterRequire("better-sqlite3") as new (path: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const fixture = new Database(fixturePath);
    fixture.exec('ALTER TABLE "HarnessRun" DROP COLUMN "inputTotalTokens"');
    fixture.close();

    const route = spawnSync("npx", ["tsx", "-e", childSource], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(route.status, 0, route.stderr);
    const response = JSON.parse(route.stdout.trim()) as {
      status: number;
      body: { error: string; code: string; remediation: string };
    };
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: "database schema is out of date",
      code: "SCHEMA_OUT_OF_DATE",
      remediation: "Run npm run setup (or npx prisma migrate deploy), then restart the dev server.",
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
