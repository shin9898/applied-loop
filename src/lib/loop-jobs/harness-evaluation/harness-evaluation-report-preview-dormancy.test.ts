import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("A9A-CG11-T1 manual-report-preview-keeps-runtime-and-authority-dormant", async () => {
  const root = process.cwd();
  const workerPhase2 = await readFile(join(root, "src/lib/loop-jobs/worker-phase2.ts"), "utf8");
  assert.match(workerPhase2, /const productionRegistry = defineLoopJobRegistry\(\{\}\);/);
  assert.match(workerPhase2, /handlers: \{\}/);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["harness:evaluate-report-preview"],
    "tsx src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-preview-main.ts",
  );
  assert.equal(
    Object.keys(packageJson.scripts).filter((key) => key.includes("evaluate-report-preview")).length,
    1,
  );

  const cli = await readFile(
    join(root, "src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-preview-cli.ts"),
    "utf8",
  );
  const executableCli = cli.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(
    executableCli,
    /(?:Prisma|DATABASE_URL|worker|scheduler|launchd|launchctl|createLoopJobQueue|runOneDelivery|fetch\(|LLM)/,
  );
  assert.match(cli, /from "\.\/harness-evaluation-report-v1";/);
});
