import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseHarnessReportMonth } from "./harness-monthly-report";
import {
  queryHarnessMonthlyReport,
  queryReadonlyHarnessMonthlyReport,
  type HarnessMonthlyReportQueryClient,
} from "./harness-monthly-report-query";

describe("harness monthly report query adapter", () => {
  it("Q-T1 performs one minimal half-open month query with the 11-column select and always disconnects", async () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const calls: unknown[] = [];
    let disconnectCount = 0;
    const emptyClient: HarnessMonthlyReportQueryClient = {
      harnessRun: {
        findMany: async (args) => {
          calls.push(args);
          return [];
        },
      },
      $disconnect: async () => {
        disconnectCount += 1;
      },
    };

    const report = await queryHarnessMonthlyReport(emptyClient, parsedMonth);
    assert.deepEqual(calls, [
      {
        where: {
          startedAt: {
            gte: new Date("2026-07-31T15:00:00.000Z"),
            lt: new Date("2026-08-31T15:00:00.000Z"),
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
      },
    ]);
    assert.equal(disconnectCount, 1);
    assert.equal(report.summary.queried, 0);

    let rejectedDisconnectCount = 0;
    const rejectingClient: HarnessMonthlyReportQueryClient = {
      harnessRun: {
        findMany: async () => {
          throw new Error("query exploded");
        },
      },
      $disconnect: async () => {
        rejectedDisconnectCount += 1;
      },
    };
    await assert.rejects(
      queryHarnessMonthlyReport(rejectingClient, parsedMonth),
      /query exploded/,
    );
    assert.equal(rejectedDisconnectCount, 1);
  });

  it("Q-T2 rejects without creating a database file when the SQLite path is missing", async () => {
    const parsedMonth = parseHarnessReportMonth("2026-08");
    assert.equal(parsedMonth.ok, true);
    if (!parsedMonth.ok) return;

    const fixtureDir = mkdtempSync(join(tmpdir(), "harness-monthly-report-missing-"));
    try {
      const missingDb = join(fixtureDir, "does-not-exist.db");
      await assert.rejects(
        queryReadonlyHarnessMonthlyReport(`file:${missingDb}`, parsedMonth),
      );
      assert.equal(existsSync(missingDb), false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
