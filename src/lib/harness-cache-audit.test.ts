import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHarnessCacheAuditReport,
  parseHarnessAuditWeek,
} from "./harness-cache-audit";

describe("harness cache audit", () => {
  it("A1-CG2-T1 parses real ISO weeks into exact half-open JST Monday windows", () => {
    assert.deepEqual(parseHarnessAuditWeek("2026-W34"), {
      ok: true,
      week: "2026-W34",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2026-08-16T15:00:00.000Z",
        endExclusive: "2026-08-23T15:00:00.000Z",
      },
    });
    assert.deepEqual(parseHarnessAuditWeek("2026-W01"), {
      ok: true,
      week: "2026-W01",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2025-12-28T15:00:00.000Z",
        endExclusive: "2026-01-04T15:00:00.000Z",
      },
    });
    assert.deepEqual(parseHarnessAuditWeek("2020-W53"), {
      ok: true,
      week: "2020-W53",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2020-12-27T15:00:00.000Z",
        endExclusive: "2021-01-03T15:00:00.000Z",
      },
    });

    for (const week of [
      "2021-W53",
      "2026-W00",
      "2026-W54",
      "2026-W1",
      "not-a-week",
    ]) {
      assert.deepEqual(parseHarnessAuditWeek(week), {
        ok: false,
        reason: "invalid_iso_week",
      });
    }
  });

  it("A1-CG2-T2 separates compatible and unsupported evidence with deterministic counts and rates", () => {
    const parsedWeek = parseHarnessAuditWeek("2026-W34");
    assert.equal(parsedWeek.ok, true);
    if (!parsedWeek.ok) return;

    const report = buildHarnessCacheAuditReport(parsedWeek, [
      { harness: "claude", tokensIn: 10, cacheRead: 30, cacheCreate: 10 },
      { harness: "claude", tokensIn: -1, cacheRead: 0, cacheCreate: 0 },
      { harness: "codex", tokensIn: 10, cacheRead: 11, cacheCreate: 0 },
      { harness: "codex", tokensIn: 0, cacheRead: 0, cacheCreate: 0 },
      { harness: "codex", tokensIn: 10, cacheRead: 1, cacheCreate: 1 },
      { harness: "zeta", tokensIn: Number.NaN, cacheRead: 0, cacheCreate: 0 },
      { harness: "alpha", tokensIn: 1, cacheRead: 0, cacheCreate: 0 },
      { harness: "alpha", tokensIn: 2, cacheRead: 0, cacheCreate: 0 },
      { harness: "alpha", tokensIn: -1, cacheRead: 0, cacheCreate: 0 },
    ]);

    assert.deepEqual(report, {
      week: "2026-W34",
      window: {
        timezone: "Asia/Tokyo",
        startInclusive: "2026-08-16T15:00:00.000Z",
        endExclusive: "2026-08-23T15:00:00.000Z",
      },
      semanticsVersion: "harness-usage-v1",
      segments: [
        {
          harness: "claude",
          provider: "anthropic",
          semanticsVersion: "harness-usage-v1",
          supportedCount: 1,
          excludedCount: 1,
          exclusionReasons: { negative_input: 1 },
          rawTotals: { tokensIn: 10, cacheRead: 30, cacheCreate: 10 },
          legacy: { denominator: 50, rate: 0.6 },
          normalized: {
            totalInput: 50,
            cacheRead: 30,
            cacheWrite: 10,
            freshInput: 20,
            rate: 0.6,
          },
          calculationErrors: [],
        },
        {
          harness: "codex",
          provider: "openai",
          semanticsVersion: "harness-usage-v1",
          supportedCount: 0,
          excludedCount: 3,
          exclusionReasons: {
            cache_read_exceeds_total: 1,
            unsupported_usage_semantics: 1,
            zero_total: 1,
          },
          rawTotals: { tokensIn: 0, cacheRead: 0, cacheCreate: 0 },
          legacy: { denominator: 0, rate: null },
          normalized: {
            totalInput: 0,
            cacheRead: 0,
            cacheWrite: null,
            freshInput: 0,
            rate: null,
          },
          calculationErrors: [],
        },
      ],
      unsupportedSegments: [
        { harness: "alpha", reason: "negative_input", count: 1 },
        { harness: "alpha", reason: "unsupported_harness", count: 2 },
        { harness: "zeta", reason: "non_finite_input", count: 1 },
      ],
      summary: {
        queried: 9,
        supported: 1,
        excluded: 8,
        exclusionReasons: {
          cache_read_exceeds_total: 1,
          negative_input: 2,
          non_finite_input: 1,
          unsupported_harness: 2,
          unsupported_usage_semantics: 1,
          zero_total: 1,
        },
        calculationErrorCount: 0,
      },
    });
  });

  it("A1-CG2-T3 nulls every overflow path independently in fixed order without losing safe siblings", () => {
    const parsedWeek = parseHarnessAuditWeek("2026-W34");
    assert.equal(parsedWeek.ok, true);
    if (!parsedWeek.ok) return;

    const max = Number.MAX_SAFE_INTEGER;
    const everyOverflowPath = [
      "rawTotals.tokensIn",
      "rawTotals.cacheRead",
      "rawTotals.cacheCreate",
      "legacy.denominator",
      "normalized.totalInput",
      "normalized.cacheRead",
      "normalized.cacheWrite",
      "normalized.freshInput",
    ];
    const allOverflowRows = [
      { harness: "claude", tokensIn: max, cacheRead: 0, cacheCreate: 0 },
      { harness: "claude", tokensIn: max, cacheRead: 0, cacheCreate: 0 },
      { harness: "claude", tokensIn: 0, cacheRead: max, cacheCreate: 0 },
      { harness: "claude", tokensIn: 0, cacheRead: max, cacheCreate: 0 },
      { harness: "claude", tokensIn: 0, cacheRead: 0, cacheCreate: max },
      { harness: "claude", tokensIn: 0, cacheRead: 0, cacheCreate: max },
    ];

    let allOverflowReport!: ReturnType<typeof buildHarnessCacheAuditReport>;
    assert.doesNotThrow(() => {
      allOverflowReport = buildHarnessCacheAuditReport(
        parsedWeek,
        allOverflowRows,
      );
    });
    const allOverflow = allOverflowReport.segments[0];
    assert.deepEqual(allOverflow.rawTotals, {
      tokensIn: null,
      cacheRead: null,
      cacheCreate: null,
    });
    assert.deepEqual(allOverflow.legacy, { denominator: null, rate: null });
    assert.deepEqual(allOverflow.normalized, {
      totalInput: null,
      cacheRead: null,
      cacheWrite: null,
      freshInput: null,
      rate: null,
    });
    assert.deepEqual(
      allOverflow.calculationErrors,
      everyOverflowPath.map((field) => ({
        code: "aggregate_overflow",
        field,
      })),
    );
    assert.equal(allOverflowReport.summary.calculationErrorCount, 8);

    const codexCorrelated = buildHarnessCacheAuditReport(parsedWeek, [
      { harness: "codex", tokensIn: max, cacheRead: max, cacheCreate: 0 },
      { harness: "codex", tokensIn: max, cacheRead: max, cacheCreate: 0 },
    ]).segments[0];
    assert.deepEqual(codexCorrelated.rawTotals, {
      tokensIn: null,
      cacheRead: null,
      cacheCreate: 0,
    });
    assert.deepEqual(codexCorrelated.legacy, {
      denominator: null,
      rate: null,
    });
    assert.deepEqual(codexCorrelated.normalized, {
      totalInput: null,
      cacheRead: null,
      cacheWrite: null,
      freshInput: 0,
      rate: null,
    });
    assert.deepEqual(
      codexCorrelated.calculationErrors.map((error) => error.field),
      [
        "rawTotals.tokensIn",
        "rawTotals.cacheRead",
        "legacy.denominator",
        "normalized.totalInput",
        "normalized.cacheRead",
      ],
    );

    const legacyOnlyReport = buildHarnessCacheAuditReport(parsedWeek, [
      { harness: "codex", tokensIn: max, cacheRead: 1, cacheCreate: 0 },
    ]);
    const legacyOnly = legacyOnlyReport.segments[0];
    assert.deepEqual(legacyOnly.rawTotals, {
      tokensIn: max,
      cacheRead: 1,
      cacheCreate: 0,
    });
    assert.deepEqual(legacyOnly.legacy, { denominator: null, rate: null });
    assert.deepEqual(legacyOnly.normalized, {
      totalInput: max,
      cacheRead: 1,
      cacheWrite: null,
      freshInput: max - 1,
      rate: 1 / max,
    });
    assert.deepEqual(legacyOnly.calculationErrors, [
      { code: "aggregate_overflow", field: "legacy.denominator" },
    ]);
    assert.equal(legacyOnlyReport.summary.calculationErrorCount, 1);
  });
});
