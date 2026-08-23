import process from "node:process";

import {
  queryReadonlyHarnessUsageBackfill,
  runHarnessUsageBackfillCli,
} from "../src/lib/harness-usage-backfill";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  process.exitCode = await runHarnessUsageBackfillCli(process.argv.slice(2), {
    query: () => queryReadonlyHarnessUsageBackfill(databaseUrl),
    stdout: (text) => { process.stdout.write(text); },
    stderr: (text) => { process.stderr.write(text); },
  });
}

void main().catch(() => {
  process.stderr.write("error: internal_error\n");
  process.exitCode = 1;
});
