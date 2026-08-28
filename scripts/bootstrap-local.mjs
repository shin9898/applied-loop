#!/usr/bin/env node
/**
 * clone 直後の最短起動（ADR-0019 P0 B6-2 / P1 B6-3・B6-4 / W5-8 #14）。
 * preflight → install → .env 生成/補完 → migrate → tutorial seed
 * → 採点CLI診断 → MCP登録スニペット出力。
 */
import { execSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve, dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

function harnessCollectorInstallDecision() {
  if (process.env.APPLIED_LOOP_SKIP_HARNESS_COLLECTOR === "1") {
    return { install: false, reason: "APPLIED_LOOP_SKIP_HARNESS_COLLECTOR=1" };
  }
  if (process.platform !== "darwin") {
    return { install: false, reason: "macOS以外" };
  }
  if (process.env.CI) {
    return { install: false, reason: "CI" };
  }
  const forced = process.env.APPLIED_LOOP_INSTALL_HARNESS_COLLECTOR === "1";
  if (!forced && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    return {
      install: false,
      reason: "非対話環境（必要なら APPLIED_LOOP_INSTALL_HARNESS_COLLECTOR=1）",
    };
  }
  return { install: true, reason: forced ? "明示opt-in" : "対話的macOS setup" };
}

function setupHarnessCollector() {
  const decision = harnessCollectorInstallDecision();
  if (!decision.install) {
    console.log(`ハーネスメタデータ自動収集: skip (${decision.reason})`);
    return;
  }
  console.log(`ハーネスメタデータ自動収集: LaunchAgentを登録 (${decision.reason})`);
  run("node scripts/manage-harness-collector.mjs install");
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
} catch {
  console.warn("migrate deploy に失敗。prisma db push でスキーマを同期する…");
  run("npx prisma db push");
}
// generated client は gitignore。seed / Next の前に必須
run("npx prisma generate");
run("npm run seed:tutorial");
setupHarnessCollector();

// --- ここから W5-8 #14: 採点CLI診断 + MCP登録スニペット ---

/** headless-llm.ts と同じ探索順（GUI/launchd で PATH が細いことがあるため） */
function enrichedPath() {
  const extras = [
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".npm-global", "bin"),
  ];
  return [...new Set([...extras, ...(process.env.PATH ?? "").split(delimiter)])].join(delimiter);
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCli(name) {
  for (const dir of enrichedPath().split(delimiter)) {
    const full = join(dir, name);
    if (isExecutable(full)) return full;
  }
  return null;
}

console.log("\n採点CLIの検出:");
for (const name of ["claude", "codex"]) {
  const found = findCli(name);
  console.log(
    found
      ? `  ${name}: 見つかった (${found})`
      : `  ${name}: 見つからない — 採点が動かない場合はこの CLI にログイン済みか確認する`,
  );
}
if (!findCli("claude") && !findCli("codex")) {
  console.log(
    "  → どちらも無いと出題・採点が動かない。HEADLESS_LLM_PROVIDER=auto は claude→codex の順に試す",
  );
}

const finalEnvText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const mcpToken = finalEnvText.match(/^MCP_TOKEN=(.*)$/m)?.[1]?.trim() || "<token>";

function mcpSnippet(client) {
  if (client === "1") {
    return `claude mcp add --transport http applied-loop http://localhost:3100/api/mcp \\\n  --header "Authorization: Bearer ${mcpToken}"`;
  }
  if (client === "2") {
    return `~/.cursor/mcp.json に追加:\n{\n  "mcpServers": {\n    "applied-loop": {\n      "url": "http://localhost:3100/api/mcp",\n      "headers": { "Authorization": "Bearer ${mcpToken}" }\n    }\n  }\n}`;
  }
  if (client === "3") {
    return `~/.codex/config.toml に追加:\n[mcp_servers.applied-loop]\nurl = "http://localhost:3100/api/mcp"\nhttp_headers = { Authorization = "Bearer ${mcpToken}" }`;
  }
  return null;
}

async function printMcpSnippet() {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) {
    console.log(
      "\nMCP 登録スニペット（非対話環境のため3クライアント分をまとめて表示。詳細: docs/mcp-setup.md）:",
    );
    for (const c of ["1", "2", "3"]) {
      console.log(`\n[${{ 1: "Claude Code", 2: "Cursor", 3: "Codex" }[c]}]`);
      console.log(mcpSnippet(c));
    }
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(
        "\nMCP をどのクライアントに登録する？ [1] Claude Code  [2] Cursor  [3] Codex  [4] あとで: ",
      )
    ).trim();
    const snippet = mcpSnippet(answer);
    if (snippet) {
      console.log(`\n${snippet}\n`);
    } else {
      console.log("\nスキップ。あとで docs/mcp-setup.md を参照する。");
    }
  } finally {
    rl.close();
  }
}

await printMcpSnippet();

console.log(`
---
次の一手（2コマンド目）:
  npm run dev:all

macOS の通常運用:
  npm run setup の成功時に15分周期の自動収集を有効化済み
  npm run harness:collector:status

ブラウザ:
  http://localhost:3100/setup

仲間向け手順の正本:
  README.md 冒頭「仲間向け・最短」と docs/onboarding.md
  同僚ウォークスルー: docs/walkthrough-checklist.md
`);
