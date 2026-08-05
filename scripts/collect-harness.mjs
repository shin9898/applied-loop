#!/usr/bin/env node
/**
 * ハーネス観測メタデータの増分収集 (ADR-0009)。
 *
 * プライバシー不変条件:
 * - 会話本文 (user/assistant の text・thinking・tool input/result) は一切読まない
 * - 読み取るのは type / timestamp / sessionId / cwd / model / usage / tool_use.name のみ
 * - 送信ペイロードにも本文フィールドを含めない
 *
 * 使い方:
 *   node scripts/collect-harness.mjs
 *   APPLIED_LOOP_URL=http://localhost:3100 MCP_TOKEN=... node scripts/collect-harness.mjs
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(SCRIPT_DIR, ".harness-collect-state.json");
const BASE_URL = (process.env.APPLIED_LOOP_URL || "http://localhost:3100").replace(
  /\/$/,
  ""
);
const TOKEN = process.env.MCP_TOKEN || loadEnvToken();
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnvToken() {
  try {
    const envPath = join(SCRIPT_DIR, "..", ".env");
    if (!existsSync(envPath)) return "";
    const text = readFileSync(envPath, "utf8");
    const m = text.match(/^\s*MCP_TOKEN\s*=\s*(.+)\s*$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return { files: {} };
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { files: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Claude Code: `/` → `-`, `.` → `--` の逆変換 (ハイフン名は曖昧) */
function decodeClaudeProjectDir(encoded) {
  if (!encoded || encoded === "-") return null;
  const withDots = encoded.replace(/--/g, "\u0000");
  const path = withDots.replace(/-/g, "/").replace(/\u0000/g, ".");
  return path.startsWith("/") ? path : `/${path}`;
}

function repoFromPath(p) {
  if (!p) return null;
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function classifyTool(name) {
  if (!name) return "builtin";
  if (name.startsWith("mcp__") || name.includes("__")) return "mcp";
  if (name.toLowerCase().includes("skill")) return "skill";
  return "builtin";
}

/**
 * 1 行の JSON からメタデータだけ抽出。本文フィールドには触れない。
 * @returns {null | object}
 */
function extractClaudeLineMeta(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;

  const meta = {
    type: typeof o.type === "string" ? o.type : null,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
    sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
    cwd: typeof o.cwd === "string" ? o.cwd : null,
  };

  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    meta.model = typeof o.message.model === "string" ? o.message.model : null;
    const u = o.message.usage;
    if (u && typeof u === "object") {
      meta.usage = {
        input_tokens: Number(u.input_tokens) || 0,
        output_tokens: Number(u.output_tokens) || 0,
        cache_read_input_tokens: Number(u.cache_read_input_tokens) || 0,
        cache_creation_input_tokens: Number(u.cache_creation_input_tokens) || 0,
        thinking_tokens:
          Number(u.thinking_tokens) ||
          Number(u.output_tokens_details?.reasoning_tokens) ||
          0,
      };
    }
    // tool_use の name だけ読む。text / thinking / input は参照しない
    const content = o.message.content;
    if (Array.isArray(content)) {
      const tools = [];
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          block.type === "tool_use" &&
          typeof block.name === "string"
        ) {
          tools.push(block.name);
        }
      }
      if (tools.length) meta.toolNames = tools;
    }
  }

  // user ターン判定: role=user かつ content が文字列 (tool_result 配列は除外)
  // content の中身は読まず、型だけ見る
  if (o.type === "user" && o.message && typeof o.message === "object") {
    const c = o.message.content;
    meta.isUserTurn = typeof c === "string";
  }

  return meta;
}

function emptyAgg() {
  return {
    model: null,
    repo: null,
    cwd: null,
    tools: new Map(),
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreate: 0,
    thinking: 0,
    turns: 0,
    startedAt: null,
    endedAt: null,
  };
}

function applyClaudeMeta(agg, meta) {
  if (!meta) return;
  if (meta.cwd && !agg.cwd) {
    agg.cwd = meta.cwd;
    agg.repo = repoFromPath(meta.cwd);
  }
  if (meta.timestamp) {
    if (!agg.startedAt || meta.timestamp < agg.startedAt) agg.startedAt = meta.timestamp;
    if (!agg.endedAt || meta.timestamp > agg.endedAt) agg.endedAt = meta.timestamp;
  }
  if (meta.model) agg.model = meta.model;
  if (meta.usage) {
    // assistant メッセージごとの usage は累積ではなくその応答分。合算する
    agg.tokensIn += meta.usage.input_tokens;
    agg.tokensOut += meta.usage.output_tokens;
    agg.cacheRead += meta.usage.cache_read_input_tokens;
    agg.cacheCreate += meta.usage.cache_creation_input_tokens;
    agg.thinking += meta.usage.thinking_tokens;
  }
  if (meta.toolNames) {
    for (const name of meta.toolNames) {
      const cur = agg.tools.get(name) || { name, kind: classifyTool(name), calls: 0 };
      cur.calls += 1;
      agg.tools.set(name, cur);
    }
  }
  if (meta.isUserTurn) agg.turns += 1;
}

function parseClaudeFile(filePath, fallbackRepo) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const agg = emptyAgg();
  let sessionId = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const meta = extractClaudeLineMeta(line);
    if (!meta) continue;
    if (meta.sessionId) sessionId = meta.sessionId;
    applyClaudeMeta(agg, meta);
  }

  if (!sessionId) {
    sessionId = basename(filePath, ".jsonl");
  }
  if (!agg.repo && fallbackRepo) agg.repo = fallbackRepo;
  if (!agg.startedAt) return null;

  return { harness: "claude", sessionId, agg };
}

function extractCodexLineMeta(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;

  const meta = {
    type: typeof o.type === "string" ? o.type : null,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
    payloadType:
      o.payload && typeof o.payload === "object" && typeof o.payload.type === "string"
        ? o.payload.type
        : null,
  };

  if (o.type === "session_meta" && o.payload && typeof o.payload === "object") {
    meta.sessionId = typeof o.payload.id === "string" ? o.payload.id : null;
    meta.cwd = typeof o.payload.cwd === "string" ? o.payload.cwd : null;
    // base_instructions 等の本文は読まない
  }

  if (o.type === "turn_context" && o.payload && typeof o.payload === "object") {
    if (typeof o.payload.model === "string") meta.model = o.payload.model;
  }

  if (
    o.type === "event_msg" &&
    o.payload &&
    typeof o.payload === "object" &&
    o.payload.type === "token_count" &&
    o.payload.info &&
    typeof o.payload.info === "object"
  ) {
    const total = o.payload.info.total_token_usage;
    if (total && typeof total === "object") {
      meta.tokenTotal = {
        input_tokens: Number(total.input_tokens) || 0,
        output_tokens: Number(total.output_tokens) || 0,
        cached_input_tokens: Number(total.cached_input_tokens) || 0,
        reasoning_output_tokens: Number(total.reasoning_output_tokens) || 0,
      };
    }
  }

  if (
    o.type === "response_item" &&
    o.payload &&
    typeof o.payload === "object" &&
    (o.payload.type === "function_call" || o.payload.type === "custom_tool_call") &&
    typeof o.payload.name === "string"
  ) {
    // arguments は読まない
    meta.toolName = o.payload.name;
  }

  if (
    o.type === "event_msg" &&
    o.payload &&
    typeof o.payload === "object" &&
    o.payload.type === "user_message"
  ) {
    meta.isUserTurn = true;
  }

  return meta;
}

function parseCodexFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const agg = emptyAgg();
  let sessionId = null;
  let latestTokens = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const meta = extractCodexLineMeta(line);
    if (!meta) continue;
    if (meta.sessionId) sessionId = meta.sessionId;
    if (meta.cwd && !agg.cwd) {
      agg.cwd = meta.cwd;
      agg.repo = repoFromPath(meta.cwd);
    }
    if (meta.timestamp) {
      if (!agg.startedAt || meta.timestamp < agg.startedAt) agg.startedAt = meta.timestamp;
      if (!agg.endedAt || meta.timestamp > agg.endedAt) agg.endedAt = meta.timestamp;
    }
    if (meta.model) agg.model = meta.model;
    if (meta.tokenTotal) latestTokens = meta.tokenTotal;
    if (meta.toolName) {
      const name = meta.toolName;
      const cur = agg.tools.get(name) || { name, kind: classifyTool(name), calls: 0 };
      cur.calls += 1;
      agg.tools.set(name, cur);
    }
    if (meta.isUserTurn) agg.turns += 1;
  }

  if (!sessionId) {
    // rollout-...-<uuid>.jsonl
    const m = basename(filePath).match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    sessionId = m ? m[1] : createHash("sha1").update(filePath).digest("hex").slice(0, 32);
  }

  if (latestTokens) {
    // Codex の total は累積。cache は cached_input を cacheRead に、input から差し引かない
    agg.tokensIn = latestTokens.input_tokens;
    agg.tokensOut = latestTokens.output_tokens;
    agg.cacheRead = latestTokens.cached_input_tokens;
    agg.cacheCreate = 0;
    agg.thinking = latestTokens.reasoning_output_tokens;
  }

  if (!agg.startedAt) return null;
  return { harness: "codex", sessionId, agg };
}

function walkJsonl(root, { skipSubagents = false } = {}) {
  const out = [];
  if (!existsSync(root)) return out;

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipSubagents && ent.name === "subagents") continue;
        walk(p);
      } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  }
  walk(root);
  return out;
}

function listClaudeSessions() {
  const files = [];
  if (!existsSync(CLAUDE_PROJECTS)) return files;
  let projects;
  try {
    projects = readdirSync(CLAUDE_PROJECTS, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = join(CLAUDE_PROJECTS, proj.name);
    const decoded = decodeClaudeProjectDir(proj.name);
    const fallbackRepo = repoFromPath(decoded);
    // トップレベル jsonl のみ (subagents は親セッションに含まれるため除外)
    let entries;
    try {
      entries = readdirSync(projDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        files.push({ path: join(projDir, ent.name), fallbackRepo, harness: "claude" });
      }
    }
  }
  return files;
}

function listCodexSessions() {
  if (!existsSync(CODEX_SESSIONS)) return [];
  return walkJsonl(CODEX_SESSIONS).map((path) => ({
    path,
    fallbackRepo: null,
    harness: "codex",
  }));
}

function toPayload(parsed) {
  const { harness, sessionId, agg } = parsed;
  return {
    harness,
    sessionId,
    model: agg.model,
    repo: agg.repo,
    tools: [...agg.tools.values()],
    tokensIn: agg.tokensIn,
    tokensOut: agg.tokensOut,
    cacheRead: agg.cacheRead,
    cacheCreate: agg.cacheCreate,
    thinking: agg.thinking,
    turns: agg.turns,
    startedAt: agg.startedAt,
    endedAt: agg.endedAt,
  };
}

/**
 * 送信ペイロードに会話本文が含まれないことの自己検査。
 * 許可キーはメタデータのみ (thinking はトークン数の数値フィールド)。
 */
function assertNoConversationBody(payload) {
  const allowed = new Set([
    "harness",
    "sessionId",
    "model",
    "repo",
    "tools",
    "name",
    "kind",
    "calls",
    "tokensIn",
    "tokensOut",
    "cacheRead",
    "cacheCreate",
    "thinking",
    "turns",
    "startedAt",
    "endedAt",
  ]);
  function walk(node, path) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (!allowed.has(k)) {
          throw new Error(
            `privacy invariant violated: unexpected key "${k}" at ${path || "root"}`
          );
        }
        // 文字列値は ID・モデル名・repo・ISO 時刻・ツール名のみ想定。長文を拒否
        if (typeof v === "string" && v.length > 240) {
          throw new Error(
            `privacy invariant violated: long string at ${path}.${k} (len=${v.length})`
          );
        }
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  }
  walk(payload, "");
}

async function postRun(payload) {
  assertNoConversationBody(payload);
  if (DRY_RUN) {
    console.log("[dry-run]", payload.harness, payload.sessionId, {
      model: payload.model,
      repo: payload.repo,
      tokensIn: payload.tokensIn,
      tokensOut: payload.tokensOut,
      turns: payload.turns,
      tools: payload.tools.length,
    });
    return { ok: true, dryRun: true };
  }

  const headers = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

  const res = await fetch(`${BASE_URL}/api/harness-runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST failed ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function fileFingerprint(path) {
  const st = statSync(path);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

async function main() {
  const state = loadState();
  state.files ??= {};

  const candidates = [...listClaudeSessions(), ...listCodexSessions()];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  console.log(
    `[harness-collect] candidates=${candidates.length} url=${BASE_URL} dryRun=${DRY_RUN}`
  );

  for (const item of candidates) {
    let fp;
    try {
      fp = fileFingerprint(item.path);
    } catch {
      continue;
    }
    const prev = state.files[item.path];
    if (prev && prev.size === fp.size && prev.mtimeMs === fp.mtimeMs) {
      skipped += 1;
      continue;
    }

    try {
      const parsed =
        item.harness === "claude"
          ? parseClaudeFile(item.path, item.fallbackRepo)
          : parseCodexFile(item.path);
      if (!parsed) {
        state.files[item.path] = { ...fp, skipped: true };
        skipped += 1;
        continue;
      }
      const payload = toPayload(parsed);
      await postRun(payload);
      state.files[item.path] = {
        ...fp,
        harness: parsed.harness,
        sessionId: parsed.sessionId,
      };
      sent += 1;
      if (sent % 50 === 0) {
        saveState(state);
        console.log(`[harness-collect] progress sent=${sent}`);
      }
    } catch (e) {
      errors += 1;
      console.error(`[harness-collect] error ${item.path}:`, e.message || e);
    }
  }

  saveState(state);
  console.log(
    `[harness-collect] done sent=${sent} skippedUnchanged=${skipped} errors=${errors}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
