import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { authorizeWorker } from "./worker-phase1.mjs";

function emit(code, exitCode) {
  process.stdout.write(`${JSON.stringify({ code })}\n`);
  process.exitCode = exitCode;
}

const authorization = authorizeWorker(process.argv.slice(2), process.env);
if (!authorization.ok) {
  emit(authorization.code, 1);
} else {
  try {
    const phase2Entry = fileURLToPath(new URL("./worker-phase2-entry.ts", import.meta.url));
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", phase2Entry, authorization.databasePath],
      { encoding: "utf8", timeout: 10_000 },
    );
    if (child.error || child.signal || child.stderr !== "") throw new Error("phase 2 failed");
    const result = JSON.parse(child.stdout);
    const nonError = new Set(["no_job", "job_succeeded", "job_retry_scheduled", "job_dead"]);
    if (nonError.has(result.code) && child.status === 0) emit(result.code, 0);
    else if (result.code === "storage_failure" && child.status !== 0) emit("storage_failure", 1);
    else throw new Error("phase 2 result invalid");
  } catch {
    emit("storage_failure", 1);
  }
}
