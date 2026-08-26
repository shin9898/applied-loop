import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("A9D3-CG6 keeps the window caller manual, feature-off, and non-authoritative", async () => {
  const root = process.cwd();
  const workerPhase2 = await readFile(join(root, "src/lib/loop-jobs/worker-phase2.ts"), "utf8");
  assert.match(workerPhase2, /const productionRegistry = defineLoopJobRegistry\(\{\}\);/);
  assert.match(workerPhase2, /handlers: \{\}/);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts["harness:evaluate-window-preview"],
    "tsx src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-preview-main.ts",
  );
  const cli = await readFile(
    join(root, "src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-preview-cli.ts"),
    "utf8",
  );
  const executableCli = cli.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(
    executableCli,
    /(?:Prisma|DATABASE_URL|worker|scheduler|launchd|launchctl|createLoopJobQueue|runOneDelivery|fetch\(|LLM|automaticInterventionAllowed\s*:\s*true)/,
  );
  assert.match(cli, /from "\.\/harness-evaluation-evidence-v1";/);
  assert.match(cli, /from "\.\/harness-evaluation-report-v1";/);
  assert.match(cli, /from "\.\/harness-evaluation-window-adapter-v1";/);
});
