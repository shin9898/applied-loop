import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../generated/prisma/client";
import { runOneDelivery, type LoopJobHandler } from "./delivery";
import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

const databasePath = process.env.LOOP_JOB_TEST_DATABASE_PATH;
const nowText = process.env.LOOP_JOB_TEST_NOW;
const thrownSecret = process.env.LOOP_JOB_TEST_THROWN_SECRET;
if (!databasePath || !nowText || !thrownSecret) {
  process.exitCode = 2;
} else {
  void (async () => {
    const now = new Date(nowText);
    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    const registry = defineLoopJobRegistry({
      recovery_probe: {
        version: "v1",
        fields: {
          entityId: { type: "opaque_id", prefix: "entity" },
          operation: { type: "enum", values: ["recover"] as const },
          artifactHash: { type: "hash" },
        },
        dedupeFields: ["entityId", "operation"] as const,
      },
    });
    let next = 220;
    const queue = createLoopJobQueue({
      client,
      registry,
      clock: {
        now: () => new Date(now),
        addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
        fromStorage: (value) => new Date(value),
      },
      randomBytes(length) {
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) {
          bytes[index] = next % 256;
          next += 1;
        }
        return bytes;
      },
    });
    const handler: LoopJobHandler = {
      idempotencyKey: "job_id",
      async handle() {
        throw new Error(thrownSecret);
      },
    };
    const result = await runOneDelivery({
      queue,
      registry,
      handlers: { recovery_probe: handler },
      leaseDurationMs: 500,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitterEntropy: 0,
    });
    await client.$disconnect();
    process.send?.(result, () => process.disconnect?.());
  })();
}
