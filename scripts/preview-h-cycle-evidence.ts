import { runHCycleEvidencePreviewCli } from "../src/lib/h-cycle-evidence-preview";
import { queryReadonlyHCycleEvidencePreviewSnapshotV1 } from "../src/lib/h-cycle-evidence-preview-query";

async function main(): Promise<void> {
  process.exitCode = await runHCycleEvidencePreviewCli(process.argv.slice(2), {
    databaseUrl: process.env.DATABASE_URL,
    now: () => new Date(),
    querySnapshot: queryReadonlyHCycleEvidencePreviewSnapshotV1,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

void main().catch(() => {
  process.stderr.write("error: internal_error\n");
  process.exitCode = 1;
});
