#!/usr/bin/env node
/**
 * pending Gate の出題を「転用可能な一般原則」ベースに書き直す。
 *
 * 使い方:
 *   node scripts/rewrite-gates.mjs              # 全 pending を更新
 *   node scripts/rewrite-gates.mjs --dry-run 3  # 先頭 3 件だけ LLM 呼び出し、DB は更新せずプレビュー
 *
 * DATABASE_URL 未設定時は file:./dev.db (リポジトリルート相対)
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { register } from "tsx/esm/api";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

loadDotEnv(resolve(REPO_ROOT, ".env"));

// TypeScript の headless-llm を再利用するため tsx ローダーを登録
const unregister = register();
const { runHeadlessLLM, parseLLMJson } = await import(
  resolve(REPO_ROOT, "src/lib/headless-llm.ts")
);
unregister();

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const dryRunIdx = process.argv.indexOf("--dry-run");
const DRY_RUN =
  dryRunIdx !== -1
    ? Math.max(1, parseInt(process.argv[dryRunIdx + 1] ?? "1", 10) || 1)
    : null;

function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  if (!url.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL: ${url}`);
  }
  const raw = url.slice("file:".length);
  return resolve(REPO_ROOT, raw);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeRubric(raw) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .filter((x) => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, 3);
  return items.length > 0 ? items : null;
}

const RESOURCE_KINDS = new Set(["doc", "file", "commit", "adr"]);

function normalizeResources(raw) {
  if (!Array.isArray(raw)) return null;
  const items = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = typeof item.kind === "string" ? item.kind.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    if (!RESOURCE_KINDS.has(kind) || !label || !ref) continue;
    items.push({ kind, label, ref });
  }
  return items.length > 0 ? items : null;
}

function buildRewritePrompt(gate) {
  const input = {
    question: gate.question,
    contextSummary: gate.contextSummary,
    domain: gate.domain,
    targetConcept: gate.targetConcept,
    resources: safeParseJson(gate.resources),
    rubricCriteria: safeParseJson(gate.rubricCriteria),
  };

  return [
    "以下は既存の理解度ゲート出題である。品質が低く、事例固有の暗記クイズになっている可能性がある。",
    "この出題から転用可能な一般原則を抽出し、その原則を問う問題に書き直せ。",
    "",
    "【原則抽出】",
    "他の状況・プロジェクトでも使える一般原則を1つ。関数名・リポジトリ名・列名に依存しない粒度。",
    "",
    "【出題の型】次のいずれか1つ:",
    "  diagnosis (診断): 症状が出た時の切り分け手順を説明させる",
    "  transfer (転用): 原則を別の状況に適用するとどうなるか問う",
    "  judgment (判断): 設計判断の理由と代替案とのトレードオフを説明させる",
    "  prevention (予防): 同じ失敗を未然に防ぐ仕組み化を問う",
    "",
    "【禁止】穴埋め形式 (_____ 等)。「この時の Lesson は?」形式。事例固有情報が主役の問題。",
    "問題文は原則が主役。固有情報は必要最小限の文脈ヒントに留める。",
    "rubric は合否を分ける概念の本質の観点を最大3つ。",
    "resources は回答時に参照できる一次情報。kind は doc / file / commit / adr。元の resources を改善してよい。",
    "日本語で。JSON のみで出力:",
    '{"principle":"...","question":"...","type":"diagnosis|transfer|judgment|prevention","rubric":["..."],"resources":[{"kind":"...","label":"...","ref":"..."}]}',
    "",
    "<current_gate>",
    JSON.stringify(input, null, 2),
    "</current_gate>",
  ].join("\n");
}

function safeParseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    console.error(`データベースが見つかりません: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  const gates = db
    .prepare(
      `SELECT id, question, contextSummary, domain, targetConcept, resources, rubricCriteria
       FROM Gate WHERE status = 'pending' ORDER BY createdAt ASC`
    )
    .all();

  const targets = DRY_RUN != null ? gates.slice(0, DRY_RUN) : gates;
  console.log(
    `pending=${gates.length} 件, 処理対象=${targets.length} 件` +
      (DRY_RUN != null ? ` (dry-run ${DRY_RUN})` : "") +
      ` db=${dbPath}`
  );

  if (targets.length === 0) {
    db.close();
    return;
  }

  const update = db.prepare(
    `UPDATE Gate
     SET question = @question,
         targetConcept = @targetConcept,
         rubricCriteria = @rubricCriteria,
         resources = @resources
     WHERE id = @id`
  );

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < targets.length; i++) {
    const gate = targets[i];
    console.log(`[${i + 1}/${targets.length}] gateId=${gate.id}`);

    try {
      const raw = await runHeadlessLLM(buildRewritePrompt(gate));
      const parsed = parseLLMJson(raw);
      if (!parsed?.question || !parsed?.principle) {
        throw new Error(
          `parse failed: question/principle missing. raw=${String(raw).slice(0, 200)}`
        );
      }

      const principle = String(parsed.principle).trim();
      const question = String(parsed.question).trim();
      const type = typeof parsed.type === "string" ? parsed.type.trim() : "?";
      const rubric = normalizeRubric(parsed.rubric);
      const resources = normalizeResources(parsed.resources);

      if (DRY_RUN != null) {
        console.log("--- BEFORE ---");
        console.log(`question: ${gate.question}`);
        console.log(`targetConcept: ${gate.targetConcept ?? "(null)"}`);
        console.log("--- AFTER ---");
        console.log(`principle: ${principle}`);
        console.log(`question: ${question}`);
        console.log(`type: ${type}`);
        console.log(`rubric: ${JSON.stringify(rubric)}`);
        console.log(`resources: ${JSON.stringify(resources)}`);
        console.log("");
      } else {
        update.run({
          id: gate.id,
          question,
          targetConcept: principle,
          rubricCriteria: rubric ? JSON.stringify(rubric) : gate.rubricCriteria,
          resources: resources ? JSON.stringify(resources) : gate.resources,
        });
        console.log(`  updated: type=${type} principle=${principle.slice(0, 60)}...`);
      }
      ok++;
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  FAIL: ${msg.slice(0, 300)}`);
    }
  }

  db.close();
  console.log(
    JSON.stringify(
      {
        total: targets.length,
        ok,
        fail,
        dryRun: DRY_RUN,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
