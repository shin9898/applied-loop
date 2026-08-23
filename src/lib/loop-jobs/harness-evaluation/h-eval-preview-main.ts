import process from "node:process";

import { runHEvalPreviewCliV1 } from "./h-eval-preview-cli";

async function main(): Promise<void> {
  process.exitCode = await runHEvalPreviewCliV1({
    args: process.argv.slice(2),
    input: process.stdin,
    output: process.stdout,
  });
}

void main();
