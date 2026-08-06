/**
 * 出題 eval 回帰（B11-1）。
 * 既定: fixtures/*.golden.json を構造チェック（LLM 不要）。
 * RUN_LLM_EVAL=1: 各 .diff で requestGateFromDiff（要 CLI・DB 書き込み）。
 *
 * Usage: npx tsx scripts/eval-gate-gen.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGeneratedQuestion } from "../src/lib/gate-question-eval";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "scripts/fixtures/gate-gen");

async function main() {
  const diffs = readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".diff"))
    .sort();

  if (diffs.length < 5) {
    console.error(`fixture が不足: ${diffs.length} 件（期待 ≥5）`);
    process.exit(1);
  }

  let failed = 0;

  for (const diffName of diffs) {
    const base = diffName.replace(/\.diff$/, "");
    const goldenPath = join(fixtureDir, `${base}.golden.json`);
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    const result = evaluateGeneratedQuestion(golden);
    console.log(`[${result.ok ? "OK" : "NG"}] ${base}`);
    if (!result.ok) {
      failed += 1;
      for (const i of result.issues) {
        console.log(`  - ${i.code}: ${i.message}`);
      }
    }
  }

  if (process.env.RUN_LLM_EVAL === "1") {
    console.log("\n--- RUN_LLM_EVAL=1: live generate ---");
    const { requestGateFromDiff } = await import("../src/lib/gate");
    for (const diffName of diffs) {
      const base = diffName.replace(/\.diff$/, "");
      const diff = readFileSync(join(fixtureDir, diffName), "utf8");
      const gen = await requestGateFromDiff({
        diff,
        repo: `fixture-${base}`,
        summary: base,
      });
      if (!gen.ok) {
        console.log(`[NG] live ${base}: ${gen.message}`);
        failed += 1;
        continue;
      }
      if (gen.question.trim().length < 20) {
        console.log(`[NG] live ${base}: question short`);
        failed += 1;
      } else {
        console.log(`[OK] live ${base} gateId=${gen.gateId}`);
      }
    }
  }

  console.log(`\n${diffs.length} fixtures, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
