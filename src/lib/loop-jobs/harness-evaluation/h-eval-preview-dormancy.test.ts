import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("A4-CG7-T1 manual-preview-leaves-A2-runtime-registration-empty", async () => {
  const root = process.cwd();
  const workerPhase2 = await readFile(join(root, "src/lib/loop-jobs/worker-phase2.ts"), "utf8");
  assert.match(workerPhase2, /const productionRegistry = defineLoopJobRegistry\(\{\}\);/);
  assert.match(workerPhase2, /handlers: \{\}/);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["harness:evaluate-preview"],
    "tsx src/lib/loop-jobs/harness-evaluation/h-eval-preview-main.ts",
  );
  assert.equal(Object.keys(packageJson.scripts).filter((key) => key.includes("evaluate-preview")).length, 1);
});
