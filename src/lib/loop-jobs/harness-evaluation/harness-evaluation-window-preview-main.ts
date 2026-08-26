import process from "node:process";

import { runHarnessEvaluationWindowPreviewCliV1 } from "./harness-evaluation-window-preview-cli";

async function main(): Promise<void> {
  process.exitCode = await runHarnessEvaluationWindowPreviewCliV1({
    args: process.argv.slice(2),
    input: process.stdin,
    output: process.stdout,
  });
}

void main();
