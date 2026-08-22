import { runOneShotWorker } from "./worker-phase2";

void runOneShotWorker(process.argv[2]).then((result) => {
  process.stdout.write(`${JSON.stringify({ code: result.code })}\n`);
  process.exitCode = result.ok ? 0 : 1;
});
