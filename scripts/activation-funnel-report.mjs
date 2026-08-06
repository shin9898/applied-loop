#!/usr/bin/env node
/**
 * Activation ファネル集計（B9-1 / G8）。
 * 正本7点の欠測を明示する。
 * Usage: npm run funnel:report
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Fable B9-1 正本7点 */
const STEPS = [
  "setup_opened",
  "sample_submitted",
  "mcp_touched",
  "first_supply",
  "first_answer",
  "first_verdict",
  "zukan_viewed",
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

console.log(`# Activation funnel (正本7点)`);
console.log(`path: ${path}`);
console.log("");

const missing = [];
for (const step of STEPS) {
  const hits = events.filter((e) => e.step === step);
  const first = hits[0]?.at ?? "-";
  console.log(
    `${step.padEnd(18)} count=${hits.length}  first=${first}`,
  );
  if (hits.length === 0) missing.push(step);
}

const setup = events.find((e) => e.step === "setup_opened")?.at;
const zukan = events.find((e) => e.step === "zukan_viewed")?.at;
const complete = events.find((e) => e.step === "first_complete")?.at;
const end = zukan ?? complete;
if (setup && end) {
  const mins = Math.round(
    (Date.parse(end) - Date.parse(setup)) / 60000,
  );
  console.log("");
  console.log(`elapsed_minutes (setup→zukan/complete): ${mins}`);
}

console.log("");
if (missing.length === 0) {
  console.log("欠測: なし（正本7点すべて記録あり）");
  console.log("合否: PASS（ファネル欠測ゼロ）");
} else {
  console.log(`欠測: ${missing.join(", ")}`);
  console.log("合否: FAIL（欠測あり — B10-3 クローズ不可）");
  process.exitCode = 1;
}
