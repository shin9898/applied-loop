import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import { promoteTextbookCheckToGate } from "./textbook-check-gate-promotion-core";

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "harness-a6-cycle-"));
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

async function createDailySource(
  client: PrismaClient,
  input: { mastery: string | null; question?: string },
) {
  const textbook = await client.dailyTextbook.create({
    data: {
      dateKey: "2026-08-23",
      title: "きょうのぼうけんのしょ",
      materialCount: 1,
      chapterCount: 1,
      chapters: {
        create: {
          index: 1,
          title: "証拠を先に固定する",
          oneLiner: "自己申告と採点済みの結果を混同しない。",
          bodyPlain: "raw counterを保持し、derived evidenceはserver側で計算する。",
          evidenceJson: JSON.stringify([
            { kind: "adr", label: "ADR-0025", ref: "docs/adr/0025-hypothesis-driven-learning-harness.md" },
          ]),
        },
      },
    },
    include: { chapters: true },
  });
  const chapter = textbook.chapters[0];
  assert.ok(chapter);
  return client.dailyTextbookCheck.create({
    data: {
      textbookId: textbook.id,
      chapterId: chapter.id,
      index: 1,
      source: "auto",
      question: input.question ?? "なぜこの判断を選び、別案を採らなかったか説明してください。",
      mastery: input.mastery,
    },
  });
}

async function createWeeklySource(
  client: PrismaClient,
  mastery: string | null,
) {
  const textbook = await client.weeklyTextbook.create({
    data: {
      weekKey: "2026-W34",
      title: "週のぼうけんのしょ",
      materialCount: 1,
      chapterCount: 1,
      chapters: {
        create: {
          index: 1,
          title: "週の証拠を確かめる",
          oneLiner: "週次Checkにはmutableなsource列が無い。",
          bodyPlain: "週次生成の唯一のwriterは自動生成であり、由来はautoとして固定する。",
          evidenceJson: JSON.stringify([
            { kind: "adr", label: "ADR-0026", ref: "docs/adr/0026-textbook-check-gate-bridge.md" },
          ]),
        },
      },
    },
    include: { chapters: true },
  });
  const chapter = textbook.chapters[0];
  assert.ok(chapter);
  return client.weeklyTextbookCheck.create({
    data: {
      weeklyId: textbook.id,
      chapterId: chapter.id,
      index: 1,
      question: "週次の由来をなぜimmutableにするか説明してください。",
      mastery,
    },
  });
}

test("A6-CG2-T1 explicitly promotes one daily source revision once and preserves it across check rebuild", async () => {
  await withFixture(async (client) => {
    const firstCheck = await createDailySource(client, { mastery: "partial" });

    const first = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: firstCheck.id,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first, { ok: true, disposition: "created", gateId: first.gateId });

    const again = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: firstCheck.id,
    });
    assert.deepEqual(again, { ok: true, disposition: "existing", gateId: first.gateId });

    const gate = await client.gate.findUnique({
      where: { id: first.gateId },
      include: { textbookCheckOrigin: true },
    });
    assert.ok(gate);
    assert.equal(gate.kind, "textbook_check");
    assert.equal(gate.status, "pending");
    assert.equal(gate.answer, null);
    assert.deepEqual(JSON.parse(gate.rubricCriteria ?? "[]"), [
      "取り組みと判断を具体化している",
      "その判断の理由を説明している",
      "別案または次回への適用に触れている",
    ]);
    assert.ok(gate.textbookCheckOrigin);
    assert.match(gate.textbookCheckOrigin.sourceRevisionHash, /^[0-9a-f]{64}$/);
    assert.equal(gate.textbookCheckOrigin.sourceKind, "daily");
    assert.equal(gate.textbookCheckOrigin.textbookKey, "2026-08-23");

    await client.dailyTextbookCheck.delete({ where: { id: firstCheck.id } });
    assert.notEqual(await client.gate.findUnique({ where: { id: first.gateId } }), null);
    assert.notEqual(
      await client.textbookCheckGateOrigin.findUnique({ where: { gateId: first.gateId } }),
      null,
    );

    const rebuiltSame = await client.dailyTextbookCheck.create({
      data: {
        textbookId: firstCheck.textbookId,
        chapterId: firstCheck.chapterId,
        index: firstCheck.index,
        source: "auto",
        question: firstCheck.question,
        mastery: "stuck",
      },
    });
    const sameRevision = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: rebuiltSame.id,
    });
    assert.deepEqual(sameRevision, {
      ok: true,
      disposition: "existing",
      gateId: first.gateId,
    });

    await client.dailyTextbookCheck.delete({ where: { id: rebuiltSame.id } });
    const rebuiltChanged = await client.dailyTextbookCheck.create({
      data: {
        textbookId: firstCheck.textbookId,
        chapterId: firstCheck.chapterId,
        index: firstCheck.index,
        source: "auto",
        question: "今回の判断を別の状況へ適用するなら、何を確認するか説明してください。",
        mastery: "partial",
      },
    });
    const changedRevision = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: rebuiltChanged.id,
    });
    assert.equal(changedRevision.ok, true);
    if (changedRevision.ok) {
      assert.equal(changedRevision.disposition, "created");
      assert.notEqual(changedRevision.gateId, first.gateId);
    }
    assert.equal(await client.gate.count(), 2);
  });
});

test("A6-CG2-T2 never promotes clear, parked, or unknown source checks", async () => {
  await withFixture(async (client) => {
    const clear = await createDailySource(client, { mastery: "clear" });
    assert.deepEqual(
      await promoteTextbookCheckToGate(client, { sourceKind: "daily", checkId: clear.id }),
      { ok: false, code: "not_actionable" },
    );
    await client.dailyTextbookCheck.update({ where: { id: clear.id }, data: { mastery: "parked" } });
    assert.deepEqual(
      await promoteTextbookCheckToGate(client, { sourceKind: "daily", checkId: clear.id }),
      { ok: false, code: "not_actionable" },
    );
    assert.deepEqual(
      await promoteTextbookCheckToGate(client, { sourceKind: "daily", checkId: "missing" }),
      { ok: false, code: "not_found" },
    );
    assert.equal(await client.gate.count(), 0);
    assert.equal(await client.textbookCheckGateOrigin.count(), 0);
  });
});

test("A6-CG2-T3 fixes weekly provenance to its sole auto writer", async () => {
  await withFixture(async (client) => {
    const check = await createWeeklySource(client, "stuck");
    const result = await promoteTextbookCheckToGate(client, {
      sourceKind: "weekly",
      checkId: check.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const origin = await client.textbookCheckGateOrigin.findUnique({
      where: { gateId: result.gateId },
    });
    assert.ok(origin);
    assert.equal(origin.sourceKind, "weekly");
    assert.equal(origin.source, "auto");
    assert.equal(origin.textbookKey, "2026-W34");
  });
});

test("A6-CG2-T4 bounds cross-check evidence before storing the immutable reference", async () => {
  await withFixture(async (client) => {
    const textbook = await client.dailyTextbook.create({
      data: {
        dateKey: "2026-08-24",
        title: "横断確認のしょ",
        materialCount: 2,
        chapterCount: 2,
        chapters: {
          create: [1, 2].map((index) => ({
            index,
            title: `第${index}章`,
            oneLiner: `第${index}章の要点`,
            bodyPlain: `第${index}章の本文`,
            evidenceJson: JSON.stringify([1, 2, 3].map((item) => ({
              kind: "file",
              label: `chapter-${index}-${item}`,
              ref: `src/example-${index}-${item}.ts`,
            }))),
          })),
        },
      },
      include: { chapters: true },
    });
    const check = await client.dailyTextbookCheck.create({
      data: {
        textbookId: textbook.id,
        chapterId: null,
        index: 1,
        source: "auto",
        question: "二つの章をまたぐ判断を説明してください。",
        mastery: "partial",
      },
    });
    const result = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: check.id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const origin = await client.textbookCheckGateOrigin.findUnique({
      where: { gateId: result.gateId },
    });
    assert.ok(origin);
    const reference = JSON.parse(origin.referenceJson) as { evidence: Array<{ label: string }> };
    assert.deepEqual(reference.evidence.map((entry) => entry.label), [
      "chapter-1-1",
      "chapter-1-2",
      "chapter-1-3",
      "chapter-2-1",
      "chapter-2-2",
    ]);
  });
});
