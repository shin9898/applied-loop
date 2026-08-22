import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../generated/prisma/client";
import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

function entropy(seed: number) {
  let next = seed;
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = next % 256;
      next += 1;
    }
    return bytes;
  };
}

const databasePath = process.env.LOOP_JOB_TEST_DATABASE_PATH;
const action = process.env.LOOP_JOB_TEST_ACTION;
const nowText = process.env.LOOP_JOB_TEST_NOW;
const seed = Number(process.env.LOOP_JOB_TEST_SEED);
if (!databasePath || !action || !nowText || !Number.isInteger(seed)) {
  process.exitCode = 2;
} else {
  const now = new Date(nowText);
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: databasePath, fileMustExist: true, timeout: 1_000 },
      { timestampFormat: "iso8601" },
    ),
  });
  const registry = defineLoopJobRegistry({
    fence_probe: {
      version: "v1",
      fields: {
        entityId: { type: "opaque_id", prefix: "entity" },
        operation: { type: "enum", values: ["fence"] as const },
        artifactHash: { type: "hash" },
      },
      dedupeFields: ["entityId", "operation"] as const,
    },
  });
  const queue = createLoopJobQueue({
    client,
    registry,
    clock: {
      now: () => new Date(now),
      addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
      fromStorage: (value) => new Date(value),
    },
    randomBytes: entropy(seed),
  });

  process.send?.({ type: "ready" });
  process.once("message", async (message: unknown) => {
    if (typeof message !== "object" || message === null || (message as { type?: string }).type !== "go") {
      await client.$disconnect();
      process.exitCode = 3;
      process.disconnect?.();
      return;
    }

    let closedResult: Record<string, unknown>;
    if (action === "claim") {
      const result = await queue.claim({ leaseDurationMs: Number(process.env.LOOP_JOB_TEST_LEASE_MS) });
      closedResult = result.code === "claimed"
        ? {
            code: result.code,
            id: result.job.id,
            attempts: result.job.attempts,
            leaseToken: result.job.leaseToken,
            lockedBy: result.job.lockedBy,
          }
        : { code: result.code };
    } else if (action === "renew") {
      const result = await queue.renew({
        jobId: process.env.LOOP_JOB_TEST_JOB_ID!,
        leaseToken: process.env.LOOP_JOB_TEST_LEASE_TOKEN!,
        leaseDurationMs: Number(process.env.LOOP_JOB_TEST_LEASE_MS),
      });
      closedResult = result.ok
        ? { ok: true, leaseExpiresAt: result.leaseExpiresAt.toISOString() }
        : { ok: false, code: result.code };
    } else if (action === "recover") {
      const result = await queue.recoverExpired();
      closedResult = result.ok
        ? { ok: true, recovered: result.recovered, status: result.recovered ? result.job.status : undefined }
        : { ok: false, code: result.code };
    } else {
      closedResult = { ok: false, code: "storage_failure" };
      process.exitCode = 4;
    }
    await client.$disconnect();
    process.send?.({ type: "result", result: closedResult }, () => process.disconnect?.());
  });
}
