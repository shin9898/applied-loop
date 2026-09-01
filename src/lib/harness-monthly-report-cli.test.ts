import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runHarnessMonthlyReportCli } from "./harness-monthly-report-cli";
import {
  buildHarnessMonthlyReport,
  parseHarnessReportMonth,
  type HarnessMonthlyReportRow,
} from "./harness-monthly-report";

function row(overrides: Partial<HarnessMonthlyReportRow> = {}): HarnessMonthlyReportRow {
  return {
    harness: "codex",
    model: "model-a",
    repo: "sample-repo",
    turns: 1,
    tokensOut: 100,
    tokensIn: 1_000_000,
    cacheRead: 0,
    cacheCreate: 0,
    usageSemanticsVersion: "harness-usage-v1",
    inputUncachedTokens: 1_000_000,
    cacheReadTokens: 0,
    ...overrides,
  };
}

function sampleReport() {
  const parsedMonth = parseHarnessReportMonth("2026-08");
  assert.equal(parsedMonth.ok, true);
  if (!parsedMonth.ok) throw new Error("unreachable");
  return buildHarnessMonthlyReport(parsedMonth, [row()]);
}

function noopReadFile(): Promise<string> {
  return Promise.reject(new Error("readFile not expected to be called"));
}

describe("harness monthly report CLI", () => {
  it("CLI-T1 rejects missing or invalid --month before querying", async () => {
    const cases = [
      { args: [], code: "missing_required_option" },
      { args: ["--month"], code: "missing_option_value" },
      { args: ["--month", "2026-13"], code: "invalid_month" },
      { args: ["--month", "2026-08", "--month", "2026-09"], code: "duplicate_option" },
      { args: ["--unknown"], code: "unknown_option" },
    ] as const;

    for (const testCase of cases) {
      let stdout = "";
      let stderr = "";
      let queryCount = 0;
      const exitCode = await runHarnessMonthlyReportCli(testCase.args, {
        query: async () => {
          queryCount += 1;
          return sampleReport();
        },
        readFile: noopReadFile,
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
      });
      assert.equal(exitCode, 1, testCase.code);
      assert.equal(stdout, "", testCase.code);
      assert.equal(stderr, `error: ${testCase.code}\n`, testCase.code);
      assert.equal(queryCount, 0, testCase.code);
    }
  });

  it("CLI-T2 fails with exit!=0 when --costs-json cannot be read or is invalid", async () => {
    let stdout = "";
    let stderr = "";
    const readFailExit = await runHarnessMonthlyReportCli(
      ["--month", "2026-08", "--costs-json", "/nope.json"],
      {
        query: async () => sampleReport(),
        readFile: () => Promise.reject(new Error("ENOENT")),
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
      },
    );
    assert.notEqual(readFailExit, 0);
    assert.equal(stdout, "");
    assert.equal(stderr, "error: costs_json_read_failed\n");

    let stdout2 = "";
    let stderr2 = "";
    const invalidJsonExit = await runHarnessMonthlyReportCli(
      ["--month", "2026-08", "--costs-json", "/bad.json"],
      {
        query: async () => sampleReport(),
        readFile: () => Promise.resolve("not json"),
        stdout: (text) => (stdout2 += text),
        stderr: (text) => (stderr2 += text),
      },
    );
    assert.notEqual(invalidJsonExit, 0);
    assert.equal(stdout2, "");
    assert.equal(stderr2, "error: costs_json_invalid\n");

    let stdout3 = "";
    let stderr3 = "";
    const negativeCostExit = await runHarnessMonthlyReportCli(
      ["--month", "2026-08", "--costs-json", "/neg.json"],
      {
        query: async () => sampleReport(),
        readFile: () => Promise.resolve(JSON.stringify([{ model: "model-a", costUSD: -1 }])),
        stdout: (text) => (stdout3 += text),
        stderr: (text) => (stderr3 += text),
      },
    );
    assert.notEqual(negativeCostExit, 0);
    assert.equal(stderr3, "error: costs_json_invalid\n");
  });

  it("CLI-T3 --json output matches the builder report and stays automation-safe", async () => {
    const report = sampleReport();
    let stdout = "";
    let stderr = "";
    const exitCode = await runHarnessMonthlyReportCli(["--month", "2026-08", "--json"], {
      query: async () => report,
      readFile: noopReadFile,
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed.report, report);
    assert.equal(parsed.costJoin, null);
    assert.equal(stdout, `${JSON.stringify({ report, costJoin: null })}\n`);
  });

  it("CLI-T4 renders markdown by default and surfaces query failures", async () => {
    const report = sampleReport();
    let stdout = "";
    const exitCode = await runHarnessMonthlyReportCli(["--month", "2026-08"], {
      query: async () => report,
      readFile: noopReadFile,
      stdout: (text) => (stdout += text),
      stderr: () => {},
    });
    assert.equal(exitCode, 0);
    assert.match(stdout, /# Harness Report 2026-08/);

    let stderr = "";
    const failedExit = await runHarnessMonthlyReportCli(["--month", "2026-08"], {
      query: async () => {
        throw new Error("database unavailable");
      },
      readFile: noopReadFile,
      stdout: () => {},
      stderr: (text) => (stderr += text),
    });
    assert.equal(failedExit, 1);
    assert.equal(stderr, "error: query_failed\n");
  });
});
