import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import {
  appendTextbookCheckGateStateEvent,
  linkTextbookCheckGateFailureCapture,
  observeTextbookCheckGateFollowup,
} from "./textbook-check-gate-history";

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7b-history-"));
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
      return await run(client);
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function createTextbookGate(client: PrismaClient) {
  const gate = await client.gate.create({
    data: { kind: "textbook_check", question: "本文をhistoryに保存しない理由を説明してください。" },
  });
  await client.textbookCheckGateOrigin.create({
    data: {
      gateId: gate.id,
      sourceKind: "daily",
      textbookKey: "2026-08-10",
      source: "auto",
      checkIndex: 1,
      sourceRevisionHash: "a".repeat(64),
      questionHash: "b".repeat(64),
      referenceHash: "c".repeat(64),
      referenceJson: "[]",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });
  return gate;
}

test("A7B-CG2-T1 appends ordered state, direct failure-Capture, and follow-up observations atomically without source text", async () => {
  await withFixture(async (client) => {
    const gate = await createTextbookGate(client);
    const base = new Date("2026-08-10T01:00:00.000Z");
    const plus = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

    const { failed, capture, mapping, observation, scheduledFor } = await client.$transaction(async (tx) => {
      for (const [status, recordedAt] of [
        ["answered", plus(1)],
        ["grading", plus(2)],
      ] as const) {
        await tx.gate.update({ where: { id: gate.id }, data: { status } });
        await appendTextbookCheckGateStateEvent(tx, { gateId: gate.id, status, recordedAt });
      }
      await tx.gate.update({ where: { id: gate.id }, data: { status: "failed" } });
      const failed = await appendTextbookCheckGateStateEvent(tx, {
        gateId: gate.id,
        status: "failed",
        recordedAt: plus(3),
      });
      assert.ok(failed);

      const capture = await tx.capture.create({
        data: {
          title: "gate capture 本文はledgerに複製しない",
          note: "answer/diff/promptも保存しない",
          sourceTool: "gate",
          sourceContext: `gateId:${gate.id}`,
          capturedAt: plus(4),
        },
      });
      const mapping = await linkTextbookCheckGateFailureCapture(tx, {
        failedStateEventId: failed.id,
        captureId: capture.id,
        recordedAt: plus(4),
      });
      assert.ok(mapping);

      const scheduledFor = plus(60 * 72);
      const misconception = await tx.misconception.create({
        data: { concept: "観測と現在値を混同しない", nextReviewAt: scheduledFor },
      });
      await tx.capture.update({
        where: { id: capture.id },
        data: { status: "accepted", reviewedAt: plus(5), misconceptionId: misconception.id },
      });
      const observation = await observeTextbookCheckGateFollowup(tx, {
        failureCaptureId: mapping.id,
        misconceptionId: misconception.id,
        scheduledFor,
        observedAt: plus(5),
      });
      assert.ok(observation);
      return { failed, capture, mapping, observation, scheduledFor };
    });

    assert.deepEqual(
      await client.textbookCheckGateStateEvent.findMany({
        where: { gateId: gate.id },
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, status: true },
      }),
      [
        { ordinal: 1, status: "answered" },
        { ordinal: 2, status: "grading" },
        { ordinal: 3, status: "failed" },
      ],
    );
    assert.equal((await client.textbookCheckGateFailureCapture.findUnique({ where: { id: mapping.id } }))?.captureId, capture.id);
    assert.equal((await client.textbookCheckGateFollowupObservation.findUnique({ where: { id: observation.id } }))?.failureCaptureId, mapping.id);

    const replayed = await client.$transaction(async (tx) => {
      const replayedMapping = await linkTextbookCheckGateFailureCapture(tx, {
        failedStateEventId: failed.id,
        captureId: capture.id,
      });
      assert.ok(replayedMapping);
      const replayedObservation = await observeTextbookCheckGateFollowup(tx, {
        failureCaptureId: replayedMapping.id,
        misconceptionId: observation.misconceptionId,
        scheduledFor,
      });
      assert.ok(replayedObservation);
      return { replayedMapping, replayedObservation };
    });
    assert.equal(replayed.replayedMapping.id, mapping.id);
    assert.equal(replayed.replayedObservation.id, observation.id);

    const stateColumns = await client.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("TextbookCheckGateStateEvent")`;
    const failureColumns = await client.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("TextbookCheckGateFailureCapture")`;
    const followupColumns = await client.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("TextbookCheckGateFollowupObservation")`;
    assert.deepEqual(stateColumns.map((column) => column.name).sort(), ["gateId", "id", "ordinal", "recordedAt", "status"]);
    assert.deepEqual(failureColumns.map((column) => column.name).sort(), ["captureId", "failedStateEventId", "id", "recordedAt"]);
    assert.deepEqual(followupColumns.map((column) => column.name).sort(), ["failureCaptureId", "id", "misconceptionId", "observedAt", "scheduledFor"]);
    assert.doesNotMatch(JSON.stringify({ failed, mapping, observation }), /本文|answer\/diff\/prompt/);
  });
});

test("A7B-CG2-T2 skips non-direct Capture mappings and rolls state evidence back with its transaction", async () => {
  await withFixture(async (client) => {
    const gate = await createTextbookGate(client);
    const failed = await client.$transaction(async (tx) => {
      await tx.gate.update({ where: { id: gate.id }, data: { status: "answered" } });
      await appendTextbookCheckGateStateEvent(tx, { gateId: gate.id, status: "answered" });
      await tx.gate.update({ where: { id: gate.id }, data: { status: "grading" } });
      await appendTextbookCheckGateStateEvent(tx, { gateId: gate.id, status: "grading" });
      await tx.gate.update({ where: { id: gate.id }, data: { status: "failed" } });
      return appendTextbookCheckGateStateEvent(tx, { gateId: gate.id, status: "failed" });
    });
    assert.ok(failed);

    const malformed = await client.capture.create({
      data: { title: "not a direct gate capture", sourceTool: "manual", sourceContext: `gateId:${gate.id}` },
    });
    const skipped = await client.$transaction((tx) => linkTextbookCheckGateFailureCapture(tx, {
      failedStateEventId: failed.id,
      captureId: malformed.id,
    }));
    assert.equal(skipped, null);
    assert.equal(await client.textbookCheckGateFailureCapture.count(), 0);

    const countBeforeRollback = await client.textbookCheckGateStateEvent.count({ where: { gateId: gate.id } });
    await assert.rejects(
      client.$transaction(async (tx) => {
        await tx.gate.update({ where: { id: gate.id }, data: { status: "dismissed" } });
        await appendTextbookCheckGateStateEvent(tx, { gateId: gate.id, status: "dismissed" });
        throw new Error("intentional history rollback");
      }),
      /intentional history rollback/,
    );
    assert.equal(await client.textbookCheckGateStateEvent.count({ where: { gateId: gate.id } }), countBeforeRollback);
  });
});
