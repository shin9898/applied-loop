import type { LoopJob, PrismaClient } from "../../generated/prisma/client";

export type RawLoopJobClient = Pick<PrismaClient, "$queryRaw">;

type RawResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; code: "storage_failure" };

async function executeOnce<T>(operation: () => Promise<T[]>): Promise<RawResult<T>> {
  try {
    return { ok: true, rows: await operation() };
  } catch {
    return { ok: false, code: "storage_failure" };
  }
}

function asDate(value: Date | string, fromStorage: (value: string) => Date): Date {
  return value instanceof Date ? value : fromStorage(value);
}

function normalizeJob(job: LoopJob, fromStorage: (value: string) => Date): LoopJob {
  const raw = job as LoopJob & Record<string, Date | string | null>;
  return {
    ...job,
    availableAt: asDate(raw.availableAt, fromStorage),
    lockedAt: raw.lockedAt === null ? null : asDate(raw.lockedAt, fromStorage),
    leaseExpiresAt: raw.leaseExpiresAt === null ? null : asDate(raw.leaseExpiresAt, fromStorage),
    createdAt: asDate(raw.createdAt, fromStorage),
    updatedAt: asDate(raw.updatedAt, fromStorage),
    finishedAt: raw.finishedAt === null ? null : asDate(raw.finishedAt, fromStorage),
  };
}

export async function claimOneRaw(input: {
  client: RawLoopJobClient;
  now: Date;
  leaseExpiresAt: Date;
  lockedBy: string;
  leaseToken: string;
  fromStorage: (value: string) => Date;
}): Promise<RawResult<LoopJob>> {
  const { client, now, leaseExpiresAt, lockedBy, leaseToken, fromStorage } = input;
  const result = await executeOnce(() => client.$queryRaw<LoopJob[]>`
    UPDATE "LoopJob"
    SET "status" = 'running',
        "attempts" = "attempts" + 1,
        "lockedAt" = ${now},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "lockedBy" = ${lockedBy},
        "leaseToken" = ${leaseToken},
        "updatedAt" = ${now},
        "finishedAt" = NULL
    WHERE "id" = (
      SELECT "id" FROM "LoopJob"
      WHERE "status" IN ('queued', 'retry_wait')
        AND "availableAt" <= ${now}
        AND "attempts" < "maxAttempts"
      ORDER BY "availableAt", "createdAt", "id"
      LIMIT 1
    )
      AND "status" IN ('queued', 'retry_wait')
      AND "availableAt" <= ${now}
      AND "attempts" < "maxAttempts"
    RETURNING *
  `);
  return result.ok
    ? { ok: true, rows: result.rows.map((job) => normalizeJob(job, fromStorage)) }
    : result;
}

// A8-C2 BEGIN: single-kind raw claim
export async function claimOneKindRaw(input: {
  client: RawLoopJobClient;
  kind: string;
  now: Date;
  leaseExpiresAt: Date;
  lockedBy: string;
  leaseToken: string;
  fromStorage: (value: string) => Date;
}): Promise<RawResult<LoopJob>> {
  const { client, kind, now, leaseExpiresAt, lockedBy, leaseToken, fromStorage } = input;
  const result = await executeOnce(() => client.$queryRaw<LoopJob[]>`
    UPDATE "LoopJob"
    SET "status" = 'running',
        "attempts" = "attempts" + 1,
        "lockedAt" = ${now},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "lockedBy" = ${lockedBy},
        "leaseToken" = ${leaseToken},
        "updatedAt" = ${now},
        "finishedAt" = NULL
    WHERE "id" = (
      SELECT "id" FROM "LoopJob"
      WHERE "status" IN ('queued', 'retry_wait')
        AND "kind" = ${kind}
        AND "availableAt" <= ${now}
        AND "attempts" < "maxAttempts"
      ORDER BY "availableAt", "createdAt", "id"
      LIMIT 1
    )
      AND "status" IN ('queued', 'retry_wait')
      AND "kind" = ${kind}
      AND "availableAt" <= ${now}
      AND "attempts" < "maxAttempts"
    RETURNING *
  `);
  return result.ok
    ? { ok: true, rows: result.rows.map((job) => normalizeJob(job, fromStorage)) }
    : result;
}
// A8-C2 END: single-kind raw claim

export async function renewOwnedRaw(input: {
  client: RawLoopJobClient;
  jobId: string;
  leaseToken: string;
  now: Date;
  leaseExpiresAt: Date;
  fromStorage: (value: string) => Date;
}): Promise<RawResult<{ leaseExpiresAt: Date }>> {
  const { client, jobId, leaseToken, now, leaseExpiresAt, fromStorage } = input;
  const result = await executeOnce(() => client.$queryRaw<Array<{ leaseExpiresAt: Date | string }>>`
    UPDATE "LoopJob"
    SET "leaseExpiresAt" = ${leaseExpiresAt},
        "updatedAt" = ${now}
    WHERE "id" = ${jobId}
      AND "status" = 'running'
      AND "leaseToken" = ${leaseToken}
      AND "leaseExpiresAt" > ${now}
    RETURNING "leaseExpiresAt"
  `);
  return result.ok
    ? {
        ok: true,
        rows: result.rows.map((row) => ({
          leaseExpiresAt: asDate(row.leaseExpiresAt, fromStorage),
        })),
      }
    : result;
}

export async function recoverOneExpiredRaw(input: {
  client: RawLoopJobClient;
  now: Date;
  fromStorage: (value: string) => Date;
}): Promise<RawResult<LoopJob>> {
  const { client, now, fromStorage } = input;
  const result = await executeOnce(() => client.$queryRaw<LoopJob[]>`
    WITH "candidate" AS MATERIALIZED (
      SELECT "id", "leaseToken", "leaseExpiresAt"
      FROM "LoopJob"
      WHERE "status" = 'running'
        AND "leaseExpiresAt" <= ${now}
      ORDER BY "leaseExpiresAt", "lockedAt", "id"
      LIMIT 1
    )
    UPDATE "LoopJob"
    SET "status" = CASE
          WHEN "attempts" >= "maxAttempts" THEN 'dead'
          ELSE 'retry_wait'
        END,
        "availableAt" = ${now},
        "lockedAt" = NULL,
        "leaseExpiresAt" = NULL,
        "lockedBy" = NULL,
        "leaseToken" = NULL,
        "lastError" = 'lease_expired',
        "updatedAt" = ${now},
        "finishedAt" = CASE
          WHEN "attempts" >= "maxAttempts" THEN ${now}
          ELSE NULL
        END
    WHERE "id" = (SELECT "id" FROM "candidate")
      AND "status" = 'running'
      AND "leaseToken" = (SELECT "leaseToken" FROM "candidate")
      AND "leaseExpiresAt" = (SELECT "leaseExpiresAt" FROM "candidate")
      AND "leaseExpiresAt" <= ${now}
    RETURNING *
  `);
  return result.ok
    ? { ok: true, rows: result.rows.map((job) => normalizeJob(job, fromStorage)) }
    : result;
}
