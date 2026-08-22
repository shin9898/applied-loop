import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../generated/prisma/client";
import { createLoopJobQueue, defineLoopJobRegistry } from "./state-machine";

function injectedEntropy(seed: number) {
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
const hashCharacter = process.env.LOOP_JOB_TEST_HASH_CHARACTER;
const seed = Number(process.env.LOOP_JOB_TEST_ENTROPY_SEED);
if (!databasePath || !hashCharacter || !/^[0-9a-f]$/.test(hashCharacter) || !Number.isInteger(seed)) {
  process.exitCode = 2;
} else {
  const adapter = new PrismaBetterSqlite3(
    { url: databasePath, fileMustExist: true },
    { timestampFormat: "iso8601" },
  );
  const client = new PrismaClient({ adapter });
  const registry = defineLoopJobRegistry({
    state_probe: {
      version: "v1",
      fields: {
        entityId: { type: "opaque_id", prefix: "entity" },
        operation: { type: "enum", values: ["inspect", "reconcile"] as const },
        artifactHash: { type: "hash" },
      },
      dedupeFields: ["entityId", "operation"] as const,
    },
  });
  const queue = createLoopJobQueue({
    client,
    registry,
    clock: {
      now: () => new Date("2026-08-22T01:02:03.456Z"),
      addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
      fromStorage: (value) => new Date(value),
    },
    randomBytes: injectedEntropy(seed),
  });

  process.send?.({ type: "ready" });
  process.once("message", async (message: unknown) => {
    if (typeof message !== "object" || message === null || (message as { type?: string }).type !== "go") {
      await client.$disconnect();
      process.exitCode = 3;
      process.disconnect?.();
      return;
    }
    const result = await queue.enqueue({
      kind: "state_probe",
      payload: {
        operation: "inspect",
        artifactHash: hashCharacter.repeat(64),
        entityId: `entity_${"b".repeat(32)}`,
      },
      maxAttempts: 3,
    });
    await client.$disconnect();
    const closedResult = result.ok
      ? { ok: true as const, created: result.created }
      : { ok: false as const, code: result.code };
    process.send?.({ type: "result", result: closedResult }, () => process.disconnect?.());
  });
}
