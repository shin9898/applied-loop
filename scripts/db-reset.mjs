#!/usr/bin/env node
/**
 * B6-5: dev.db をバックアップして初期化し、チュートリアル seed まで戻す。
 * Usage: npm run db:reset
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(root, "prisma", "dev.db");
const backupDir = resolve(root, "prisma", "backups");

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

console.log("Applied Loop — db:reset（ローカル SQLite）");

if (existsSync(dbPath)) {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = resolve(backupDir, `dev.db.${stamp}.bak`);
  copyFileSync(dbPath, backup);
  console.log(`backup: ${backup}`);
  unlinkSync(dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (existsSync(side)) unlinkSync(side);
  }
} else {
  console.log("dev.db はまだ無い（新規作成する）");
}

run("npx prisma migrate deploy");
run("npm run seed:tutorial");

console.log("\n完了。必要なら `npm run dev:all` で起動せよ。");
