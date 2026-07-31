#!/usr/bin/env node
// 週次ダイジェスト: 開発ログと ADR を koki-central へ投影する。
// 正典はこのリポジトリ。koki-central 側は read-only 投影（二重正典にしない）。
// 使い方: node scripts/weekly-digest.mjs [--dry-run]

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const MY_COPY_ROOT =
  process.env.MY_COPY_SOURCE_ROOT ?? `${process.env.HOME}/tools/workbench/my-copy`;
const DRY_RUN = process.argv.includes("--dry-run");

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function gitLog() {
  try {
    return execFileSync(
      "git",
      ["log", "--since=7 days ago", "--pretty=format:- %ad %s", "--date=short"],
      { cwd: REPO_ROOT, encoding: "utf8" }
    ).trim();
  } catch {
    return "(コミットなし)";
  }
}

function recentAdrs() {
  const adrDir = join(REPO_ROOT, "docs", "adr");
  let files;
  try {
    files = readdirSync(adrDir).filter((f) => /^\d{4}-.+\.md$/.test(f));
  } catch {
    return [];
  }
  const results = [];
  for (const file of files) {
    try {
      const created = execFileSync(
        "git",
        ["log", "--diff-filter=A", "--follow", "--pretty=format:%ad", "--date=short", "--", `docs/adr/${file}`],
        { cwd: REPO_ROOT, encoding: "utf8" }
      ).trim();
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      if (created && created >= since) {
        const body = readFileSync(join(adrDir, file), "utf8");
        const title = body.match(/^# (.+)$/m)?.[1] ?? file;
        results.push({ file, title, created });
      }
    } catch {
      // git 履歴が無い新規ファイルは対象外
    }
  }
  return results;
}

const week = isoWeek(new Date());
const log = gitLog();
const adrs = recentAdrs();

const adrSection = adrs.length
  ? adrs.map((a) => `- [[${a.file.replace(/\.md$/, "")}|${a.title}]] (${a.created})`).join("\n")
  : "- なし";

const content = [
  `applied-loop の週次開発ダイジェスト (${week})。`,
  ``,
  `## コミット (直近7日)`,
  log || "- なし",
  ``,
  `## 新規 ADR`,
  adrSection,
  ``,
  `## 補足`,
  `- 正典: https://github.com/shin9898/applied-loop (ローカル: ~/tools/applied-loop)`,
  `- このノートは scripts/weekly-digest.mjs による自動投影。手編集しない。`,
].join("\n");

const payload = JSON.stringify({
  kind: "knowledge",
  title: `applied-loop 週次ダイジェスト ${week}`,
  content,
  source_agent: "cursor",
  project: "applied-loop",
  source_repo: REPO_ROOT,
  source_refs: ["scripts/weekly-digest.mjs"],
  evidence: "source-verified",
  sensitivity: "internal",
  idempotency_key: `applied-loop-weekly-digest-${week}`,
});

if (DRY_RUN) {
  console.log(content);
  console.log("\n---\npayload:", payload);
  process.exit(0);
}

const out = execFileSync(
  "uv",
  ["run", "--project", MY_COPY_ROOT, "python", "-m", "scripts.obsidian_capture", "--stdin", "--json"],
  { input: payload, encoding: "utf8" }
);
console.log(out.trim());
