#!/usr/bin/env node
/**
 * Cloud Agent 向け MCP 設定片を標準出力する。
 *
 * Usage:
 *   npm run mcp:cloud-config
 *   npm run mcp:cloud-config -- --redact
 *   APPLIED_LOOP_URL=https://xxx.trycloudflare.com MCP_TOKEN=... node scripts/print-cloud-mcp-config.mjs
 *
 * .env があれば自動で読む（既存値を上書きしない）。
 * 詳細: docs/cloud-mcp.md / /setup『Cloud で使いたい場合』
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const redact = process.argv.includes("--redact");

function loadDotEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const base = (
  process.env.MCP_PUBLIC_URL ||
  process.env.APPLIED_LOOP_URL ||
  "http://localhost:3100"
)
  .trim()
  .replace(/\/+$/, "");
const mcpUrl = `${base}/api/mcp`;
const tokenRaw = process.env.MCP_TOKEN?.trim() || "";
const token = redact || !tokenRaw ? "<MCP_TOKEN>" : tokenRaw;

let host = "";
try {
  host = new URL(base).hostname.toLowerCase();
} catch {
  host = "";
}
const loopback =
  host === "localhost" || host === "127.0.0.1" || host === "::1";

if (loopback) {
  console.error(
    "警告: いまの URL は localhost です。Cloud からは届きません。\n" +
      "  1) トンネル例: cloudflared tunnel --url http://localhost:3100\n" +
      "  2) .env に APPLIED_LOOP_URL=https://.... を書いて再実行\n" +
      "詳細: docs/cloud-mcp.md\n",
  );
}
if (!tokenRaw) {
  console.error(
    "警告: MCP_TOKEN が空です。Reachable MCP では必須です（.env を確認）。\n",
  );
}

const cursorJson = JSON.stringify(
  {
    mcpServers: {
      "applied-loop": {
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  },
  null,
  2,
);

const claudeProjectJson = JSON.stringify(
  {
    mcpServers: {
      "applied-loop": {
        type: "http",
        url: mcpUrl,
        headers: {
          Authorization: "Bearer ${MCP_TOKEN}",
        },
      },
    },
  },
  null,
  2,
);

const verify = [
  "applied-loop の morning_briefing を呼んで要点をまとめて。",
  "続けて list_pending_gates で最大3件を見て、次に解くゲートを1つ提案して。",
  "answer_gate は私が「解く」と言うまで呼ばない。",
  "MCP が見えない / 401 / timeout ならそこで止めて原因を報告して。",
].join("\n");

console.log(`# Applied Loop — Cloud MCP config`);
console.log(`# base: ${base}`);
console.log(`# mcp:  ${mcpUrl}`);
console.log(`# reachable: ${!loopback}`);
console.log(`# docs: docs/cloud-mcp.md`);
console.log(`# ui:   /setup → Cloud で使いたい場合`);
console.log("");
console.log("# Cursor = dogfood 済み / Claude・Codex = 公式 docs 準拠・未 dogfood");
console.log("# Desktop 設定は別ホストのセッションに自動では載らない");
console.log("");
console.log("## Cursor Cloud Agent (dogfood OK)");
console.log("# 登録先: https://cursor.com/agents → + → MCP Servers → Add MCP (HTTP)");
console.log("# Header: Key=Authorization / Value=Bearer <MCP_TOKEN>");
console.log("# 罠: ~/.cursor/mcp.json は Cloud Agent に効かない");
console.log(cursorJson);
console.log("");
console.log("## Claude Code — .mcp.json for Web (docs; not dogfooded)");
console.log("# Claude Code on the web reads repo-root .mcp.json (official)");
console.log("# type: http is required; secrets via ${MCP_TOKEN}");
console.log("# 罠: ~/.claude.json does NOT load in web sessions");
console.log(claudeProjectJson);
console.log("");
console.log("## Claude Code — CLI on that machine (docs; not dogfooded)");
console.log(
  `claude mcp add --transport http applied-loop ${mcpUrl} \\\n  --header "Authorization: Bearer ${token}"`,
);
console.log("# project file: add --scope project");
console.log("# 確認: /mcp → applied-loop");
console.log("");
console.log("## Codex (docs; not dogfooded)");
console.log("# Same host: CLI / IDE / ChatGPT desktop share config.toml");
console.log("# Portable: .codex/config.toml (trusted projects only)");
console.log("# Prefer bearer_token_env_var; export MCP_TOKEN on that host");
console.log("# No confirmed Cursor-like Cloud-only Add MCP UI");
console.log(`[mcp_servers.applied-loop]`);
console.log(`url = "${mcpUrl}"`);
console.log(`bearer_token_env_var = "MCP_TOKEN"`);
console.log("");
console.log("## Verify prompt (paste into a new session)");
console.log(verify);
