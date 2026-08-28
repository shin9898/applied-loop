#!/usr/bin/env node
/**
 * Render/install/inspect the per-user launchd job for metadata-only collection.
 * Installation is explicit: importing this module and `render` never call launchctl.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const LABEL = "com.applied-loop.harness-collect";
const TEMPLATE_PATH = join(SCRIPT_DIR, `${LABEL}.plist`);
const DATA_DIR = join(homedir(), ".applied-loop", "harness-collector");
const AGENT_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderPlist() {
  return readFileSync(TEMPLATE_PATH, "utf8")
    .replaceAll("__APPLIED_LOOP_ROOT__", escapeXml(ROOT))
    .replaceAll("__APPLIED_LOOP_DATA_DIR__", escapeXml(DATA_DIR))
    .replaceAll("__APPLIED_LOOP_NODE_PATH__", escapeXml(process.execPath));
}

function atomicWrite(path, contents, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode });
    renameSync(temporary, path);
    chmodSync(path, mode);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function launchctl(args, { allowFailure = false, inherit = false } = {}) {
  const result = spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `launchctl ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function requireMacOs() {
  if (process.platform !== "darwin") {
    throw new Error("the harness collector LaunchAgent is supported only on macOS");
  }
}

function install() {
  requireMacOs();
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(AGENT_PATH), { recursive: true });
  const domain = `gui/${process.getuid()}`;
  launchctl(["bootout", domain, AGENT_PATH], { allowFailure: true });
  atomicWrite(AGENT_PATH, renderPlist(), 0o644);
  launchctl(["bootstrap", domain, AGENT_PATH]);
  console.log(`installed ${LABEL}`);
  console.log("initial catch-up started by RunAtLoad");
  console.log(`plist: ${AGENT_PATH}`);
  console.log(`diagnostic: npm run harness:collector:status`);
}

function uninstall() {
  requireMacOs();
  const domain = `gui/${process.getuid()}`;
  launchctl(["bootout", domain, AGENT_PATH], { allowFailure: true });
  if (existsSync(AGENT_PATH)) unlinkSync(AGENT_PATH);
  console.log(`uninstalled ${LABEL}; checkpoint and logs remain in ${DATA_DIR}`);
}

function status() {
  const collector = spawnSync(process.execPath, [join(SCRIPT_DIR, "collect-harness.mjs"), "--status"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(collector.stdout || "");
  process.stderr.write(collector.stderr || "");
  if (process.platform !== "darwin") return collector.status ?? 1;

  const domain = `gui/${process.getuid()}`;
  const service = launchctl(["print", `${domain}/${LABEL}`], { allowFailure: true });
  console.log(`  launchd: ${service.status === 0 ? "loaded" : "not loaded"}`);
  console.log(`  plist: ${existsSync(AGENT_PATH) ? AGENT_PATH : "not installed"}`);
  return collector.status ?? 1;
}

function usage() {
  return [
    "Usage: node scripts/manage-harness-collector.mjs <command>",
    "",
    "Commands:",
    "  render     print the resolved plist without changing the system",
    "  install    install/reload the per-user LaunchAgent and run catch-up",
    "  status     show checkpoint/pending state and LaunchAgent registration",
    "  uninstall  unload the LaunchAgent; keep checkpoint and logs",
  ].join("\n");
}

function main(command = process.argv[2]) {
  if (command === "render") {
    process.stdout.write(renderPlist());
    return;
  }
  if (command === "install") return install();
  if (command === "uninstall") return uninstall();
  if (command === "status") {
    process.exitCode = status();
    return;
  }
  console.log(usage());
  if (command && command !== "help" && command !== "--help" && command !== "-h") {
    process.exitCode = 64;
  }
}

main();
