import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import {
  buildHarnessEvaluationReportV1,
  normalizeHarnessEvaluationReportV1,
} from "./loop-jobs/harness-evaluation/harness-evaluation-report-v1";
import { persistHarnessEvaluationRunV1 } from "./harness-evaluation-run-v1";

const hash = (character: string) => character.repeat(64);

function cacheObservation(overrides: Record<string, unknown> = {}) {
  return {
    cohortKeyHash: hash("a"),
    contextFingerprintHash: hash("b"),
    sampleCount: 7,
    cacheReadRateBps: 9_200,
    freshInputTokensPerTurn: 100,
    cacheWriteTelemetry: "observed",
    ...overrides,
  };
}

function report(overrides: { afterCacheReadRateBps?: number } = {}) {
  return buildHarnessEvaluationReportV1({
    schema: "harness_evaluation_evidence_v1",
    integrity: {
      schema: "harness_evaluation_integrity_v1",
      privacyViolationCount: 0,
      dataLossDetected: false,
      duplicateDurableEffectCount: 0,
      recordIntegrityFailureCount: 0,
    },
    hCycle: {
      schema: "h_cycle_evaluation_aggregate_v1",
      policyVersion: "h_cycle_evidence_v1",
      policyStatus: "supported",
      eligibleWindowCount: 2,
      requiredAdjacentWindows: 2,
      executionFence: "complete",
      recordReconcileFence: "complete",
    },
    hEval: {
      schema: "h_eval_report_cohort_v1",
      policyVersion: "v1",
      verdict: "supported",
      decisionStage: "final",
      reasonCode: "eligible_window",
    },
    hCache: {
      schema: "h_cache_evaluation_aggregate_v1",
      usageSemanticsVersion: "harness-usage-v1",
      comparison: {
        schema: "h_cache_comparison_v1",
        status: "matched",
        interventionIdHash: hash("c"),
        before: cacheObservation(),
        after: cacheObservation({
          contextFingerprintHash: hash("d"),
          cacheReadRateBps: overrides.afterCacheReadRateBps ?? 9_150,
          freshInputTokensPerTurn: 105,
        }),
      },
    },
  });
}

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a9b-evaluation-run-"));
  const databasePath = join(directory, "fixture.db");
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    try {
      return await run(client);
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("A9B-CG2 persists an aggregate-only report and makes same-digest retries idempotent", async () => {
  await withFixture(async (client) => {
    const first = await persistHarnessEvaluationRunV1({
      client,
      evaluationKeyHash: hash("1"),
      report: report(),
      evaluatedAt: new Date("2026-08-26T08:00:00.000Z"),
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.ok ? first.created : false, true);
    if (!first.ok) return;

    const saved = await client.harnessEvaluationRun.findUniqueOrThrow({ where: { id: first.record.id } });
    assert.equal(saved.recordSchema, "harness_evaluation_run_v1");
    assert.equal(saved.reportSchema, "harness_evaluation_report_v1");
    assert.equal(saved.evaluationKeyHash, hash("1"));
    assert.match(saved.reportEnvelopeSha256, /^[0-9a-f]{64}$/);
    assert.match(saved.recordSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(saved.reportEnvelopeJson), normalizeHarnessEvaluationReportV1(report()));
    assert.doesNotMatch(saved.reportEnvelopeJson, /(?:prompt-secret|answer-secret|\/Users\/|DATABASE_URL|tokenUsage)/);

    const retry = await persistHarnessEvaluationRunV1({
      client,
      evaluationKeyHash: hash("1"),
      report: report(),
      evaluatedAt: new Date("2026-08-26T08:05:00.000Z"),
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.ok ? retry.created : true, false);
    if (!retry.ok) return;
    assert.equal(retry.record.id, saved.id);
    assert.equal(await client.harnessEvaluationRun.count(), 1);
    const afterRetry = await client.harnessEvaluationRun.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(afterRetry.evaluatedAt.getTime(), saved.evaluatedAt.getTime());
    assert.equal(afterRetry.recordSha256, saved.recordSha256);
  });
});

test("A9B-CG2 rejects a changed report for one identity without mutating the winner", async () => {
  await withFixture(async (client) => {
    const first = await persistHarnessEvaluationRunV1({
      client,
      evaluationKeyHash: hash("2"),
      report: report(),
      evaluatedAt: new Date("2026-08-26T08:00:00.000Z"),
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    const mismatch = await persistHarnessEvaluationRunV1({
      client,
      evaluationKeyHash: hash("2"),
      report: report({ afterCacheReadRateBps: 9_000 }),
      evaluatedAt: new Date("2026-08-26T08:10:00.000Z"),
    });
    assert.deepEqual(mismatch, { ok: false, code: "evaluation_run_integrity_failure" });
    const retained = await client.harnessEvaluationRun.findUniqueOrThrow({ where: { id: first.record.id } });
    assert.equal(retained.reportEnvelopeSha256, first.record.reportEnvelopeSha256);
    assert.equal(retained.evaluatedAt.getTime(), first.record.evaluatedAt.getTime());
    assert.equal(await client.harnessEvaluationRun.count(), 1);
  });
});

test("A9B-CG2 rejects raw-looking keys, extra fields, invalid reports, accessors, and proxies before persistence", async () => {
  await withFixture(async (client) => {
    const valid = { client, evaluationKeyHash: hash("3"), report: report(), evaluatedAt: new Date("2026-08-26T08:00:00.000Z") };
    const accessorReport = structuredClone(valid.report) as Record<string, unknown>;
    Object.defineProperty(accessorReport, "cohorts", {
      enumerable: true,
      get() {
        throw new Error("must-not-read");
      },
    });
    const invalidInputs: unknown[] = [
      { ...valid, evaluationKeyHash: "2026-W35" },
      { ...valid, evaluationKeyHash: hash("A") },
      { ...valid, unexpected: true },
      { ...valid, report: { ...structuredClone(valid.report), unexpected: "raw" } },
      { ...valid, report: accessorReport },
      { ...valid, report: new Proxy(valid.report, {}) },
      { ...valid, evaluatedAt: new Date("invalid") },
    ];
    for (const input of invalidInputs) {
      assert.deepEqual(await persistHarnessEvaluationRunV1(input), { ok: false, code: "invalid_evaluation_run" });
    }
    assert.equal(await client.harnessEvaluationRun.count(), 0);
  });
});

test("A9B-CG3 enforces append-only rows and keeps the writer detached from execution authority", async () => {
  await withFixture(async (client) => {
    const result = await persistHarnessEvaluationRunV1({
      client,
      evaluationKeyHash: hash("a"),
      report: report(),
      evaluatedAt: new Date("2026-08-26T08:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await assert.rejects(
      client.harnessEvaluationRun.update({
        where: { id: result.record.id },
        data: { recordSha256: hash("z") },
      }),
    );
    await assert.rejects(client.harnessEvaluationRun.delete({ where: { id: result.record.id } }));
    const retained = await client.harnessEvaluationRun.findUniqueOrThrow({ where: { id: result.record.id } });
    assert.equal(retained.recordSha256, result.record.recordSha256);

    const writerSource = readFileSync("src/lib/harness-evaluation-run-v1.ts", "utf8");
    assert.doesNotMatch(writerSource, /(?:DATABASE_URL|launchd|launchctl|setInterval|setTimeout|fetch\(|process\.env|rawToken|prompt|answer)/i);
    assert.doesNotMatch(writerSource, /(?:h-eval-preview-cli|harness-evaluation-report-preview-main|createLoopJobQueue|runOneDelivery)/);
  });
});
