import process from "node:process";

import { runHarnessEvaluationReportPreviewCliV1 } from "./harness-evaluation-report-preview-cli";

async function main(): Promise<void> {
  process.exitCode = await runHarnessEvaluationReportPreviewCliV1({
    args: process.argv.slice(2),
    input: process.stdin,
    output: process.stdout,
  });
}

void main();
