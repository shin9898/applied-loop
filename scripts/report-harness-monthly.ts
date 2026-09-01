import { readFile } from "node:fs/promises";
import { runHarnessMonthlyReportCli } from "../src/lib/harness-monthly-report-cli";
import { queryReadonlyHarnessMonthlyReport } from "../src/lib/harness-monthly-report-query";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const exitCode = await runHarnessMonthlyReportCli(process.argv.slice(2), {
    query: (month) => queryReadonlyHarnessMonthlyReport(databaseUrl, month),
    readFile: (path) => readFile(path, "utf8"),
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
