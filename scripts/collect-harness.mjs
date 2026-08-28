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

import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
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
const DEFAULT_DATA_DIR = join(homedir(), ".applied-loop", "harness-collector");
const LEGACY_STATE_PATH = join(SCRIPT_DIR, ".harness-collect-state.json");
const STATE_PATH =
  process.env.APPLIED_LOOP_COLLECT_STATE_PATH ||
  join(DEFAULT_DATA_DIR, "state.json");
const STATUS_PATH =
  process.env.APPLIED_LOOP_COLLECT_STATUS_PATH ||
  join(DEFAULT_DATA_DIR, "status.json");
const LOCK_PATH =
  process.env.APPLIED_LOOP_COLLECT_LOCK_PATH ||
  join(DEFAULT_DATA_DIR, "collector.lock");
const BASE_URL = (
  process.env.APPLIED_LOOP_URL ||
  loadEnvValue("APPLIED_LOOP_URL") ||
  "http://localhost:3100"
).replace(
  /\/$/,
""
);
const TOKEN = process.env.MCP_TOKEN || loadEnvValue("MCP_TOKEN");
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");
// Source identity only. It is not derived from or a hash of conversation text.
const COLLECTOR_VERSION = "harness-collector-v3";
const SNAPSHOT_SCHEMA_VERSION = 1;
const STATE_SCHEMA_VERSION = 2;
const STATUS_SCHEMA_VERSION = 1;
let activeStatusContext = null;
let activeLockProcess = null;

function parsePositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = parseNonNegativeInteger(raw, name);
  if (value < 1) throw new Error(`${name} must be at least 1`);
  return value;
}

const RETRY_MAX_ATTEMPTS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_RETRY_MAX_ATTEMPTS",
  3,
);
const RETRY_BASE_DELAY_MS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_RETRY_BASE_DELAY_MS",
  1_000,
);
const RETRY_MAX_DELAY_MS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_RETRY_MAX_DELAY_MS",
  15_000,
);
const REQUEST_TIMEOUT_MS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_REQUEST_TIMEOUT_MS",
  20_000,
);
const SCHEDULED_RUN_BUDGET_MS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_RUN_BUDGET_MS",
  12 * 60 * 1_000,
);
const UNKNOWN_LOCK_STALE_MS = parsePositiveIntegerEnv(
  "APPLIED_LOOP_COLLECT_LOCK_UNKNOWN_STALE_MS",
  30_000,
);

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
    status: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--status") {
      options.status = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
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
  if (options.json && !options.status) {
    throw new Error("--json requires --status");
  }
  if (
    options.status &&
    (options.dryRun || options.snapshotOutPath || options.applySnapshotPath || options.maxSends !== null)
  ) {
    throw new Error("--status cannot be combined with collection options");
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
    "  node scripts/collect-harness.mjs --status [--json]",
    "",
    "--snapshot-out is read-only and creates a deterministic local target manifest.",
    "--apply-snapshot sends only targets in that manifest and fails closed if any target is stale.",
    "--max-sends limits HTTP send attempts; it is a safety valve, not a cohort definition.",
    "--status reports the durable checkpoint and pending/error state without sending.",
  ].join("\n");
}

function loadEnvValue(name) {
  try {
    const envPath = join(SCRIPT_DIR, "..", ".env");
    if (!existsSync(envPath)) return "";
    const text = readFileSync(envPath, "utf8");
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(
      new RegExp(`^\\s*(?:export\\s+)?${escapedName}\\s*=\\s*(.+?)\\s*$`, "m"),
    );
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n", "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("checkpoint must be an object");
  }
  if (!value.files || typeof value.files !== "object" || Array.isArray(value.files)) {
    throw new Error("checkpoint files must be an object");
  }
  return { schemaVersion: STATE_SCHEMA_VERSION, files: value.files };
}

function loadState({ recoverCorrupt = false } = {}) {
  const useLegacy =
    !process.env.APPLIED_LOOP_COLLECT_STATE_PATH &&
    !existsSync(STATE_PATH) &&
    existsSync(LEGACY_STATE_PATH);
  const sourcePath = useLegacy ? LEGACY_STATE_PATH : STATE_PATH;
  if (!existsSync(sourcePath)) {
    return {
      state: { schemaVersion: STATE_SCHEMA_VERSION, files: {} },
      stateHealth: "missing",
      recovery: null,
    };
  }
  try {
    return {
      state: validateState(JSON.parse(readFileSync(sourcePath, "utf8"))),
      stateHealth: "ok",
      recovery: useLegacy ? `migrated legacy checkpoint from ${sourcePath}` : null,
    };
  } catch (error) {
    let recovery = `corrupt checkpoint detected: ${error.message || String(error)}`;
    if (recoverCorrupt && sourcePath === STATE_PATH) {
      const quarantinePath = `${STATE_PATH}.corrupt-${Date.now()}`;
      try {
        renameSync(STATE_PATH, quarantinePath);
        recovery = `quarantined corrupt checkpoint at ${quarantinePath}`;
      } catch (quarantineError) {
        recovery += `; quarantine failed: ${quarantineError.message || String(quarantineError)}`;
      }
    }
    return {
      state: { schemaVersion: STATE_SCHEMA_VERSION, files: {} },
      stateHealth: "corrupt",
      recovery,
    };
  }
}

function saveState(state) {
  atomicWriteJson(STATE_PATH, {
    schemaVersion: STATE_SCHEMA_VERSION,
    files: state.files ?? {},
  });
}

function loadStatus() {
  try {
    if (!existsSync(STATUS_PATH)) return null;
    const value = JSON.parse(readFileSync(STATUS_PATH, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function saveStatus(status) {
  atomicWriteJson(STATUS_PATH, {
    schemaVersion: STATUS_SCHEMA_VERSION,
    ...status,
  });
}

function saveInterruptedStatus(context) {
  const { runMode, lastAttemptAt, previousStatus, loadedState } = context;
  saveStatus({
    runState: "error",
    runMode,
    lastAttemptAt,
    lastCompletedAt: new Date().toISOString(),
    lastSuccessfulSyncAt: previousStatus?.lastSuccessfulSyncAt ?? null,
    lastCheckpointAt: context.lastCheckpointAt ?? previousStatus?.lastCheckpointAt ?? null,
    pendingCount: null,
    pendingCountExact: false,
    unreadableCount: null,
    errorCount: 1,
    consecutiveFailures: (previousStatus?.consecutiveFailures ?? 0) + 1,
    lastError: "collector_interrupted",
    stateRecovery: loadedState.recovery,
  });
}

class CollectorAlreadyRunningError extends Error {
  constructor(pid) {
    super(`collector_already_running${pid ? ` pid=${pid}` : ""}`);
    this.name = "CollectorAlreadyRunningError";
    this.exitCode = 75;
  }
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readProcessStartIdentity(pid) {
  if (!processIsRunning(pid)) return null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen < 0) return null;
      const fieldsFromState = stat.slice(closeParen + 2).trim().split(/\s+/);
      const startTicks = fieldsFromState[19];
      return startTicks ? `linux-proc-start:${startTicks}` : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    });
    const startedAt = result.status === 0 ? result.stdout.trim() : "";
    return startedAt ? `darwin-ps-start:${startedAt}` : null;
  }
  return null;
}

function parseLockOwner(raw) {
  try {
    const value = JSON.parse(raw);
    if (
      !Number.isSafeInteger(value?.pid) ||
      value.pid < 1 ||
      typeof value.processStartIdentity !== "string" ||
      !value.processStartIdentity ||
      typeof value.lockId !== "string" ||
      !value.lockId
    ) {
      return null;
    }
    return {
      pid: value.pid,
      processStartIdentity: value.processStartIdentity,
      lockId: value.lockId,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    };
  } catch {
    return null;
  }
}

function readLockObservation() {
  let descriptor;
  try {
    descriptor = openSync(LOCK_PATH, "r");
    const identity = fstatSync(descriptor);
    const raw = readFileSync(descriptor, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    return {
      identity: { dev: identity.dev, ino: identity.ino, mtimeMs: identity.mtimeMs },
      raw,
      owner: parseLockOwner(raw),
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const LOCK_OWNER_READ_ATTEMPTS = 3;
const LOCK_OWNER_READ_DELAY_MS = 25;
const LOCK_OWNER_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function readLockAfterInitializationWindow() {
  let observation = null;
  for (let attempt = 0; attempt < LOCK_OWNER_READ_ATTEMPTS; attempt += 1) {
    observation = readLockObservation();
    if (!observation || observation.owner !== null) return observation;
    if (attempt + 1 < LOCK_OWNER_READ_ATTEMPTS) {
      Atomics.wait(LOCK_OWNER_WAIT_BUFFER, 0, 0, LOCK_OWNER_READ_DELAY_MS);
    }
  }
  return observation;
}

function lockOwnerIsCurrent(owner) {
  if (!owner || !processIsRunning(owner.pid)) return false;
  const currentStartIdentity = readProcessStartIdentity(owner.pid);
  // If the platform cannot expose a start identity, fail closed while the PID
  // is live. A known mismatch proves PID reuse and makes the old lock stale.
  return (
    currentStartIdentity === null ||
    currentStartIdentity === owner.processStartIdentity
  );
}

function assertRecoverableLegacyLock(observation) {
  if (!observation) return;
  if (observation.owner && lockOwnerIsCurrent(observation.owner)) {
    throw new CollectorAlreadyRunningError(observation.owner.pid);
  }
  if (
    !observation.owner &&
    Date.now() - observation.identity.mtimeMs < UNKNOWN_LOCK_STALE_MS
  ) {
    throw new CollectorAlreadyRunningError(null);
  }
}

function kernelLockInvocation() {
  const holderSource =
    'process.stdout.write("collector-lock-ready\\n");' +
    "process.stdin.resume();";
  if (process.platform === "darwin") {
    return {
      command: "/usr/bin/lockf",
      args: ["-k", "-t", "0", "-w", LOCK_PATH, process.execPath, "-e", holderSource],
    };
  }
  if (process.platform === "linux") {
    return {
      command: "/usr/bin/flock",
      args: ["--nonblock", LOCK_PATH, process.execPath, "-e", holderSource],
    };
  }
  throw new Error(`collector_lock_platform_unsupported:${process.platform}`);
}

function startKernelLockHolder() {
  const invocation = kernelLockInvocation();
  return new Promise((resolveHolder, rejectHolder) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rejectHolder(new Error("collector_lock_holder_start_timeout"));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!settled && stdout.includes("collector-lock-ready\n")) {
        settled = true;
        clearTimeout(timeout);
        resolveHolder(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectHolder(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 75 || code === 1) {
        rejectHolder(new CollectorAlreadyRunningError(readLockObservation()?.owner?.pid ?? null));
      } else {
        rejectHolder(
          new Error(
            `collector_lock_holder_exited code=${String(code)} signal=${String(signal)}` +
              (stderr.trim() ? `: ${stderr.trim()}` : ""),
          ),
        );
      }
    });
  });
}

function writeLockOwner(owner) {
  let descriptor;
  try {
    descriptor = openSync(LOCK_PATH, "r+");
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, JSON.stringify(owner) + "\n", "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function acquireCollectorLock() {
  mkdirSync(dirname(LOCK_PATH), { recursive: true, mode: 0o700 });
  const priorObservation = readLockAfterInitializationWindow();
  assertRecoverableLegacyLock(priorObservation);
  const processStartIdentity = readProcessStartIdentity(process.pid);
  if (!processStartIdentity) {
    throw new Error("collector_lock_start_identity_unavailable");
  }
  const holder = await startKernelLockHolder();
  try {
    // Recheck after the kernel lock is held to stay compatible with an older
    // collector that may have been between exclusive create and owner write.
    const heldObservation = readLockAfterInitializationWindow();
    if (heldObservation?.owner && lockOwnerIsCurrent(heldObservation.owner)) {
      throw new CollectorAlreadyRunningError(heldObservation.owner.pid);
    }
    writeLockOwner({
      pid: process.pid,
      processStartIdentity,
      lockId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    activeLockProcess = holder;
  } catch (error) {
    holder.stdin.end();
    throw error;
  }
}

function releaseCollectorLock() {
  const holder = activeLockProcess;
  activeLockProcess = null;
  if (holder && !holder.stdin.destroyed) holder.stdin.end();
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

class CandidateScanStoppedError extends Error {
  constructor() {
    super("candidate_scan_stopped");
    this.name = "CandidateScanStoppedError";
  }
}

function sortWithHalt(values, compare, shouldHalt) {
  try {
    values.sort((left, right) => {
      if (shouldHalt()) throw new CandidateScanStoppedError();
      return compare(left, right);
    });
    return true;
  } catch (error) {
    if (error instanceof CandidateScanStoppedError) return false;
    throw error;
  }
}

function sortCandidatesForScheduledRun(
  candidates,
  state,
  { shouldHalt = () => Boolean(false), readFingerprint = fileFingerprint } = {},
) {
  const pending = [];
  const unchanged = [];
  let unreadableCount = 0;
  for (const candidate of candidates) {
    if (shouldHalt()) {
      return {
        candidates: [],
        pendingCount: pending.length,
        unreadableCount,
        examinedCount: pending.length + unchanged.length,
        complete: false,
      };
    }
    let mtimeMs = -1;
    let isPending = true;
    let unreadable = false;
    try {
      const fingerprint = readFingerprint(candidate.path);
      mtimeMs = fingerprint.mtimeMs;
      isPending = !sameFileFingerprint(state.files[candidate.path], fingerprint);
    } catch {
      // Unreadable candidates remain pending and are surfaced by collection.
      unreadable = true;
      unreadableCount += 1;
    }
    (isPending ? pending : unchanged).push({ candidate, mtimeMs, unreadable });
  }

  const pendingSorted = sortWithHalt(
    pending,
    (left, right) =>
      left.mtimeMs - right.mtimeMs ||
      compareStrings(left.candidate.path, right.candidate.path) ||
      compareStrings(left.candidate.harness, right.candidate.harness),
    shouldHalt,
  );
  if (!pendingSorted) {
    return {
      candidates: [],
      pendingCount: pending.length,
      unreadableCount,
      examinedCount: candidates.length,
      complete: false,
    };
  }
  const fairPending = [];
  for (let oldest = 0, newest = pending.length - 1; oldest <= newest; oldest += 1, newest -= 1) {
    if (shouldHalt()) {
      return {
        candidates: [],
        pendingCount: pending.length,
        unreadableCount,
        examinedCount: candidates.length,
        complete: false,
      };
    }
    // Every tick gives the oldest pending session the first slot, then alternates
    // with the newest work so neither side of a large backlog is ignored.
    fairPending.push(pending[oldest].candidate);
    if (oldest !== newest) fairPending.push(pending[newest].candidate);
  }
  const unchangedSorted = sortWithHalt(
    unchanged,
    (left, right) =>
      compareStrings(left.candidate.path, right.candidate.path) ||
      compareStrings(left.candidate.harness, right.candidate.harness),
    shouldHalt,
  );
  if (!unchangedSorted) {
    return {
      candidates: [],
      pendingCount: pending.length,
      unreadableCount,
      examinedCount: candidates.length,
      complete: false,
    };
  }
  for (const entry of unchanged) {
    if (shouldHalt()) {
      return {
        candidates: [],
        pendingCount: pending.length,
        unreadableCount,
        examinedCount: candidates.length,
        complete: false,
      };
    }
    fairPending.push(entry.candidate);
  }
  return {
    candidates: fairPending,
    pendingCount: pending.length,
    unreadableCount,
    examinedCount: candidates.length,
    complete: true,
  };
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
      const cacheCreationInputTokens = Number(u.cache_creation_input_tokens) || 0;
      meta.usage = {
        input_tokens: Number(u.input_tokens) || 0,
        output_tokens: Number(u.output_tokens) || 0,
        cache_read_input_tokens: Number(u.cache_read_input_tokens) || 0,
        cache_creation_input_tokens: cacheCreationInputTokens,
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

function walkJsonl(root, { skipSubagents = false, shouldHalt = () => false } = {}) {
  const out = [];
  let complete = true;
  if (shouldHalt()) return { paths: out, complete: false };
  if (!existsSync(root)) return { paths: out, complete };

  function walk(dir) {
    if (shouldHalt()) {
      complete = false;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      complete = false;
      return;
    }
    for (const ent of entries) {
      if (shouldHalt()) {
        complete = false;
        return;
      }
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
  return { paths: out, complete };
}

function listClaudeSessions({ shouldHalt = () => false } = {}) {
  const files = [];
  let complete = true;
  if (shouldHalt()) return { candidates: files, complete: false };
  if (!existsSync(CLAUDE_PROJECTS)) return { candidates: files, complete };
  let projects;
  try {
    projects = readdirSync(CLAUDE_PROJECTS, { withFileTypes: true });
  } catch {
    return { candidates: files, complete: false };
  }
  for (const proj of projects) {
    if (shouldHalt()) {
      complete = false;
      break;
    }
    if (!proj.isDirectory()) continue;
    const projDir = join(CLAUDE_PROJECTS, proj.name);
    const decoded = decodeClaudeProjectDir(proj.name);
    const fallbackRepo = repoFromPath(decoded);
    // トップレベル jsonl のみ (subagents は親セッションに含まれるため除外)
    let entries;
    try {
      entries = readdirSync(projDir, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const ent of entries) {
      if (shouldHalt()) {
        complete = false;
        break;
      }
      if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        files.push({ path: join(projDir, ent.name), fallbackRepo, harness: "claude" });
      }
    }
  }
  return { candidates: files, complete };
}

function listCodexSessions({ shouldHalt = () => false } = {}) {
  const walked = walkJsonl(CODEX_SESSIONS, { shouldHalt });
  const candidates = [];
  for (const path of walked.paths) {
    if (shouldHalt()) return { candidates, complete: false };
    candidates.push({
      path,
      fallbackRepo: null,
      harness: "codex",
    });
  }
  return {
    candidates,
    complete: walked.complete,
  };
}

function discoverCandidates({ shouldHalt = () => false } = {}) {
  const claude = listClaudeSessions({ shouldHalt });
  const codex = listCodexSessions({ shouldHalt });
  const candidates = [];
  for (const candidate of claude.candidates) {
    if (shouldHalt()) return { candidates, complete: false };
    candidates.push(candidate);
  }
  for (const candidate of codex.candidates) {
    if (shouldHalt()) return { candidates, complete: false };
    candidates.push(candidate);
  }
  return {
    candidates,
    complete: claude.complete && codex.complete,
  };
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

class CollectorSendError extends Error {
  constructor(message, { retryable, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CollectorSendError";
    this.retryable = retryable === true;
  }
}

class CollectorRunStoppedError extends Error {
  constructor(reason) {
    super(`collector_${reason}`);
    this.name = "CollectorRunStoppedError";
    this.reason = reason;
  }
}

async function waitForRetry(delayMs, { shouldStop, shouldDefer }) {
  const finishAt = Date.now() + delayMs;
  while (Date.now() < finishAt) {
    if (shouldStop()) throw new CollectorRunStoppedError("interrupted");
    if (shouldDefer()) throw new CollectorRunStoppedError("budget_deferred");
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, Math.min(25, Math.max(1, finishAt - Date.now()))),
    );
  }
}

async function postRunOnce(
  payload,
  {
    dryRun,
    onAttempt = () => {},
    shouldStop = () => false,
    shouldDefer = () => false,
  },
) {
  if (shouldStop()) throw new CollectorRunStoppedError("interrupted");
  if (shouldDefer()) throw new CollectorRunStoppedError("budget_deferred");
  assertNoConversationBody(payload);
  if (dryRun) {
    onAttempt();
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

  let res;
  // Keep this check immediately adjacent to fetch: a parse or payload build that
  // consumes the remaining budget must not open a new HTTP request.
  if (shouldStop()) throw new CollectorRunStoppedError("interrupted");
  if (shouldDefer()) throw new CollectorRunStoppedError("budget_deferred");
  onAttempt();
  try {
    res = await fetch(`${BASE_URL}/api/harness-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CollectorSendError(`POST network failure: ${error.message || String(error)}`, {
      retryable: true,
      cause: error,
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CollectorSendError(`POST failed ${res.status}: ${body.slice(0, 200)}`, {
      retryable: res.status === 408 || res.status === 429 || res.status >= 500,
    });
  }
  return res.json();
}

async function postRunWithRetry(
  payload,
  {
    dryRun,
    maxAttempts,
    onAttempt,
    shouldStop,
    shouldDefer,
    postOnce = postRunOnce,
  },
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (shouldStop()) throw new CollectorRunStoppedError("interrupted");
    if (shouldDefer()) throw new CollectorRunStoppedError("budget_deferred");
    try {
      return await postOnce(payload, { dryRun, onAttempt, shouldStop, shouldDefer });
    } catch (error) {
      lastError = error;
      if (shouldStop()) throw new CollectorRunStoppedError("interrupted");
      if (shouldDefer()) throw new CollectorRunStoppedError("budget_deferred");
      if (!error.retryable || attempt >= maxAttempts) throw error;
      const delayMs = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        RETRY_MAX_DELAY_MS,
      );
      console.error(
        `[harness-collect] retry attempt=${attempt + 1}/${maxAttempts}` +
          ` delayMs=${delayMs} reason=${error.message || String(error)}`,
      );
      await waitForRetry(delayMs, { shouldStop, shouldDefer });
    }
  }
  throw lastError;
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
  {
    dryRun,
    maxSends,
    preparedByPath = null,
    shouldStop = () => false,
    shouldDefer = () => false,
    readFingerprint = fileFingerprint,
    parseItem = parseCandidate,
    postPayload = postRunWithRetry,
    checkpointState = saveState,
    nowIso = () => new Date().toISOString(),
  },
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
    deferredForBudget: false,
    lastCheckpointAt: null,
    lastError: null,
  };

  if (shouldStop()) {
    result.interrupted = true;
    return result;
  }
  if (shouldDefer()) {
    result.deferredForBudget = true;
    return result;
  }

  for (const item of items) {
    if (shouldStop()) {
      result.interrupted = true;
      break;
    }
    if (shouldDefer()) {
      result.deferredForBudget = true;
      break;
    }

    let fp;
    try {
      fp = readFingerprint(item.path);
    } catch (error) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      result.errors += 1;
      result.lastError = `stat error ${item.path}: ${error.message || String(error)}`;
      console.error(`[harness-collect] stat error ${item.path}:`, error.message || error);
      continue;
    }

    if (shouldStop()) {
      result.interrupted = true;
      break;
    }
    if (shouldDefer()) {
      result.deferredForBudget = true;
      break;
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
      if (!parsed) parsed = parseItem(item);
    } catch (error) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      result.errors += 1;
      result.lastError = `parse error ${item.path}: ${error.message || String(error)}`;
      console.error(`[harness-collect] parse error ${item.path}:`, error.message || error);
      continue;
    }

    if (shouldStop()) {
      result.interrupted = true;
      break;
    }
    if (shouldDefer()) {
      result.deferredForBudget = true;
      break;
    }

    if (!parsed) {
      if (preparedByPath) {
        result.staleSnapshot += 1;
        result.stalePaths.push(item.path);
        break;
      }
      if (!dryRun) {
        state.files[item.path] = { ...fp, skipped: true };
        checkpointState(state);
      }
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

      const remainingAttempts =
        maxSends === null
          ? RETRY_MAX_ATTEMPTS
          : Math.min(RETRY_MAX_ATTEMPTS, maxSends - result.attempts);
      if (remainingAttempts < 1) {
        result.stoppedAtLimit = true;
        break;
      }
      // attempts includes retries and dry-run simulations, preserving --max-sends as
      // a hard HTTP-attempt cap for bounded validation runs.
      await postPayload(payload, {
        dryRun,
        maxAttempts: remainingAttempts,
        shouldStop,
        shouldDefer,
        onAttempt: () => {
          result.attempts += 1;
        },
      });
      result.sent += 1;
      if (!dryRun) {
        state.files[item.path] = {
          ...fp,
          harness: parsed.harness,
          sessionId: parsed.sessionId,
          contextFingerprint: payload.contextFingerprint,
        };
        checkpointState(state);
        result.lastCheckpointAt = nowIso();
        if (result.sent % 50 === 0) {
          console.log(`[harness-collect] progress sent=${result.sent}`);
        }
      }
    } catch (error) {
      if (error instanceof CollectorRunStoppedError) {
        if (error.reason === "interrupted") result.interrupted = true;
        else result.deferredForBudget = true;
        break;
      }
      result.errors += 1;
      result.lastError = `send error ${item.path}: ${error.message || String(error)}`;
      console.error(`[harness-collect] error ${item.path}:`, error.message || error);
      // A down or rejecting endpoint is run-scoped. Stop after bounded retries so
      // thousands of pending sessions do not turn one 15-minute tick into a storm.
      break;
    }
  }

  return result;
}

function countPendingCandidates(
  candidates,
  state,
  { shouldHalt = () => Boolean(false), readFingerprint = fileFingerprint } = {},
) {
  let pendingCount = 0;
  let unreadableCount = 0;
  let examinedCount = 0;
  for (const item of candidates) {
    if (shouldHalt()) {
      return { pendingCount, unreadableCount, examinedCount, complete: false };
    }
    try {
      const fingerprint = readFingerprint(item.path);
      if (!sameFileFingerprint(state.files[item.path], fingerprint)) pendingCount += 1;
    } catch {
      pendingCount += 1;
      unreadableCount += 1;
    }
    examinedCount += 1;
  }
  return { pendingCount, unreadableCount, examinedCount, complete: true };
}

function resolvePendingStatus({ pendingAfter, hasError, deferredForBudget }) {
  const pendingCount = pendingAfter.complete ? pendingAfter.pendingCount : null;
  return {
    runState:
      hasError
        ? "error"
        : deferredForBudget || !pendingAfter.complete || pendingCount > 0
          ? "pending"
          : "synced",
    pendingCount,
    pendingCountExact: pendingAfter.complete,
    unreadableCount: pendingAfter.complete ? pendingAfter.unreadableCount : null,
  };
}

function collectorRunMode(options) {
  if (options.applySnapshotPath) return "snapshot";
  if (options.maxSends !== null) return "bounded";
  return process.env.APPLIED_LOOP_COLLECT_RUN_MODE || "standard";
}

function buildDiagnosticReport() {
  const loaded = loadState();
  const discovery = discoverCandidates();
  const candidates = sortCandidates(discovery.candidates);
  const pending = countPendingCandidates(candidates, loaded.state);
  const scanComplete = discovery.complete && pending.complete;
  const status = loadStatus();
  return {
    runState:
      loaded.stateHealth === "corrupt"
        ? "error"
        : !scanComplete
          ? "pending"
          : status?.runState || (pending.pendingCount > 0 ? "never-synced" : "synced"),
    stateHealth: loaded.stateHealth,
    pendingCount: scanComplete ? pending.pendingCount : null,
    pendingCountExact: scanComplete,
    unreadableCount: scanComplete ? pending.unreadableCount : null,
    candidateCount: candidates.length,
    lastAttemptAt: status?.lastAttemptAt ?? null,
    lastCompletedAt: status?.lastCompletedAt ?? null,
    lastSuccessfulSyncAt: status?.lastSuccessfulSyncAt ?? null,
    lastCheckpointAt: status?.lastCheckpointAt ?? null,
    consecutiveFailures: status?.consecutiveFailures ?? 0,
    lastError: status?.lastError ?? (loaded.stateHealth === "corrupt" ? loaded.recovery : null),
    stateRecovery: status?.stateRecovery ?? loaded.recovery,
    statePath: STATE_PATH,
    statusPath: STATUS_PATH,
  };
}

function printDiagnostic(report, { json }) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("Applied Loop harness collector");
  console.log(`  state: ${report.runState} (checkpoint: ${report.stateHealth})`);
  console.log(
    `  pending sessions: ${report.pendingCount ?? "unknown"}` +
      (report.pendingCountExact === false ? " (scan incomplete)" : ""),
  );
  console.log(`  last successful sync: ${report.lastSuccessfulSyncAt ?? "never"}`);
  console.log(`  last checkpoint: ${report.lastCheckpointAt ?? "never"}`);
  console.log(`  last attempt: ${report.lastAttemptAt ?? "never"}`);
  if (report.lastError) console.log(`  last error: ${report.lastError}`);
  if (report.stateRecovery) console.log(`  recovery: ${report.stateRecovery}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.status) {
    printDiagnostic(buildDiagnosticReport(), options);
    return;
  }
  const runMode = collectorRunMode(options);
  let interrupted = false;
  const onInterrupt = () => {
    if (!interrupted) {
      interrupted = true;
      process.exitCode = 130;
      console.error("[harness-collect] interrupt requested; stopping before the next request");
      if (activeStatusContext) {
        try {
          saveInterruptedStatus(activeStatusContext);
        } catch (error) {
          console.error("[harness-collect] failed to persist interrupted status:", error);
        }
      }
    }
  };
  const onSigint = () => onInterrupt();
  const onSigterm = () => onInterrupt();
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  let mainCompleted = false;
  try {
    if (!options.dryRun) await acquireCollectorLock();

  const loadedState = loadState({ recoverCorrupt: !options.dryRun });
  const state = loadedState.state;
  state.files ??= {};
  const scheduledCollection =
    runMode === "scheduled" &&
    !options.dryRun &&
    !options.snapshotOutPath &&
    !options.applySnapshotPath;
  // Start the scheduled budget before filesystem discovery. Parsing and retry
  // receive the same deadline below, so the 12-minute cap covers the whole scan.
  const scheduledDeadline = scheduledCollection
    ? Date.now() + SCHEDULED_RUN_BUDGET_MS
    : null;
  const shouldStop = () => interrupted;
  const shouldDefer = () =>
    scheduledDeadline !== null && Date.now() >= scheduledDeadline;
  const shouldHaltScan = () => shouldStop() || shouldDefer();
  const discovery = discoverCandidates({ shouldHalt: shouldHaltScan });
  if (options.snapshotOutPath && !discovery.complete) {
    throw new Error("snapshot_not_created: candidate scan incomplete");
  }
  const scheduledCandidates = scheduledCollection
    ? sortCandidatesForScheduledRun(discovery.candidates, state, {
        shouldHalt: shouldHaltScan,
      })
    : null;
  const candidates = scheduledCandidates
    ? scheduledCandidates.candidates
    : sortCandidates(discovery.candidates);

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
    mainCompleted = true;
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
  const trackOperationalStatus = !options.dryRun && !snapshot;
  const previousStatus = loadStatus();
  const attemptStartedAt = new Date().toISOString();
  const pendingBefore = scheduledCandidates
    ? {
        pendingCount: scheduledCandidates.pendingCount,
        unreadableCount: scheduledCandidates.unreadableCount,
        complete: discovery.complete && scheduledCandidates.complete,
      }
    : countPendingCandidates(candidates, state);
  if (trackOperationalStatus) {
    activeStatusContext = {
      runMode,
      lastAttemptAt: attemptStartedAt,
      previousStatus,
      loadedState,
    };
    saveStatus({
      runState: "running",
      runMode,
      lastAttemptAt: attemptStartedAt,
      lastCompletedAt: previousStatus?.lastCompletedAt ?? null,
      lastSuccessfulSyncAt: previousStatus?.lastSuccessfulSyncAt ?? null,
      lastCheckpointAt: previousStatus?.lastCheckpointAt ?? null,
      pendingCount: pendingBefore.complete ? pendingBefore.pendingCount : null,
      pendingCountExact: pendingBefore.complete,
      unreadableCount: pendingBefore.complete ? pendingBefore.unreadableCount : null,
      errorCount: 0,
      consecutiveFailures: previousStatus?.consecutiveFailures ?? 0,
      lastError: null,
      stateRecovery: loadedState.recovery,
    });
  }
  console.log(
    `[harness-collect] candidates=${items.length} url=${BASE_URL}` +
      ` dryRun=${options.dryRun} maxSends=${maxSends ?? "unlimited"}` +
      ` snapshot=${snapshot ? options.applySnapshotPath : "none"}` +
      ` mode=${runMode}`,
  );

  let result;
  try {
    result = await collectItems(items, state, {
      dryRun: options.dryRun,
      maxSends,
      preparedByPath,
      shouldStop,
      shouldDefer,
    });
  } finally {
    // Dry-run must remain read-only. Successful sends and deliberate parse skips are
    // checkpointed immediately; this final atomic save covers empty/failed runs too.
    if (!options.dryRun) saveState(state);
  }
  if (activeStatusContext) {
    activeStatusContext.lastCheckpointAt =
      result.lastCheckpointAt ?? previousStatus?.lastCheckpointAt ?? null;
  }

  const pendingAfterScan = countPendingCandidates(candidates, state, {
    shouldHalt: scheduledCollection ? shouldHaltScan : () => false,
  });
  // Synchronous filesystem calls cannot dispatch JS signal callbacks mid-call.
  // Yield once while handlers are still installed so a signal received during
  // the final scan is observed before status can be declared fully synced.
  await new Promise((resolveYield) => setImmediate(resolveYield));
  const pendingAfterComplete =
    discovery.complete &&
    (scheduledCandidates?.complete ?? true) &&
    pendingAfterScan.complete &&
    !interrupted;
  const deferredForBudget =
    result.deferredForBudget ||
    (scheduledCollection && !pendingAfterComplete && shouldDefer());
  const finalInterrupted = result.interrupted || interrupted;
  if (trackOperationalStatus) {
    const hasError = result.errors > 0 || result.staleSnapshot > 0 || finalInterrupted;
    const pendingStatus = resolvePendingStatus({
      pendingAfter: { ...pendingAfterScan, complete: pendingAfterComplete },
      hasError,
      deferredForBudget,
    });
    const completeUnboundedSync =
      !hasError &&
      !deferredForBudget &&
      pendingAfterComplete &&
      maxSends === null &&
      pendingStatus.pendingCount === 0;
    saveStatus({
      runState: pendingStatus.runState,
      runMode,
      lastAttemptAt: attemptStartedAt,
      lastCompletedAt: new Date().toISOString(),
      lastSuccessfulSyncAt: completeUnboundedSync
        ? new Date().toISOString()
        : previousStatus?.lastSuccessfulSyncAt ?? null,
      lastCheckpointAt: result.lastCheckpointAt ?? previousStatus?.lastCheckpointAt ?? null,
      pendingCount: pendingStatus.pendingCount,
      pendingCountExact: pendingStatus.pendingCountExact,
      unreadableCount: pendingStatus.unreadableCount,
      errorCount: result.errors + result.staleSnapshot + (finalInterrupted ? 1 : 0),
      consecutiveFailures: hasError
        ? (previousStatus?.consecutiveFailures ?? 0) + 1
        : 0,
      lastError: result.lastError ?? (finalInterrupted ? "collector_interrupted" : null),
      stateRecovery: loadedState.recovery,
    });
  }

  console.log(
    `[harness-collect] done sent=${result.sent}` +
      ` attempts=${result.attempts}` +
      ` skippedUnchanged=${result.skippedUnchanged}` +
      ` unparseable=${result.unparseable}` +
      ` errors=${result.errors}` +
      ` staleSnapshot=${result.staleSnapshot}` +
      ` stoppedAtLimit=${result.stoppedAtLimit}` +
      ` deferredForBudget=${deferredForBudget}` +
      ` interrupted=${finalInterrupted}`,
  );
  if (result.staleSnapshot) {
    throw new SnapshotStaleError(
      result.stalePaths.map((path) => ({ path, reason: "changed_during_send" })),
    );
  }
  if (finalInterrupted) process.exitCode = 130;
  else if (result.errors) process.exitCode = 1;
  mainCompleted = true;
  } finally {
    releaseCollectorLock();
    // Keep handlers through lock release and give any kernel-delivered signal
    // one event-loop turn to persist an interrupted, non-exact status.
    await new Promise((resolveYield) => setImmediate(resolveYield));
    if (interrupted && activeStatusContext) {
      try {
        saveInterruptedStatus(activeStatusContext);
      } catch (error) {
        console.error("[harness-collect] failed to persist interrupted status:", error);
      }
    }
    if (mainCompleted) activeStatusContext = null;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

export {
  COLLECTOR_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  collectItems,
  countPendingCandidates,
  createSnapshotDocument,
  parseArgs,
  postRunWithRetry,
  resolvePendingStatus,
  sameFileFingerprint,
  sortCandidates,
  sortCandidatesForScheduledRun,
  validateSnapshotDocument,
};

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedScript === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    releaseCollectorLock();
    if (activeStatusContext) {
      const { runMode, lastAttemptAt, previousStatus, loadedState } = activeStatusContext;
      try {
        saveStatus({
          runState: "error",
          runMode,
          lastAttemptAt,
          lastCompletedAt: new Date().toISOString(),
          lastSuccessfulSyncAt: previousStatus?.lastSuccessfulSyncAt ?? null,
          lastCheckpointAt: previousStatus?.lastCheckpointAt ?? null,
          pendingCount: previousStatus?.pendingCount ?? null,
          pendingCountExact: false,
          unreadableCount: previousStatus?.unreadableCount ?? null,
          errorCount: 1,
          consecutiveFailures: (previousStatus?.consecutiveFailures ?? 0) + 1,
          lastError: error.message || String(error),
          stateRecovery: loadedState.recovery,
        });
      } catch (statusError) {
        console.error("[harness-collect] failed to persist fatal status:", statusError);
      }
    }
    console.error(error);
    process.exitCode = error?.exitCode ?? 1;
  });
}
