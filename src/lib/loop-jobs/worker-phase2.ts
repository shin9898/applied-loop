import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../generated/prisma/client";
import { runOneDelivery } from "./delivery";
import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

const productionRegistry = defineLoopJobRegistry({});

function productionClock() {
  return {
    now: () => new Date(),
    addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
    fromStorage: (value: string) => new Date(value),
  };
}

export async function runOneShotWorker(
  databasePath: string,
): Promise<
  | { ok: true; code: "no_job" | "job_succeeded" | "job_retry_scheduled" | "job_dead" }
  | { ok: false; code: "storage_failure" }
> {
  let client: PrismaClient | undefined;
  let outcome:
    | { ok: true; code: "no_job" | "job_succeeded" | "job_retry_scheduled" | "job_dead" }
    | { ok: false; code: "storage_failure" };
  try {
    const adapter = new PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout: 250 },
      { timestampFormat: "iso8601" },
    );
    client = new PrismaClient({ adapter });
    const queue = createLoopJobQueue({ client, registry: productionRegistry, clock: productionClock() });
    const recovery = await queue.recoverExpired();
    if (!recovery.ok) {
      outcome = { ok: false, code: "storage_failure" };
    } else {
      const result = await runOneDelivery({
        queue,
        registry: productionRegistry,
        handlers: {},
        leaseDurationMs: 30_000,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        jitterEntropy: 0.5,
      });
      outcome = result.ok ? result : { ok: false, code: "storage_failure" };
    }
  } catch {
    outcome = { ok: false, code: "storage_failure" };
  }
  try {
    await client?.$disconnect();
  } catch {
    return { ok: false, code: "storage_failure" };
  }
  return outcome;
}
