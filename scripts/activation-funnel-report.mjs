#!/usr/bin/env node
/**
 * Activation ファネル集計（B9-1）。
 * Usage: node scripts/activation-funnel-report.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STEPS = [
  "setup_opened",
  "sample_started",
  "sample_submitted",
  "mcp_touched",
  "first_verdict",
  "hook_installed",
  "first_complete",
];

const path = join(homedir(), ".applied-loop", "activation-events.jsonl");
if (!existsSync(path)) {
  console.log(`no events at ${path}`);
  process.exit(0);
}

const events = readFileSync(path, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

console.log(`# Activation funnel (${events.length} events)`);
console.log(`path: ${path}`);
console.log("");

let setupAt = null;
let completeAt = null;
for (const step of STEPS) {
  const hits = events.filter((e) => e.step === step);
  const first = hits[0]?.at ?? null;
  if (step === "setup_opened" && first) setupAt = first;
  if (step === "first_complete" && first) completeAt = first;
  console.log(
    `${step.padEnd(18)} count=${hits.length}  first=${first ?? "-"}`,
  );
}

console.log("");
if (setupAt && completeAt) {
  const mins = Math.round(
    (Date.parse(completeAt) - Date.parse(setupAt)) / 60000,
  );
  console.log(`first_complete_minutes: ${mins}`);
  console.log(`completed: yes`);
} else {
  console.log(`first_complete_minutes: -`);
  console.log(`completed: ${completeAt ? "yes" : "no"}`);
}
