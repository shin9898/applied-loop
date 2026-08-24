import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import { buildHCycleEvidencePreviewV1 } from "./h-cycle-evidence-preview";
import { persistHCycleEvaluationRecordV1 } from "./h-cycle-evaluation-record";
import type { HCyclePeriodV1 } from "./h-cycle-projection";

const PERIODS = [
  {
    weekKey: "2026-W32",
    start: new Date("2026-08-02T15:00:00.000Z"),
    end: new Date("2026-08-09T15:00:00.000Z"),
    asOf: new Date("2026-08-09T15:00:00.000Z"),
  },
  {
    weekKey: "2026-W33",
    start: new Date("2026-08-09T15:00:00.000Z"),
    end: new Date("2026-08-16T15:00:00.000Z"),
    asOf: new Date("2026-08-16T15:00:00.000Z"),
  },
] as const;
const YEAR_BOUNDARY_PERIODS = [
  {
    weekKey: "2025-W52",
    start: new Date("2025-12-21T15:00:00.000Z"),
    end: new Date("2025-12-28T15:00:00.000Z"),
    asOf: new Date("2025-12-28T15:00:00.000Z"),
  },
  {
    weekKey: "2026-W01",
    start: new Date("2025-12-28T15:00:00.000Z"),
    end: new Date("2026-01-04T15:00:00.000Z"),
    asOf: new Date("2026-01-04T15:00:00.000Z"),
  },
] as const;

function previewFor(periods: readonly [HCyclePeriodV1, HCyclePeriodV1]) {
  return buildHCycleEvidencePreviewV1({
    sourceRevisions: [],
    promotions: [],
    gateStateEvents: [],
    failureCaptures: [],
    followupObservations: [],
  }, periods);
}

function preview() {
  return previewFor(PERIODS);
}

function mutablePreview(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(preview())) as Record<string, unknown>;
}

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a8b-record-"));
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

test("A8B1-CG2-T1 persists one aggregate-only record and makes same-digest retry idempotent", async () => {
  await withFixture(async (client) => {
    const first = await persistHCycleEvaluationRecordV1({
      client,
      preview: preview(),
      scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
      evaluatedAt: new Date("2026-08-17T23:15:02.000Z"),
      triggerKind: "scheduled",
      timeliness: "on_time",
    });
    assert.equal(first.ok, true);
    assert.equal(first.ok ? first.created : false, true);
    if (!first.ok) return;

    const saved = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: first.record.id } });
    assert.equal(saved.recordSchema, "h_cycle_evaluation_record_v1");
    assert.equal(saved.policyVersion, "h_cycle_evidence_v1");
    assert.equal(saved.projectionSchemaVersion, "h_cycle_evidence_preview_v1");
    assert.equal(saved.previousWeekKey, "2026-W32");
    assert.equal(saved.targetWeekKey, "2026-W33");
    assert.deepEqual(JSON.parse(saved.previousPeriodJson), {
      weekKey: "2026-W32",
      start: "2026-08-02T15:00:00.000Z",
      end: "2026-08-09T15:00:00.000Z",
      asOf: "2026-08-09T15:00:00.000Z",
    });
    assert.match(saved.aggregateEnvelopeSha256, /^[0-9a-f]{64}$/);
    assert.match(saved.recordSha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(saved.aggregateEnvelopeJson, /(?:answer-secret|gate-secret|reference-secret|db-secret)/);

    const retry = await persistHCycleEvaluationRecordV1({
      client,
      preview: preview(),
      scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
      evaluatedAt: new Date("2026-08-17T23:20:00.000Z"),
      triggerKind: "scheduled",
      timeliness: "on_time",
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.ok ? retry.created : true, false);
    if (!retry.ok) return;
    assert.equal(retry.record.id, saved.id);
    assert.equal(await client.hCycleEvaluationRecord.count(), 1);

    const afterRetry = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(afterRetry.evaluatedAt.getTime(), saved.evaluatedAt.getTime());
    assert.equal(afterRetry.recordSha256, saved.recordSha256);

    const changed = mutablePreview();
    const changedProjection = (changed.projections as Record<string, unknown>[])[0];
    changedProjection.selfAssessmentRate = { status: "measured", numerator: 0, denominator: 1, ratio: 0 };
    const mismatch = await persistHCycleEvaluationRecordV1({
      client,
      preview: changed,
      scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
      evaluatedAt: new Date("2026-08-17T23:21:00.000Z"),
      triggerKind: "scheduled",
      timeliness: "on_time",
    });
    assert.deepEqual(mismatch, { ok: false, code: "evaluation_record_integrity_failure" });
    const afterMismatch = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(afterMismatch.aggregateEnvelopeSha256, saved.aggregateEnvelopeSha256);
    assert.equal(afterMismatch.evaluatedAt.getTime(), saved.evaluatedAt.getTime());
  });
});

test("A8B1-CG2-T2 rejects raw data, caller-selected period pairs, and illegal record transitions before persistence", async () => {
  await withFixture(async (client) => {
    const rawField = mutablePreview();
    (rawField.projections as Record<string, unknown>[])[0].gateId = "gate-secret";
    const callerPair = mutablePreview();
    ((callerPair.projections as Record<string, unknown>[])[0].period as Record<string, unknown>).weekKey = "2026-W31";
    const malformedInputs = [
      rawField,
      callerPair,
      { ...mutablePreview(), targetWeekKey: "2026-W32" },
    ];
    for (const candidate of malformedInputs) {
      assert.deepEqual(
        await persistHCycleEvaluationRecordV1({
          client,
          preview: candidate,
          scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
          evaluatedAt: new Date("2026-08-17T23:15:02.000Z"),
          triggerKind: "scheduled",
          timeliness: "on_time",
        }),
        { ok: false, code: "invalid_evaluation_record" },
      );
    }
    assert.deepEqual(
      await persistHCycleEvaluationRecordV1({
        client,
        preview: preview(),
        scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
        evaluatedAt: new Date("2026-08-17T23:15:02.000Z"),
        triggerKind: "catch_up",
        timeliness: "on_time",
      }),
      { ok: false, code: "invalid_evaluation_record" },
    );
    assert.equal(await client.hCycleEvaluationRecord.count(), 0);
  });
});

test("A8B1-CG2-T2b derives the previous JST ISO week across an ISO-year boundary", async () => {
  await withFixture(async (client) => {
    const result = await persistHCycleEvaluationRecordV1({
      client,
      preview: previewFor(YEAR_BOUNDARY_PERIODS),
      scheduledFor: new Date("2026-01-05T00:15:00.000Z"),
      evaluatedAt: new Date("2026-01-05T00:15:02.000Z"),
      triggerKind: "catch_up",
      timeliness: "catch_up",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.record.targetWeekKey, "2026-W01");
    assert.equal(result.record.previousWeekKey, "2025-W52");
    assert.deepEqual(JSON.parse(result.record.targetPeriodJson), {
      weekKey: "2026-W01",
      start: "2025-12-28T15:00:00.000Z",
      end: "2026-01-04T15:00:00.000Z",
      asOf: "2026-01-04T15:00:00.000Z",
    });
  });
});

test("A8B1-CG2-T3 database enforces append-only record rows and writer stays disconnected from manual preview", async () => {
  await withFixture(async (client) => {
    const result = await persistHCycleEvaluationRecordV1({
      client,
      preview: preview(),
      scheduledFor: new Date("2026-08-17T23:15:00.000Z"),
      evaluatedAt: new Date("2026-08-17T23:15:02.000Z"),
      triggerKind: "scheduled",
      timeliness: "on_time",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await assert.rejects(
      client.hCycleEvaluationRecord.update({
        where: { id: result.record.id },
        data: { recordSha256: "f".repeat(64) },
      }),
    );
    await assert.rejects(client.hCycleEvaluationRecord.delete({ where: { id: result.record.id } }));
    const retained = await client.hCycleEvaluationRecord.findUniqueOrThrow({ where: { id: result.record.id } });
    assert.equal(retained.recordSha256, result.record.recordSha256);

    const writerSource = readFileSync(join(process.cwd(), "src/lib/h-cycle-evaluation-record.ts"), "utf8");
    assert.doesNotMatch(writerSource, /(?:h-cycle-evidence-preview|preview-h-cycle-evidence|worker-phase|loop:worker)/);
  });
});
