import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import {
  buildHarnessCacheAuditReport,
  type HarnessCacheAuditReport,
  type ValidHarnessAuditWeek,
} from "./harness-cache-audit";
import type { HarnessUsageInput } from "./harness-usage-normalization";

export type HarnessAuditFindManyArgs = {
  where: {
    startedAt: {
      gte: Date;
      lt: Date;
    };
  };
  select: {
    harness: true;
    tokensIn: true;
    cacheRead: true;
    cacheCreate: true;
  };
};

export type HarnessAuditQueryClient = {
  harnessRun: {
    findMany(args: HarnessAuditFindManyArgs): Promise<HarnessUsageInput[]>;
  };
  $disconnect(): Promise<void>;
};

export function createReadonlyHarnessAuditClient(
  url: string,
): HarnessAuditQueryClient {
  const adapter = new PrismaBetterSqlite3({
    url,
    readonly: true,
    fileMustExist: true,
  });
  return new PrismaClient({ adapter });
}

export async function queryHarnessCacheAudit(
  client: HarnessAuditQueryClient,
  parsedWeek: ValidHarnessAuditWeek,
): Promise<HarnessCacheAuditReport> {
  try {
    const rows = await client.harnessRun.findMany({
      where: {
        startedAt: {
          gte: new Date(parsedWeek.window.startInclusive),
          lt: new Date(parsedWeek.window.endExclusive),
        },
      },
      select: {
        harness: true,
        tokensIn: true,
        cacheRead: true,
        cacheCreate: true,
      },
    });
    return buildHarnessCacheAuditReport(parsedWeek, rows);
  } finally {
    await client.$disconnect();
  }
}

export function queryReadonlyHarnessCacheAudit(
  url: string,
  parsedWeek: ValidHarnessAuditWeek,
): Promise<HarnessCacheAuditReport> {
  return queryHarnessCacheAudit(
    createReadonlyHarnessAuditClient(url),
    parsedWeek,
  );
}
