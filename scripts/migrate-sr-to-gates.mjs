#!/usr/bin/env node
// ADR-0010: active な SrCard を kind="sr_review" の Gate へ移行し、SrCard を削除する。
// 使い方: node scripts/migrate-sr-to-gates.mjs [--dry-run]
// DATABASE_URL 未設定時は file:./dev.db (リポジトリルート相対)

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function cuidLike() {
  return "c" + randomBytes(12).toString("hex");
}

function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  if (!url.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL: ${url}`);
  }
  const raw = url.slice("file:".length);
  return resolve(REPO_ROOT, raw);
}

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const dbPath = resolveDbPath();
const db = new Database(dbPath);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r) => r.name);

if (!tables.includes("SrCard")) {
  console.log(JSON.stringify({ migrated: 0, deleted: 0, note: "SrCard table already gone" }));
  db.close();
  process.exit(0);
}

const cards = db
  .prepare("SELECT * FROM SrCard WHERE status = 'active'")
  .all();

console.log(`Found ${cards.length} active SrCard(s) in ${dbPath}`);

if (!DRY_RUN) {
  const insert = db.prepare(`
    INSERT INTO Gate (
      id, eventId, misconceptionId, kind, question, targetConcept, domain,
      answer, status, gradeNote, resources, rubricCriteria, rubricResult,
      answerMode, accessedResource, nextReviewAt, createdAt, answeredAt, gradedAt
    ) VALUES (
      @id, NULL, NULL, 'sr_review', @question, @targetConcept, NULL,
      NULL, 'pending', NULL, NULL, NULL, NULL,
      NULL, 0, @nextReviewAt, @createdAt, NULL, NULL
    )
  `);

  const tx = db.transaction((rows) => {
    for (const card of rows) {
      insert.run({
        id: cuidLike(),
        question: card.question,
        targetConcept: card.topic,
        nextReviewAt: card.nextReview,
        createdAt: card.created ?? new Date().toISOString(),
      });
    }
    const deleted = db.prepare("DELETE FROM SrCard").run();
    return deleted.changes;
  });

  const deleted = tx(cards);
  console.log(
    JSON.stringify({ migrated: cards.length, deleted, dryRun: false }, null, 2)
  );
} else {
  console.log(
    JSON.stringify(
      {
        migrated: cards.length,
        deleted: 0,
        dryRun: true,
        sample: cards.slice(0, 3).map((c) => ({
          topic: c.topic,
          nextReview: c.nextReview,
        })),
      },
      null,
      2
    )
  );
}

db.close();
