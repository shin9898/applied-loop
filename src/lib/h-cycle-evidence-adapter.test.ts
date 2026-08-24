import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import { projectHCycleEvidenceFromDatabaseV1 } from "./h-cycle-evidence-adapter";

const at = (value: string) => new Date(value);

async function withFixture<T>(run: (client: PrismaClient, databasePath: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7b-adapter-"));
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

test("A7B-CG3-T1 projects only minimal append-only evidence, so later current-row mutations cannot rewrite the completed week", async () => {
  await withFixture(async (client) => {
    const start = at("2026-08-09T15:00:00.000Z");
    const end = at("2026-08-16T15:00:00.000Z");
    const sourceRevisionHash = "a".repeat(64);
    const evidence = await client.textbookCheckEvidence.create({
      data: {
        sourceKind: "daily",
        textbookKey: "2026-08-10",
        source: "auto",
        checkIndex: 1,
        sourceRevisionHash,
        questionHash: "b".repeat(64),
        firstObservedAt: at("2026-08-10T00:00:00.000Z"),
        masteryEvents: { create: { mastery: "partial", recordedAt: at("2026-08-10T00:01:00.000Z") } },
      },
    });
    assert.ok(evidence.id);
    const gate = await client.gate.create({
      data: { kind: "textbook_check", question: "current question must not enter projection", status: "failed", gradedAt: at("2026-08-10T00:05:00.000Z") },
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
        createdAt: at("2026-08-10T00:02:00.000Z"),
      },
    });
    const [answered, grading, failed] = await Promise.all([
      client.textbookCheckGateStateEvent.create({ data: { gateId: gate.id, ordinal: 1, status: "answered", recordedAt: at("2026-08-10T00:03:00.000Z") } }),
      client.textbookCheckGateStateEvent.create({ data: { gateId: gate.id, ordinal: 2, status: "grading", recordedAt: at("2026-08-10T00:04:00.000Z") } }),
      client.textbookCheckGateStateEvent.create({ data: { gateId: gate.id, ordinal: 3, status: "failed", recordedAt: at("2026-08-10T00:05:00.000Z") } }),
    ]);
    assert.ok(answered.id && grading.id);
    const scheduledFor = at("2026-08-13T00:00:00.000Z");
    const misconception = await client.misconception.create({
      data: { concept: "current concept must not enter projection", nextReviewAt: scheduledFor },
    });
    const capture = await client.capture.create({
      data: {
        title: "current Capture title must not enter projection",
        note: "raw answer/diff/prompt text must not enter projection",
        sourceTool: "gate",
        sourceContext: `gateId:${gate.id};rootCause:knowledge`,
        status: "accepted",
        capturedAt: at("2026-08-10T00:06:00.000Z"),
        reviewedAt: at("2026-08-10T00:07:00.000Z"),
        misconceptionId: misconception.id,
      },
    });
    const mapping = await client.textbookCheckGateFailureCapture.create({
      data: { failedStateEventId: failed.id, captureId: capture.id, recordedAt: at("2026-08-10T00:06:00.000Z") },
    });
    await client.textbookCheckGateFollowupObservation.create({
      data: {
        failureCaptureId: mapping.id,
        misconceptionId: misconception.id,
        scheduledFor,
        observedAt: at("2026-08-10T00:07:00.000Z"),
      },
    });

    const period = { weekKey: "2026-W33", start, end, asOf: end };
    const before = await projectHCycleEvidenceFromDatabaseV1(client, period);
    assert.deepEqual(before.evidenceClosureRate, { status: "measured", numerator: 1, denominator: 1, ratio: 1 });
    assert.deepEqual(before.scheduledFollowupRate, { status: "measured", numerator: 1, denominator: 1, ratio: 1 });

    await client.gate.update({ where: { id: gate.id }, data: { status: "answered", gradedAt: null } });
    await client.misconception.update({ where: { id: misconception.id }, data: { nextReviewAt: null } });
    const after = await projectHCycleEvidenceFromDatabaseV1(client, period);
    assert.deepEqual(after, before);
    assert.doesNotMatch(JSON.stringify(after), /question|Capture title|answer\/diff\/prompt|concept|gateId/);
  });
});

test("A7B-CG3-T2 production gate-Capture accept records a follow-up observation without an LLM call", async () => {
  await withFixture(async (client, databasePath) => {
    const gate = await client.gate.create({
      data: { kind: "textbook_check", question: "production writer fixture" },
    });
    await client.textbookCheckGateOrigin.create({
      data: {
        gateId: gate.id,
        sourceKind: "daily",
        textbookKey: "2026-08-10",
        source: "auto",
        checkIndex: 2,
        sourceRevisionHash: "d".repeat(64),
        questionHash: "e".repeat(64),
        referenceHash: "f".repeat(64),
        referenceJson: "[]",
        createdAt: at("2026-08-10T00:00:00.000Z"),
      },
    });
    await client.textbookCheckGateStateEvent.create({
      data: { gateId: gate.id, ordinal: 1, status: "answered", recordedAt: at("2026-08-10T00:01:00.000Z") },
    });
    await client.textbookCheckGateStateEvent.create({
      data: { gateId: gate.id, ordinal: 2, status: "grading", recordedAt: at("2026-08-10T00:01:30.000Z") },
    });
    const failed = await client.textbookCheckGateStateEvent.create({
      data: { gateId: gate.id, ordinal: 3, status: "failed", recordedAt: at("2026-08-10T00:02:00.000Z") },
    });
    const capture = await client.capture.create({
      data: {
        title: "production title must remain outside the history tables",
        note: "no LLM overlap path is exercised because there is no existing misconception",
        sourceTool: "gate",
        sourceContext: `gateId:${gate.id}`,
        capturedAt: at("2026-08-10T00:03:00.000Z"),
      },
    });
    const mapping = await client.textbookCheckGateFailureCapture.create({
      data: { failedStateEventId: failed.id, captureId: capture.id, recordedAt: at("2026-08-10T00:03:00.000Z") },
    });

    const child = spawnSync(
      "./node_modules/.bin/tsx",
      [
        "-e",
        [
          'import { triageCapture } from "./src/lib/capture";',
          'void (async () => {',
          '  const result = await triageCapture(process.env.A7B_CAPTURE_ID ?? "", "accept");',
          '  if (result.ok !== true) throw new Error(JSON.stringify(result));',
          '})().catch((error) => { console.error(error); process.exitCode = 1; });',
        ].join("\n"),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${databasePath}`, A7B_CAPTURE_ID: capture.id },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);

    const accepted = await client.capture.findUnique({ where: { id: capture.id } });
    const observation = await client.textbookCheckGateFollowupObservation.findUnique({
      where: { failureCaptureId: mapping.id },
    });
    assert.equal(accepted?.status, "accepted");
    assert.ok(accepted?.misconceptionId);
    assert.equal(observation?.misconceptionId, accepted?.misconceptionId);
    assert.doesNotMatch(JSON.stringify(observation), /production title|no LLM overlap/);
  });
});
