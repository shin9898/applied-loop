import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1,
  H_CACHE_EVALUATION_SOURCE_SELECTION_V1,
  queryHCacheEvaluationSourceV1,
  queryReadonlyHCacheEvaluationSourceV1,
  type HCacheEvaluationSourceQueryClientV1,
  type HCacheEvaluationSourceRowV1,
} from "./harness-evaluation-cache-source-adapter-v1";

const hash = (character: string) => character.repeat(64);
const beforeFingerprint = `sha256:${hash("b")}`;
const afterFingerprint = `sha256:${hash("c")}`;

function cohort(contextFingerprint = beforeFingerprint) {
  return {
    harness: "codex",
    model: "gpt-5.6",
    repo: "shin9898/applied-loop",
    contextFingerprint,
    usageSemanticsVersion: "harness-usage-v1",
    collectorVersion: "harness-collector-v1",
  } as const;
}

function observation(
  contextFingerprint = beforeFingerprint,
  startInclusive = "2026-08-01T00:00:00.000Z",
  endExclusive = "2026-08-08T00:00:00.000Z",
) {
  return {
    schema: "h_cache_source_observation_v1",
    cohort: cohort(contextFingerprint),
    window: { startInclusive, endExclusive },
  } as const;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schema: "h_cache_evaluation_source_request_v1",
    baseline: observation(),
    intervention: null,
    followup: null,
    ...overrides,
  };
}

function row(
  contextFingerprint = beforeFingerprint,
  overrides: Partial<HCacheEvaluationSourceRowV1> = {},
): HCacheEvaluationSourceRowV1 {
  return {
    ...cohort(contextFingerprint),
    inputTotalTokens: 100,
    inputUncachedTokens: 10,
    cacheReadTokens: 90,
    cacheWriteTokens: null,
    usageNormalizationStatus: "supported",
    turns: 2,
    ...overrides,
  };
}

function sourceQueryArgs(
  contextFingerprint: string,
  startInclusive: string,
  endExclusive: string,
) {
  return {
    where: {
      ...cohort(contextFingerprint),
      startedAt: {
        gte: new Date(startInclusive),
        lt: new Date(endExclusive),
      },
    },
    select: H_CACHE_EVALUATION_SOURCE_SELECTION_V1,
    orderBy: { startedAt: "asc" },
    take: H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1 + 1,
  };
}

function assertFrozenDeeply(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

test("A9A-CACHE-SOURCE-CG1 reads two exact half-open cohorts and emits only a matched aggregate", async () => {
  const calls: unknown[] = [];
  let disconnectCount = 0;
  const afterRows = Array.from({ length: 7 }, () => row(afterFingerprint, {
    inputUncachedTokens: 5,
    cacheReadTokens: 95,
  }));
  const client: HCacheEvaluationSourceQueryClientV1 = {
    harnessRun: {
      findMany: async (args) => {
        calls.push(args);
        return args.where.contextFingerprint === afterFingerprint
          ? afterRows
          : Array.from({ length: 7 }, () => row());
      },
    },
    $disconnect: async () => {
      disconnectCount += 1;
    },
  };
  const input = request({
    intervention: {
      schema: "h_cache_stable_prefix_intervention_v1",
      interventionIdHash: hash("d"),
      beforeContextFingerprint: beforeFingerprint,
      afterContextFingerprint: afterFingerprint,
    },
    followup: observation(afterFingerprint, "2026-08-08T00:00:00.000Z", "2026-08-15T00:00:00.000Z"),
  });
  const before = structuredClone(input);

  const result = await queryHCacheEvaluationSourceV1(client, input);

  assert.deepEqual(input, before);
  assert.deepEqual(calls, [
    sourceQueryArgs(beforeFingerprint, "2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z"),
    sourceQueryArgs(afterFingerprint, "2026-08-08T00:00:00.000Z", "2026-08-15T00:00:00.000Z"),
  ]);
  assert.equal(disconnectCount, 1);
  assert.equal(result.comparison.status, "matched");
  if (result.comparison.status !== "matched") return;
  assert.equal(result.comparison.before.cacheReadRateBps, 9_000);
  assert.equal(result.comparison.after.cacheReadRateBps, 9_500);
  assert.equal(result.comparison.before.freshInputTokensPerTurn, 5);
  assert.equal(result.comparison.after.freshInputTokensPerTurn, 2);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("gpt-5.6"), false);
  assert.equal(serialized.includes("shin9898/applied-loop"), false);
  assert.equal(serialized.includes("2026-08-01"), false);
  assertFrozenDeeply(result);
});

test("A9A-CACHE-SOURCE-CG2 fails closed before a query and always disconnects", async () => {
  for (const input of [
    { ...request(), unexpected: true },
    request({ baseline: null, intervention: { invalid: true } }),
  ]) {
    let callCount = 0;
    let disconnectCount = 0;
    const client: HCacheEvaluationSourceQueryClientV1 = {
      harnessRun: {
        findMany: async () => {
          callCount += 1;
          return [];
        },
      },
      $disconnect: async () => {
        disconnectCount += 1;
      },
    };
    const result = await queryHCacheEvaluationSourceV1(client, input);
    assert.equal(callCount, 0);
    assert.equal(disconnectCount, 1);
    assert.deepEqual(result.comparison, {
      schema: "h_cache_comparison_v1",
      status: "unavailable",
      reasonCode: "invalid_normalization",
    });
  }

  let nullCallCount = 0;
  let nullDisconnectCount = 0;
  const noBaseline = await queryHCacheEvaluationSourceV1({
    harnessRun: {
      findMany: async () => {
        nullCallCount += 1;
        return [];
      },
    },
    $disconnect: async () => {
      nullDisconnectCount += 1;
    },
  }, request({ baseline: null }));
  assert.equal(nullCallCount, 0);
  assert.equal(nullDisconnectCount, 1);
  assert.deepEqual(noBaseline.comparison, {
    schema: "h_cache_comparison_v1",
    status: "unavailable",
    reasonCode: "no_cache_samples",
  });

  let rejectedDisconnectCount = 0;
  await assert.rejects(
    queryHCacheEvaluationSourceV1({
      harnessRun: { findMany: async () => { throw new Error("query exploded"); } },
      $disconnect: async () => {
        rejectedDisconnectCount += 1;
      },
    }, request()),
    /query exploded/,
  );
  assert.equal(rejectedDisconnectCount, 1);
});

test("A9A-CACHE-SOURCE-CG3 treats mismatch, unavailable usage, and oversized windows as non-evidence", async () => {
  let disconnectCount = 0;
  const mismatched = await queryHCacheEvaluationSourceV1({
    harnessRun: {
      findMany: async () => [row(beforeFingerprint, { repo: "other-repo" })],
    },
    $disconnect: async () => {
      disconnectCount += 1;
    },
  }, request());
  assert.equal(disconnectCount, 1);
  assert.deepEqual(mismatched.comparison, {
    schema: "h_cache_comparison_v1",
    status: "unavailable",
    reasonCode: "invalid_normalization",
  });

  const unavailable = await queryHCacheEvaluationSourceV1({
    harnessRun: {
      findMany: async () => [row(beforeFingerprint, {
        inputTotalTokens: null,
        inputUncachedTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        usageNormalizationStatus: "unsupported",
      })],
    },
    $disconnect: async () => {},
  }, request());
  assert.deepEqual(unavailable.comparison, {
    schema: "h_cache_comparison_v1",
    status: "unavailable",
    reasonCode: "usage_unavailable",
  });

  const oversized = await queryHCacheEvaluationSourceV1({
    harnessRun: {
      findMany: async () => Array.from(
        { length: H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1 + 1 },
        () => row(),
      ),
    },
    $disconnect: async () => {},
  }, request());
  assert.deepEqual(oversized.comparison, {
    schema: "h_cache_comparison_v1",
    status: "unavailable",
    reasonCode: "invalid_normalization",
  });
});

test("A9A-CACHE-SOURCE-CG4 reads a disposable SQLite fixture without creating or changing it", async () => {
  type FixtureDatabase = {
    exec(sql: string): void;
    prepare(sql: string): { run(...values: unknown[]): unknown };
    close(): void;
  };
  type FixtureDatabaseConstructor = new (path: string) => FixtureDatabase;
  const testRequire = createRequire(import.meta.url);
  const adapterRequire = createRequire(testRequire.resolve("@prisma/adapter-better-sqlite3"));
  const Database = adapterRequire("better-sqlite3") as FixtureDatabaseConstructor;
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "harness-a9a-cache-source-"));
  const fixturePath = join(fixtureDirectory, "fixture.db");
  const sidecarNames = ["fixture.db-wal", "fixture.db-shm", "fixture.db-journal"];
  const adjacentSidecars = () => readdirSync(fixtureDirectory)
    .filter((name) => sidecarNames.includes(name))
    .sort();
  const sha256 = () => createHash("sha256").update(readFileSync(fixturePath)).digest("hex");

  try {
    const fixture = new Database(fixturePath);
    fixture.exec(`
      CREATE TABLE HarnessRun (
        id TEXT PRIMARY KEY NOT NULL,
        harness TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        model TEXT,
        repo TEXT,
        inputTotalTokens INTEGER,
        inputUncachedTokens INTEGER,
        cacheReadTokens INTEGER,
        cacheWriteTokens INTEGER,
        usageSemanticsVersion TEXT,
        usageNormalizationStatus TEXT,
        collectorVersion TEXT,
        contextFingerprint TEXT,
        turns INTEGER NOT NULL DEFAULT 0,
        startedAt DATETIME NOT NULL
      )
    `);
    const insert = fixture.prepare(
      "INSERT INTO HarnessRun (id, harness, sessionId, model, repo, inputTotalTokens, inputUncachedTokens, cacheReadTokens, cacheWriteTokens, usageSemanticsVersion, usageNormalizationStatus, collectorVersion, contextFingerprint, turns, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "inside",
      "codex",
      "session-1",
      "gpt-5.6",
      "shin9898/applied-loop",
      100,
      10,
      90,
      null,
      "harness-usage-v1",
      "supported",
      "harness-collector-v1",
      beforeFingerprint,
      2,
      "2026-08-04T00:00:00.000Z",
    );
    insert.run(
      "end-exclusive",
      "codex",
      "session-2",
      "gpt-5.6",
      "shin9898/applied-loop",
      100,
      10,
      90,
      null,
      "harness-usage-v1",
      "supported",
      "harness-collector-v1",
      beforeFingerprint,
      2,
      "2026-08-08T00:00:00.000Z",
    );
    fixture.close();

    const beforeHash = sha256();
    const beforeSidecars = adjacentSidecars();
    const result = await queryReadonlyHCacheEvaluationSourceV1(`file:${fixturePath}`, request());
    assert.equal(result.comparison.status, "baseline_only");
    if (result.comparison.status === "baseline_only") {
      assert.equal(result.comparison.baseline.sampleCount, 1);
      assert.equal(result.comparison.baseline.cacheReadRateBps, 9_000);
    }
    assert.equal(sha256(), beforeHash);
    assert.deepEqual(adjacentSidecars(), beforeSidecars);

    const missing = join(fixtureDirectory, "missing.db");
    await assert.rejects(queryReadonlyHCacheEvaluationSourceV1(`file:${missing}`, request()));
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test("A9A-CACHE-SOURCE-CG5 keeps the adapter bounded, read-only, and non-authoritative", () => {
  const source = readFileSync(
    "src/lib/loop-jobs/harness-evaluation/harness-evaluation-cache-source-adapter-v1.ts",
    "utf8",
  );
  const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(source, /readonly:\s*true/);
  assert.match(source, /fileMustExist:\s*true/);
  assert.match(source, /take:\s*H_CACHE_EVALUATION_SOURCE_ROW_LIMIT_V1 \+ 1/);
  assert.doesNotMatch(
    executableSource,
    /(?:loop:worker|worker-phase[12]|runOneShotWorker|runOneDelivery|createLoopJobQueue|defineLoopJobRegistry|scheduler|launchd|launchctl|DATABASE_URL|process\.|fetch\(|LLM|\.create\(|\.update\(|\.delete\(|\$executeRaw|migrate)/,
  );
});
