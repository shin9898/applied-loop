#!/usr/bin/env node
// 初期データ移行: pm-learn entries.jsonl と sr-cards.json を DB へ取り込む。
// 冪等 (Entry は title+createdAt の一致、SrCard は id で upsert)。
// 使い方: npx tsx scripts/import.ts [--dry-run]

import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const PM_LEARN_ENTRIES = `${process.env.HOME}/.my-copy/pm-learn/entries.jsonl`;
const SR_CARDS = `${process.env.HOME}/.claude/learning/sr-cards.json`;
const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// application エントリを既存 Entry に紐付けるためのキーワードルール。
// 曖昧な場合は standalone Entry として作成し、UI から後で紐付け直す前提。
const LINK_RULES = [
  { keywords: ["4階層", "Core/Why/What/How", "プロダクトマネジメント"], match: "プロダクトマネジメント" },
];

type PmLearnEntry = {
  kind: string;
  title: string;
  note?: string;
  source?: string;
  applied_to?: string;
  ts: string;
};

type SrCardJson = {
  id: string;
  topic: string;
  question: string;
  answer: string;
  created: string;
  lastReview?: string;
  nextReview: string;
  interval?: number;
  easeFactor?: number;
  repetitions?: number;
  score?: number;
};

function parseJsonl(path: string): PmLearnEntry[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PmLearnEntry);
}

function guessLinkedEntryTitle(entry: PmLearnEntry): string | null {
  const text = `${entry.title} ${entry.note ?? ""}`;
  for (const rule of LINK_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.match;
  }
  return null;
}

async function importPmLearn() {
  const entries = parseJsonl(PM_LEARN_ENTRIES);
  const stats = { entriesCreated: 0, entriesSkipped: 0, applicationsCreated: 0, applicationsSkipped: 0 };

  for (const e of entries) {
    const ts = new Date(e.ts);

    if (e.kind === "material" || e.kind === "magazine" || e.kind === "study") {
      const existing = await prisma.entry.findFirst({
        where: { title: e.title, createdAt: ts },
      });
      if (existing) {
        stats.entriesSkipped++;
        continue;
      }
      const data = {
        title: e.title,
        kind: e.kind === "material" ? "book" : e.kind,
        source: e.source ?? null,
        note: e.note ?? null,
        createdAt: ts,
      };
      if (!DRY_RUN) await prisma.entry.create({ data });
      stats.entriesCreated++;
    }

    if (e.kind === "application") {
      const linkedTitle = guessLinkedEntryTitle(e);
      let entry = linkedTitle
        ? await prisma.entry.findFirst({ where: { title: { contains: linkedTitle } } })
        : null;

      if (!entry) {
        const existingStandalone = await prisma.entry.findFirst({
          where: { title: e.title, createdAt: ts },
        });
        if (existingStandalone) {
          entry = existingStandalone;
        } else {
          const data = {
            title: e.title,
            kind: "other",
            note: e.note ?? null,
            createdAt: ts,
          };
          if (!DRY_RUN) entry = await prisma.entry.create({ data });
          stats.entriesCreated++;
        }
      }

      const entryId = entry?.id ?? "(dry-run)";
      const dup = entry?.id
        ? await prisma.application.findFirst({
            where: { entryId: entry.id, appliedTo: e.applied_to ?? "", createdAt: ts },
          })
        : null;
      if (dup) {
        stats.applicationsSkipped++;
        continue;
      }
      const data = {
        entryId,
        appliedTo: e.applied_to ?? "",
        note: e.note ?? "",
        decisionChanged: null,
        createdAt: ts,
      };
      if (!DRY_RUN) await prisma.application.create({ data });
      stats.applicationsCreated++;
    }
  }
  return stats;
}

async function importSrCards() {
  const { cards } = JSON.parse(readFileSync(SR_CARDS, "utf8")) as { cards: SrCardJson[] };
  let upserted = 0;
  for (const c of cards) {
    const data = {
      topic: c.topic,
      question: c.question,
      answer: c.answer,
      created: new Date(c.created),
      lastReview: c.lastReview ? new Date(c.lastReview) : null,
      nextReview: new Date(c.nextReview),
      interval: c.interval ?? 1,
      easeFactor: c.easeFactor ?? 2.5,
      repetitions: c.repetitions ?? 0,
      score: c.score ?? 0,
    };
    if (!DRY_RUN) {
      await prisma.srCard.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
    }
    upserted++;
  }
  return { cardsUpserted: upserted };
}

async function main() {
  const pmStats = await importPmLearn();
  const srStats = await importSrCards();
  console.log(JSON.stringify({ dryRun: DRY_RUN, pmLearn: pmStats, srCards: srStats }, null, 2));
  await prisma.$disconnect();
}

main();
