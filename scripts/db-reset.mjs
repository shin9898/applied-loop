#!/usr/bin/env node
/**
 * B6-5: 実 DB（DATABASE_URL / ルート dev.db）をバックアップして初期化し、
 * チュートリアル seed まで戻す。
 * Usage: npm run db:reset
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = resolve(root, "prisma", "backups");

function readDatabaseUrl() {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
    if (m?.[1]) {
      return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "file:./dev.db";
}

/** DATABASE_URL → 絶対パスの sqlite ファイル */
function sqlitePathFromUrl(url) {
  const raw = url.replace(/^file:/, "");
  if (isAbsolute(raw)) return raw;
  return resolve(root, raw);
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

const dbUrl = readDatabaseUrl();
const dbPath = sqlitePathFromUrl(dbUrl);

console.log("Applied Loop — db:reset（ローカル SQLite）");
console.log(`target: ${dbPath}`);

if (existsSync(dbPath)) {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = resolve(backupDir, `dev.db.${stamp}.bak`);
  copyFileSync(dbPath, backup);
  console.log(`backup: ${backup}`);
  unlinkSync(dbPath);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const side = `${dbPath}${suffix}`;
    if (existsSync(side)) unlinkSync(side);
  }
} else {
  console.log("dev.db はまだ無い（新規作成する）");
}

// 紛らわしい空ファイル（旧パス）
const bogus = resolve(root, "prisma", "dev.db");
if (existsSync(bogus) && bogus !== dbPath) {
  unlinkSync(bogus);
  console.log("removed stale prisma/dev.db");
}

run("npx prisma migrate deploy");
run("npm run seed:tutorial");

console.log("\n完了。必要なら `npm run dev:all` で起動せよ。");
