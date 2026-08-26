import process from "node:process";

import { runHarnessEvaluationSourcePreviewCliV1 } from "./harness-evaluation-source-preview-cli";

async function main(): Promise<void> {
  process.exitCode = await runHarnessEvaluationSourcePreviewCliV1({
    args: process.argv.slice(2),
    input: process.stdin,
    output: process.stdout,
  });
}

void main();
