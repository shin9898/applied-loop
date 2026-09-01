import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import {
  buildHarnessMonthlyReport,
  type HarnessMonthlyReport,
  type HarnessMonthlyReportRow,
  type ValidHarnessReportMonth,
} from "./harness-monthly-report";

export type HarnessMonthlyReportFindManyArgs = {
  where: {
    startedAt: {
      gte: Date;
      lt: Date;
    };
  };
  select: {
    harness: true;
    model: true;
    repo: true;
    turns: true;
    tokensOut: true;
    tokensIn: true;
    cacheRead: true;
    cacheCreate: true;
    usageSemanticsVersion: true;
    inputUncachedTokens: true;
    cacheReadTokens: true;
  };
};

export type HarnessMonthlyReportQueryClient = {
  harnessRun: {
    findMany(args: HarnessMonthlyReportFindManyArgs): Promise<HarnessMonthlyReportRow[]>;
  };
  $disconnect(): Promise<void>;
};

export function createReadonlyHarnessMonthlyReportClient(
  url: string,
): HarnessMonthlyReportQueryClient {
  const adapter = new PrismaBetterSqlite3({
    url,
    readonly: true,
    fileMustExist: true,
  });
  return new PrismaClient({ adapter });
}

export async function queryHarnessMonthlyReport(
  client: HarnessMonthlyReportQueryClient,
  month: ValidHarnessReportMonth,
): Promise<HarnessMonthlyReport> {
  try {
    const rows = await client.harnessRun.findMany({
      where: {
        startedAt: {
          gte: new Date(month.window.startInclusive),
          lt: new Date(month.window.endExclusive),
        },
      },
      select: {
        harness: true,
        model: true,
        repo: true,
        turns: true,
        tokensOut: true,
        tokensIn: true,
        cacheRead: true,
        cacheCreate: true,
        usageSemanticsVersion: true,
        inputUncachedTokens: true,
        cacheReadTokens: true,
      },
    });
    return buildHarnessMonthlyReport(month, rows);
  } finally {
    await client.$disconnect();
  }
}

export function queryReadonlyHarnessMonthlyReport(
  url: string,
  month: ValidHarnessReportMonth,
): Promise<HarnessMonthlyReport> {
  return queryHarnessMonthlyReport(
    createReadonlyHarnessMonthlyReportClient(url),
    month,
  );
}
