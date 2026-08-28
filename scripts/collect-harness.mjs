#!/usr/bin/env node
/**
 * ハーネス観測メタデータの増分収集 (ADR-0009)。
 *
 * プライバシー不変条件:
 * - 会話本文 (user/assistant の text・thinking・tool input/result) は一切読まない
 * - 読み取るのは type / timestamp / sessionId / cwd / model / usage / tool_use.name のみ
 * - contextFingerprint は本文を読まず、metadata-derived cohort hash または明示された
 *   APPLIED_LOOP_CONTEXT_FINGERPRINT を送る
 * - 送信ペイロードにも本文フィールドを含めない
 *
 * 使い方:
 *   node scripts/collect-harness.mjs
 *   APPLIED_LOOP_URL=http://localhost:3100 MCP_TOKEN=... node scripts/collect-harness.mjs
 *   node scripts/collect-harness.mjs --dry-run --snapshot-out /tmp/harness-targets.json --max-sends 707
 *   node scripts/collect-harness.mjs --apply-snapshot /tmp/harness-targets.json --max-sends 707
 *
 * snapshot は送信対象のファイルパス・size/mtime・sessionId・cohort identity
 * だけを保持し、会話本文や送信 payload は保持しない。通常の定期収集は
 * 従来どおり無制限の増分収集として動作する。
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createHarnessContextFingerprint,
  isHarnessContextFingerprint,
} from "./harness-context-fingerprint.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH =
  process.env.APPLIED_LOOP_COLLECT_STATE_PATH ||
  join(SCRIPT_DIR, ".harness-collect-state.json");
const BASE_URL = (process.env.APPLIED_LOOP_URL || "http://localhost:3100").replace(
  /\/$/,
  ""
);
const TOKEN = process.env.MCP_TOKEN || loadEnvToken();
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");
// Source identity only. It is not derived from or a hash of conversation text.
const COLLECTOR_VERSION = "harness-collector-v3";
const SNAPSHOT_SCHEMA_VERSION = 1;

function parseNonNegativeInteger(raw, optionName) {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${optionName} must be a non-negative integer: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${optionName} is too large: ${raw}`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    dryRun: false,
    snapshotOutPath: null,
    applySnapshotPath: null,
    maxSends: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    const optionWithValue = ["--max-sends", "--snapshot-out", "--apply-snapshot"].find(
      (option) => arg === option || arg.startsWith(`${option}=`),
    );
    if (!optionWithValue) {
      throw new Error(`unknown option: ${arg}`);
    }

    let value = arg.slice(optionWithValue.length + 1);
    if (!value) {
      index += 1;
      value = argv[index];
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${optionWithValue} requires a value`);
    }

    if (optionWithValue === "--max-sends") {
      options.maxSends = parseNonNegativeInteger(value, optionWithValue);
    } else if (optionWithValue === "--snapshot-out") {
      options.snapshotOutPath = resolve(value);
    } else {
      options.applySnapshotPath = resolve(value);
    }
  }

  if (options.help) return options;
  if (options.snapshotOutPath && options.applySnapshotPath) {
    throw new Error("--snapshot-out and --apply-snapshot are mutually exclusive");
  }
  if (options.snapshotOutPath && !options.dryRun) {
    throw new Error("--snapshot-out requires --dry-run");
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/collect-harness.mjs",
    "  node scripts/collect-harness.mjs --max-sends N",
    "  node scripts/collect-harness.mjs --dry-run --snapshot-out PATH [--max-sends N]",
    "  node scripts/collect-harness.mjs --apply-snapshot PATH [--max-sends N]",
    "",
    "--snapshot-out is read-only and creates a deterministic local target manifest.",
    "--apply-snapshot sends only targets in that manifest and fails closed if any target is stale.",
    "--max-sends limits HTTP send attempts; it is a safety valve, not a cohort definition.",
  ].join("\n");
}

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

function sameFileFingerprint(left, right) {
  return left?.size === right?.size && left?.mtimeMs === right?.mtimeMs;
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortCandidates(candidates) {
  return [...candidates].sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.harness, right.harness),
  );
}

function parseCandidate(item) {
  return item.harness === "claude"
    ? parseClaudeFile(item.path, item.fallbackRepo)
    : parseCodexFile(item.path);
}

function createSnapshotTarget(item, fileStats, parsed, contextFingerprint) {
  return {
    path: item.path,
    harness: item.harness,
    fallbackRepo: item.fallbackRepo ?? null,
    size: fileStats.size,
    mtimeMs: fileStats.mtimeMs,
    sessionId: parsed.sessionId,
    contextFingerprint,
  };
}

function createSnapshotDocument(targets, summary) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    collectorVersion: COLLECTOR_VERSION,
    createdAt: new Date().toISOString(),
    targets,
    summary: {
      ...summary,
      selectedCount: targets.length,
    },
  };
}

function validateSnapshotDocument(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("invalid snapshot: expected an object");
  }
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `invalid snapshot: unsupported schemaVersion ${String(snapshot.schemaVersion)}`,
    );
  }
  if (snapshot.collectorVersion !== COLLECTOR_VERSION) {
    throw new Error(
      `invalid snapshot: collectorVersion must be ${COLLECTOR_VERSION}`,
    );
  }
  if (!Array.isArray(snapshot.targets)) {
    throw new Error("invalid snapshot: targets must be an array");
  }

  const seenPaths = new Set();
  for (const [index, target] of snapshot.targets.entries()) {
    if (!target || typeof target !== "object") {
      throw new Error(`invalid snapshot target at index ${index}`);
    }
    if (
      typeof target.path !== "string" ||
      !isAbsolute(target.path) ||
      !target.path
    ) {
      throw new Error(`invalid snapshot target path at index ${index}`);
    }
    if (seenPaths.has(target.path)) {
      throw new Error(`invalid snapshot: duplicate target path ${target.path}`);
    }
    seenPaths.add(target.path);
    if (target.harness !== "claude" && target.harness !== "codex") {
      throw new Error(`invalid snapshot target harness at index ${index}`);
    }
    if (
      target.fallbackRepo !== null &&
      typeof target.fallbackRepo !== "string"
    ) {
      throw new Error(`invalid snapshot target fallbackRepo at index ${index}`);
    }
    if (!Number.isSafeInteger(target.size) || target.size < 0) {
      throw new Error(`invalid snapshot target size at index ${index}`);
    }
    if (!Number.isFinite(target.mtimeMs) || target.mtimeMs < 0) {
      throw new Error(`invalid snapshot target mtimeMs at index ${index}`);
    }
    if (typeof target.sessionId !== "string" || !target.sessionId) {
      throw new Error(`invalid snapshot target sessionId at index ${index}`);
    }
    if (!isHarnessContextFingerprint(target.contextFingerprint)) {
      throw new Error(
        `invalid snapshot target contextFingerprint at index ${index}`,
      );
    }
  }
  return snapshot;
}

function loadSnapshot(snapshotPath) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  return validateSnapshotDocument(snapshot);
}

function saveSnapshot(snapshotPath, snapshot) {
  validateSnapshotDocument(snapshot);
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
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

function toPayload(parsed, previousContextFingerprint) {
  const { harness, sessionId, agg } = parsed;
  const contextFingerprint = isHarnessContextFingerprint(previousContextFingerprint)
    ? previousContextFingerprint
    : createHarnessContextFingerprint({
        harness,
        model: agg.model,
        repo: agg.repo,
      });
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
    collectorVersion: COLLECTOR_VERSION,
    contextFingerprint,
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
    "collectorVersion",
    "contextFingerprint",
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

async function postRun(payload, { dryRun }) {
  assertNoConversationBody(payload);
  if (dryRun) {
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

function buildSnapshotPlan(candidates, state, maxSends) {
  const orderedCandidates = sortCandidates(candidates);
  const targets = [];
  const failures = [];
  let skippedUnchanged = 0;
  let unparseable = 0;
  let eligibleCount = 0;

  for (const item of orderedCandidates) {
    let fp;
    try {
      fp = fileFingerprint(item.path);
    } catch (error) {
      failures.push({
        path: item.path,
        reason: "stat_failed",
        message: error.message || String(error),
      });
      continue;
    }

    const prev = state.files[item.path];
    if (prev && sameFileFingerprint(prev, fp)) {
      skippedUnchanged += 1;
      continue;
    }

    let parsed;
    try {
      parsed = parseCandidate(item);
    } catch (error) {
      failures.push({
        path: item.path,
        reason: "parse_failed",
        message: error.message || String(error),
      });
      continue;
    }
    if (!parsed) {
      unparseable += 1;
      continue;
    }

    const payload = toPayload(parsed, prev?.contextFingerprint);
    assertNoConversationBody(payload);
    eligibleCount += 1;
    if (maxSends !== null && targets.length >= maxSends) continue;

    targets.push(
      createSnapshotTarget(
        item,
        fp,
        parsed,
        payload.contextFingerprint,
      ),
    );
  }

  return {
    document: createSnapshotDocument(targets, {
      candidateCount: orderedCandidates.length,
      eligibleCount,
      skippedUnchanged,
      unparseable,
      errorCount: failures.length,
      maxSends,
    }),
    failures,
  };
}

class SnapshotStaleError extends Error {
  constructor(details) {
    const preview = details
      .slice(0, 3)
      .map((detail) => `${detail.reason}:${detail.path}`)
      .join(", ");
    super(
      `snapshot_stale: ${details.length} target(s) changed or became unreadable` +
        (preview ? ` (${preview})` : ""),
    );
    this.name = "SnapshotStaleError";
    this.details = details;
  }
}

function preflightSnapshot(snapshot) {
  const preparedByPath = new Map();
  const stale = [];

  for (const target of snapshot.targets) {
    let fp;
    try {
      fp = fileFingerprint(target.path);
    } catch (error) {
      stale.push({
        path: target.path,
        reason: "missing_or_unreadable",
        message: error.message || String(error),
      });
      continue;
    }
    if (!sameFileFingerprint(fp, target)) {
      stale.push({ path: target.path, reason: "fingerprint_changed" });
      continue;
    }

    let parsed;
    try {
      parsed = parseCandidate(target);
    } catch (error) {
      stale.push({
        path: target.path,
        reason: "parse_failed",
        message: error.message || String(error),
      });
      continue;
    }
    if (!parsed) {
      stale.push({ path: target.path, reason: "became_unparseable" });
      continue;
    }
    if (parsed.harness !== target.harness || parsed.sessionId !== target.sessionId) {
      stale.push({ path: target.path, reason: "session_identity_changed" });
      continue;
    }

    try {
      const payload = toPayload(parsed, target.contextFingerprint);
      assertNoConversationBody(payload);
    } catch (error) {
      stale.push({
        path: target.path,
        reason: "payload_invariant_failed",
        message: error.message || String(error),
      });
      continue;
    }
    preparedByPath.set(target.path, { parsed });
  }

  if (stale.length) throw new SnapshotStaleError(stale);
  return preparedByPath;
}

async function collectItems(
  items,
  state,
  { dryRun, maxSends, preparedByPath = null, shouldStop = () => false },
) {
  const result = {
    sent: 0,
    attempts: 0,
    skippedUnchanged: 0,
    unparseable: 0,
    errors: 0,
    staleSnapshot: 0,
    stalePaths: [],
    stoppedAtLimit: false,
    interrupted: false,
  };

  for (const item of items) {
    if (shouldStop()) {
      result.interrupted = true;
      break;
    }

    let fp;
    try {
      fp = fileFingerprint(item.path);
    } catch (error) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      result.errors += 1;
      console.error(`[harness-collect] stat error ${item.path}:`, error.message || error);
      continue;
    }

    if (preparedByPath && !sameFileFingerprint(fp, item)) {
      result.staleSnapshot += 1;
      result.stalePaths.push(item.path);
      break;
    }

    const prev = state.files[item.path];
    if (prev && sameFileFingerprint(prev, fp)) {
      result.skippedUnchanged += 1;
      continue;
    }

    let parsed = preparedByPath?.get(item.path)?.parsed;
    try {
      if (!parsed) parsed = parseCandidate(item);
    } catch (error) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      result.errors += 1;
      console.error(`[harness-collect] parse error ${item.path}:`, error.message || error);
      continue;
    }

    if (!parsed) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      if (!dryRun) state.files[item.path] = { ...fp, skipped: true };
      result.unparseable += 1;
      continue;
    }

    if (
      preparedByPath &&
      (parsed.harness !== item.harness || parsed.sessionId !== item.sessionId)
    ) {
      result.staleSnapshot += 1;
      result.stalePaths.push(item.path);
      break;
    }

    try {
      const payload = preparedByPath
        ? toPayload(parsed, item.contextFingerprint)
        : toPayload(parsed, prev?.contextFingerprint);
      assertNoConversationBody(payload);

      if (maxSends !== null && result.attempts >= maxSends) {
        result.stoppedAtLimit = true;
        break;
      }

      // attempts counts HTTP simulations too, so the safety valve remains a hard cap
      // even when the server returns errors.
      result.attempts += 1;
      await postRun(payload, { dryRun });
      result.sent += 1;
      if (!dryRun) {
        state.files[item.path] = {
          ...fp,
          harness: parsed.harness,
          sessionId: parsed.sessionId,
          contextFingerprint: payload.contextFingerprint,
        };
        if (result.sent % 50 === 0) {
          saveState(state);
          console.log(`[harness-collect] progress sent=${result.sent}`);
        }
      }
    } catch (error) {
      result.errors += 1;
      console.error(`[harness-collect] error ${item.path}:`, error.message || error);
    }
  }

  return result;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const state = loadState();
  state.files ??= {};
  const candidates = sortCandidates([...listClaudeSessions(), ...listCodexSessions()]);

  if (options.snapshotOutPath) {
    const plan = buildSnapshotPlan(candidates, state, options.maxSends);
    console.log(
      `[harness-collect] snapshot-plan candidates=${plan.document.summary.candidateCount}` +
        ` eligible=${plan.document.summary.eligibleCount}` +
        ` selected=${plan.document.summary.selectedCount}` +
        ` skippedUnchanged=${plan.document.summary.skippedUnchanged}` +
        ` unparseable=${plan.document.summary.unparseable}` +
        ` errors=${plan.document.summary.errorCount}`,
    );
    if (plan.failures.length) {
      const first = plan.failures[0];
      throw new Error(
        `snapshot_not_created: ${plan.failures.length} candidate(s) failed` +
          ` (${first.reason}:${first.path})`,
      );
    }
    saveSnapshot(options.snapshotOutPath, plan.document);
    console.log(
      `[harness-collect] snapshot-written path=${options.snapshotOutPath}` +
        ` targets=${plan.document.targets.length}`,
    );
    return;
  }

  let items = candidates;
  let preparedByPath = null;
  let snapshot = null;
  if (options.applySnapshotPath) {
    snapshot = loadSnapshot(options.applySnapshotPath);
    preparedByPath = preflightSnapshot(snapshot);
    items = snapshot.targets;
  }

  // A snapshot is already a finite target set; max-sends can only narrow it.
  const maxSends = snapshot
    ? Math.min(options.maxSends ?? snapshot.targets.length, snapshot.targets.length)
    : options.maxSends;
  console.log(
    `[harness-collect] candidates=${items.length} url=${BASE_URL}` +
      ` dryRun=${options.dryRun} maxSends=${maxSends ?? "unlimited"}` +
      ` snapshot=${snapshot ? options.applySnapshotPath : "none"}`,
  );

  let interrupted = false;
  const onSigint = () => {
    if (!interrupted) {
      interrupted = true;
      console.error("[harness-collect] interrupt requested; finishing current request");
    }
  };
  process.once("SIGINT", onSigint);

  let result;
  try {
    result = await collectItems(items, state, {
      dryRun: options.dryRun,
      maxSends,
      preparedByPath,
      shouldStop: () => interrupted,
    });
  } finally {
    process.off("SIGINT", onSigint);
    // Dry-run must remain read-only; actual collection persists only successful sends
    // and deliberate parse skips.
    if (!options.dryRun) saveState(state);
  }

  console.log(
    `[harness-collect] done sent=${result.sent}` +
      ` attempts=${result.attempts}` +
      ` skippedUnchanged=${result.skippedUnchanged}` +
      ` unparseable=${result.unparseable}` +
      ` errors=${result.errors}` +
      ` staleSnapshot=${result.staleSnapshot}` +
      ` stoppedAtLimit=${result.stoppedAtLimit}` +
      ` interrupted=${result.interrupted}`,
  );
  if (result.staleSnapshot) {
    throw new SnapshotStaleError(
      result.stalePaths.map((path) => ({ path, reason: "changed_during_send" })),
    );
  }
  if (result.interrupted) process.exitCode = 130;
}

export {
  COLLECTOR_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  createSnapshotDocument,
  parseArgs,
  sameFileFingerprint,
  sortCandidates,
  validateSnapshotDocument,
};

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedScript === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
