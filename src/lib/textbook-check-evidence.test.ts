import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import {
  createTextbookCheckGateOriginV1,
  createTextbookCheckSourceRevisionV1,
} from "./textbook-check-gate-origin";
import {
  observeTextbookCheckEvidenceForCheck,
  saveDailyTextbookCheckMastery,
  saveWeeklyTextbookCheckMastery,
} from "./textbook-check-evidence";
import { promoteTextbookCheckToGate } from "./textbook-check-gate-promotion-core";

async function withFixture<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7-evidence-"));
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
  input: Readonly<{
    dateKey: string;
    question: string;
    source: "auto" | "compiled";
    chapterTitle?: string;
  }>,
) {
  const textbook = await client.dailyTextbook.create({
    data: {
      dateKey: input.dateKey,
      title: "証拠のしょ",
      materialCount: 1,
      chapterCount: 1,
      chapters: {
        create: {
          index: 1,
          title: input.chapterTitle ?? "由来を固定する",
          oneLiner: "自己申告と採点済みの結果を混同しない。",
          bodyPlain: "server側の同じsource projectionからrevisionを決める。",
          evidenceJson: JSON.stringify([
            { kind: "adr", label: "ADR-0027", ref: "docs/adr/0027-h-cycle-evidence-evaluation.md" },
          ]),
          source: input.source,
        },
      },
    },
    include: { chapters: true },
  });
  const chapter = textbook.chapters[0];
  assert.ok(chapter);
  const check = await client.dailyTextbookCheck.create({
    data: {
      textbookId: textbook.id,
      chapterId: chapter.id,
      index: 1,
      question: input.question,
      source: input.source,
    },
  });
  return { textbook, chapter, check };
}

async function createWeeklySource(client: PrismaClient) {
  const textbook = await client.weeklyTextbook.create({
    data: {
      weekKey: "2026-W34",
      title: "週の証拠のしょ",
      materialCount: 1,
      chapterCount: 1,
      chapters: {
        create: {
          index: 1,
          title: "週次由来を固定する",
          oneLiner: "週次のsole writerはautoである。",
          bodyPlain: "週のしょの確認問いも同じrevision ruleで観測する。",
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
  const check = await client.weeklyTextbookCheck.create({
    data: {
      weeklyId: textbook.id,
      chapterId: chapter.id,
      index: 1,
      question: "週次の観測をなぜsame transactionで残すか説明してください。",
    },
  });
  return { textbook, chapter, check };
}

test("A7-CG1-T1 derives the exact A6 source revision hash without retaining source bodies", () => {
  const input = {
    sourceKind: "daily" as const,
    textbookKey: "2026-08-24",
    source: "auto" as const,
    checkIndex: 1,
    chapterIndex: 1,
    question: "このsource revisionをなぜIDではなくhashで識別するか説明してください。",
    chapter: {
      title: "identityを固定する",
      oneLiner: "再生成されたCheck行を分母にしない。",
      bodyPlain: "日次のauto Checkは削除して作り直されるため、同じsource projectionを復元する。",
      evidence: [{ kind: "adr", label: "ADR-0027", ref: "docs/adr/0027-h-cycle-evidence-evaluation.md" }],
    },
  };
  const origin = createTextbookCheckGateOriginV1(input);
  const revision = createTextbookCheckSourceRevisionV1(input);

  assert.equal(revision.sourceRevisionHash, origin.sourceRevisionHash);
  assert.equal(revision.questionHash, origin.questionHash);
  assert.deepEqual(
    revision,
    {
      schema: "textbook_check_source_revision_v1",
      sourceKind: "daily",
      textbookKey: "2026-08-24",
      source: "auto",
      checkIndex: 1,
      chapterIndex: 1,
      sourceRevisionHash: origin.sourceRevisionHash,
      questionHash: origin.questionHash,
    },
  );
  assert.equal(Object.isFrozen(revision), true);
  assert.doesNotMatch(JSON.stringify(revision), /source projection|再生成|このsource revision/);
});

test("A7-CG2-T1 preserves logical revisions, appends only explicit mastery events, and keeps the ledger body-free", async () => {
  await withFixture(async (client) => {
    const auto = await createDailySource(client, {
      dateKey: "2026-08-24",
      source: "auto",
      question: "同じrevisionを再利用する条件を説明してください。",
    });
    const first = await observeTextbookCheckEvidenceForCheck(client, {
      sourceKind: "daily",
      checkId: auto.check.id,
    });
    assert.equal(await client.textbookCheckMasteryEvent.count(), 0);

    await client.dailyTextbookCheck.delete({ where: { id: auto.check.id } });
    const rebuiltSame = await client.dailyTextbookCheck.create({
      data: {
        textbookId: auto.textbook.id,
        chapterId: auto.chapter.id,
        index: 1,
        source: "auto",
        question: auto.check.question,
      },
    });
    const same = await observeTextbookCheckEvidenceForCheck(client, {
      sourceKind: "daily",
      checkId: rebuiltSame.id,
    });
    assert.equal(same.id, first.id);
    assert.equal(await client.textbookCheckEvidence.count(), 1);

    await client.dailyTextbookCheck.delete({ where: { id: rebuiltSame.id } });
    const rebuiltChanged = await client.dailyTextbookCheck.create({
      data: {
        textbookId: auto.textbook.id,
        chapterId: auto.chapter.id,
        index: 1,
        source: "auto",
        question: "revisionが変わったときに旧evidenceをなぜ置換しないか説明してください。",
      },
    });
    const changed = await observeTextbookCheckEvidenceForCheck(client, {
      sourceKind: "daily",
      checkId: rebuiltChanged.id,
    });
    assert.notEqual(changed.id, first.id);
    assert.equal(await client.textbookCheckEvidence.count(), 2);

    const compiled = await createDailySource(client, {
      dateKey: "2026-08-25",
      source: "compiled",
      question: "compiled Checkのsourceをなぜ保存するか説明してください。",
    });
    const compiledEvidence = await observeTextbookCheckEvidenceForCheck(client, {
      sourceKind: "daily",
      checkId: compiled.check.id,
    });
    assert.equal(compiledEvidence.source, "compiled");

    const weekly = await createWeeklySource(client);
    const weeklyEvidence = await observeTextbookCheckEvidenceForCheck(client, {
      sourceKind: "weekly",
      checkId: weekly.check.id,
    });
    assert.equal(weeklyEvidence.source, "auto");
    assert.equal(weeklyEvidence.sourceKind, "weekly");

    const beforeSave = new Date();
    await saveDailyTextbookCheckMastery(client, rebuiltChanged.id, "partial");
    const dailyEvent = await client.textbookCheckMasteryEvent.findFirst({
      where: { evidenceId: changed.id },
      orderBy: { recordedAt: "asc" },
    });
    const dailyCheck = await client.dailyTextbookCheck.findUnique({ where: { id: rebuiltChanged.id } });
    assert.ok(dailyEvent);
    assert.ok(dailyCheck);
    assert.equal(dailyEvent.mastery, "partial");
    assert.equal(dailyEvent.recordedAt.getTime(), dailyCheck.answeredAt?.getTime());
    assert.ok(dailyEvent.recordedAt.getTime() >= beforeSave.getTime());

    const promoted = await promoteTextbookCheckToGate(client, {
      sourceKind: "daily",
      checkId: rebuiltChanged.id,
    });
    assert.equal(promoted.ok, true);
    if (promoted.ok) {
      const origin = await client.textbookCheckGateOrigin.findUnique({
        where: { gateId: promoted.gateId },
      });
      assert.ok(origin);
      assert.equal(origin.sourceRevisionHash, changed.sourceRevisionHash);
      assert.equal(origin.questionHash, changed.questionHash);
    }

    await saveDailyTextbookCheckMastery(client, rebuiltChanged.id, "clear");
    assert.equal(await client.textbookCheckMasteryEvent.count({ where: { evidenceId: changed.id } }), 2);
    await saveWeeklyTextbookCheckMastery(client, weekly.check.id, "stuck");
    assert.equal(await client.textbookCheckMasteryEvent.count({ where: { evidenceId: weeklyEvidence.id } }), 1);

    const rolloutOld = await createDailySource(client, {
      dateKey: "2026-08-27",
      source: "auto",
      question: "evidenceが無かったCheckを初めて保存した時刻を説明してください。",
    });
    assert.equal(
      await client.textbookCheckEvidence.count({
        where: { sourceKind: "daily", textbookKey: "2026-08-27" },
      }),
      0,
    );
    const beforeFirstSave = new Date(Date.now() - 2_000);
    await saveDailyTextbookCheckMastery(client, rolloutOld.check.id, "parked");
    const firstSaveEvidence = await client.textbookCheckEvidence.findFirst({
      where: { sourceKind: "daily", textbookKey: "2026-08-27" },
    });
    assert.ok(firstSaveEvidence);
    assert.ok(firstSaveEvidence.firstObservedAt.getTime() >= beforeFirstSave.getTime());
    assert.equal(
      await client.textbookCheckMasteryEvent.count({ where: { evidenceId: firstSaveEvidence.id } }),
      1,
    );

    const columns = await client.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("TextbookCheckEvidence")`;
    const columnNames = columns.map((column) => column.name).sort();
    assert.deepEqual(columnNames, [
      "chapterIndex",
      "checkIndex",
      "firstObservedAt",
      "id",
      "questionHash",
      "source",
      "sourceKind",
      "sourceRevisionHash",
      "textbookKey",
    ]);
    assert.doesNotMatch(
      JSON.stringify(changed),
      /revisionが変わった|source projection|prompt本文/,
    );

    const rollbackSource = await createDailySource(client, {
      dateKey: "2026-08-26",
      source: "auto",
      question: "rollbackでevidenceも残さない理由を説明してください。",
    });
    const evidenceBeforeRollback = await client.textbookCheckEvidence.count();
    await assert.rejects(
      client.$transaction(async (tx) => {
        await observeTextbookCheckEvidenceForCheck(tx, {
          sourceKind: "daily",
          checkId: rollbackSource.check.id,
        });
        throw new Error("intentional rollback");
      }),
      /intentional rollback/,
    );
    assert.equal(await client.textbookCheckEvidence.count(), evidenceBeforeRollback);

    const invalid = await client.dailyTextbookCheck.create({
      data: {
        textbookId: auto.textbook.id,
        chapterId: auto.chapter.id,
        index: 2,
        source: "unexpected",
        question: "invalid source must fail loud",
      },
    });
    await assert.rejects(
      saveDailyTextbookCheckMastery(client, invalid.id, "stuck"),
      /invalid source/,
    );
    const invalidAfter = await client.dailyTextbookCheck.findUnique({ where: { id: invalid.id } });
    assert.equal(invalidAfter?.mastery, null);
  });
});

test("A7-CG2-T2 production daily auto, daily compiled, and weekly writers observe every persisted Check without mastery events", () => {
  const directory = mkdtempSync(join(tmpdir(), "harness-a7-writers-"));
  const databasePath = join(directory, "fixture.db");
  const fixturePath = join(directory, "writers.ts");
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const dbModule = pathToFileURL(join(process.cwd(), "src/lib/db.ts")).href;
    const dailyModule = pathToFileURL(join(process.cwd(), "src/lib/daily-textbook.ts")).href;
    const weeklyModule = pathToFileURL(join(process.cwd(), "src/lib/weekly-textbook.ts")).href;
    writeFileSync(
      fixturePath,
      `
import { prisma } from ${JSON.stringify(dbModule)};
import { compileMaterialBand, generateDailyTextbook } from ${JSON.stringify(dailyModule)};
import { generateWeeklyTextbook } from ${JSON.stringify(weeklyModule)};

async function counts(where) {
  const [checks, evidence] = await Promise.all([
    prisma.dailyTextbookCheck.count({ where: { textbook: { dateKey: where.textbookKey }, source: where.source } }),
    prisma.textbookCheckEvidence.count({ where }),
  ]);
  return { checks, evidence };
}

async function main() {
  try {
    await prisma.devEvent.create({
      data: {
        kind: "commit",
        repo: "org/daily",
        ref: "daily-a7-1",
        summary: "fix(harness): preserve source revision evidence during daily regeneration",
        receivedAt: new Date("2026-08-24T03:00:00.000Z"),
      },
    });
    await generateDailyTextbook("2026-08-24");
    const dailyFirst = await counts({ sourceKind: "daily", textbookKey: "2026-08-24", source: "auto" });
    await generateDailyTextbook("2026-08-24");
    const dailyRebuilt = await counts({ sourceKind: "daily", textbookKey: "2026-08-24", source: "auto" });

    const compiledEvent = await prisma.devEvent.create({
      data: {
        kind: "commit",
        repo: "org/compiled",
        ref: "compiled-a7-1",
        summary: "refactor(harness): isolate compiled textbook evidence",
        receivedAt: new Date("2026-08-24T04:00:00.000Z"),
      },
    });
    const band = await prisma.materialBand.create({
      data: {
        dateKey: "2026-08-24",
        repo: "org/compiled",
        materialIds: JSON.stringify([compiledEvent.id]),
        digest: "compiled evidence fixture",
        count: 1,
      },
    });
    await compileMaterialBand(band.id);
    const compiled = await counts({ sourceKind: "daily", textbookKey: "2026-08-24", source: "compiled" });

    await prisma.devEvent.create({
      data: {
        kind: "commit",
        repo: "org/weekly",
        ref: "weekly-a7-1",
        summary: "test(harness): retain weekly evidence denominator",
        receivedAt: new Date("2026-08-22T03:00:00.000Z"),
      },
    });
    await generateWeeklyTextbook({
      weekKey: "2026-W34",
      start: new Date("2026-08-17T15:00:00.000Z"),
      end: new Date("2026-08-24T15:00:00.000Z"),
    });
    const weekly = {
      checks: await prisma.weeklyTextbookCheck.count({ where: { weekly: { weekKey: "2026-W34" } } }),
      evidence: await prisma.textbookCheckEvidence.count({ where: { sourceKind: "weekly", textbookKey: "2026-W34", source: "auto" } }),
    };
    const events = await prisma.textbookCheckMasteryEvent.count();
    process.stdout.write(JSON.stringify({ dailyFirst, dailyRebuilt, compiled, weekly, events }) + "\\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
`,
      "utf8",
    );
    const nodeOptions = `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server`.trim();
    const run = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), [fixturePath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`,
        NODE_OPTIONS: nodeOptions,
      },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, "");
    const result = JSON.parse(run.stdout) as {
      dailyFirst: { checks: number; evidence: number };
      dailyRebuilt: { checks: number; evidence: number };
      compiled: { checks: number; evidence: number };
      weekly: { checks: number; evidence: number };
      events: number;
    };
    assert.ok(result.dailyFirst.checks > 0);
    assert.deepEqual(result.dailyFirst, result.dailyRebuilt);
    assert.equal(result.dailyFirst.evidence, result.dailyFirst.checks);
    assert.ok(result.compiled.checks > 0);
    assert.equal(result.compiled.evidence, result.compiled.checks);
    assert.ok(result.weekly.checks > 0);
    assert.equal(result.weekly.evidence, result.weekly.checks);
    assert.equal(result.events, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
