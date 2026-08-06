#!/usr/bin/env node
/**
 * clone 直後の最短起動（ADR-0019 P0 B6-2 / P1 B6-3・B6-4）。
 * preflight → install → .env 生成/補完 → migrate → tutorial seed。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

function isWeakToken(value) {
  const v = (value ?? "").trim();
  if (!v) return true;
  if (/^replace-with/i.test(v)) return true;
  if (/change-me|your-token|xxx|todo/i.test(v)) return true;
  if (v.length < 16) return true;
  return false;
}

function ensureMcpToken(envText) {
  const token = `al_${randomBytes(24).toString("hex")}`;
  if (!/^MCP_TOKEN=/m.test(envText)) {
    return {
      text: `${envText.trimEnd()}\nMCP_TOKEN=${token}\n`,
      created: true,
      token,
    };
  }
  const match = envText.match(/^MCP_TOKEN=(.*)$/m);
  const current = match?.[1] ?? "";
  if (!isWeakToken(current)) {
    return { text: envText, created: false, token: current.trim() };
  }
  return {
    text: envText.replace(/^MCP_TOKEN=.*$/m, `MCP_TOKEN=${token}`),
    created: true,
    token,
  };
}

/** クリーン clone で migrate が落ちないよう DATABASE_URL を必ず置く */
function ensureDatabaseUrl(envText) {
  if (/^DATABASE_URL=/m.test(envText)) {
    return { text: envText, created: false };
  }
  return {
    text: `${envText.trimEnd()}\nDATABASE_URL="file:./dev.db"\n`,
    created: true,
  };
}

console.log("Applied Loop — local bootstrap");

// B6-4: Node / ポート
run("node scripts/preflight-local.mjs");

if (!existsSync(resolve(root, "node_modules"))) {
  run("npm install");
} else {
  console.log("node_modules: ok");
}

if (!existsSync(examplePath)) {
  console.error(".env.example がありません");
  process.exit(1);
}

if (!existsSync(envPath)) {
  let text = readFileSync(examplePath, "utf8");
  const ensured = ensureMcpToken(text);
  text = ensureDatabaseUrl(ensured.text).text;
  if (!/^MCP_SURFACE=/m.test(text)) {
    text += `\n# MCP ツール面: core（既定）| full（本人用）\nMCP_SURFACE=core\n`;
  }
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`);
  console.log(`.env を作成しました（MCP_TOKEN 自動生成）`);
} else {
  let text = readFileSync(envPath, "utf8");
  const ensured = ensureMcpToken(text);
  text = ensured.text;
  const db = ensureDatabaseUrl(text);
  text = db.text;
  if (!/^MCP_SURFACE=/m.test(text)) {
    text += `\nMCP_SURFACE=core\n`;
  }
  if (ensured.created || db.created) {
    writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`);
    if (ensured.created) {
      console.log(".env: 弱い／空の MCP_TOKEN を自動生成して書き戻した");
    }
    if (db.created) {
      console.log('.env: DATABASE_URL="file:./dev.db" を追加した');
    }
  } else {
    console.log(".env: MCP_TOKEN / DATABASE_URL は揃っている（維持）");
  }
}

// 非対話。migrations を適用。失敗時は schema を db push（履歴ドリフトの保険）
try {
  run("npx prisma migrate deploy");
} catch (e) {
  console.warn("migrate deploy に失敗。prisma db push でスキーマを同期する…");
  run("npx prisma db push");
}
// generated client は gitignore。seed / Next の前に必須
run("npx prisma generate");
run("npm run seed:tutorial");

console.log(`
---
次の一手（2コマンド目）:
  npm run dev:all

ブラウザ:
  http://localhost:3100/setup

仲間向け手順の正本:
  README.md 冒頭「仲間向け・最短」と docs/onboarding.md
  同僚ウォークスルー: docs/walkthrough-checklist.md
`);
