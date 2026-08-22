import { runHarnessCacheAuditCli } from "../src/lib/harness-cache-audit-cli";
import { queryReadonlyHarnessCacheAudit } from "../src/lib/harness-cache-audit-query";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const exitCode = await runHarnessCacheAuditCli(process.argv.slice(2), {
    query: (week) => queryReadonlyHarnessCacheAudit(databaseUrl, week),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  });
  process.exitCode = exitCode;
}

void main().catch(() => {
  process.stderr.write("error: internal_error\n");
  process.exitCode = 1;
});
