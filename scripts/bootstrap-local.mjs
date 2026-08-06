#!/usr/bin/env node
/**
 * clone 直後の最短起動（ADR-0019 P0 B6-2）。
 * install → .env 生成 → migrate → tutorial seed → 次の一手を表示。
 */
import { execSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

console.log("Applied Loop — local bootstrap (P0)");

if (!existsSync(resolve(root, "node_modules"))) {
  run("npm install");
} else {
  console.log("node_modules: ok");
}

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error(".env.example がありません");
    process.exit(1);
  }
  let text = readFileSync(examplePath, "utf8");
  const token = `al_${randomBytes(24).toString("hex")}`;
  text = text.replace(
    /^MCP_TOKEN=.*$/m,
    `MCP_TOKEN=${token}`,
  );
  if (!/^MCP_SURFACE=/m.test(text)) {
    text += `\n# MCP ツール面: core（既定）| full（本人用）\nMCP_SURFACE=core\n`;
  }
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`);
  console.log(`.env を作成しました（MCP_TOKEN 自動生成）`);
} else {
  console.log(".env: 既存を維持");
}

run("npx prisma migrate dev --name bootstrap");
run("npm run seed:tutorial");

console.log(`
---
次の一手（2コマンド目）:
  npm run dev:all

ブラウザ:
  http://localhost:3100/setup

仲間向け手順の正本:
  README.md 冒頭「仲間向け・最短」と docs/onboarding.md
`);
