import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeHarnessUsage } from "./harness-usage-normalization";

describe("harness usage normalization", () => {
  it("A1-CG1-T1 normalizes Claude and Codex fixtures without double-counting Codex cache reads", () => {
    const claude = normalizeHarnessUsage({
      harness: "claude",
      tokensIn: 134_340,
      cacheRead: 9_649_573_942,
      cacheCreate: 173_611_622,
    });
    assert.equal(claude.status, "supported");
    if (claude.status !== "supported") return;
    assert.equal(claude.provider, "anthropic");
    assert.equal(claude.semanticsVersion, "harness-usage-v1");
    assert.equal(claude.totalInput, 9_823_319_904);
    assert.equal(claude.ordinaryNonReadInput, 134_340);
    assert.equal(claude.cacheWrite, 173_611_622);
    assert.equal(claude.freshInput, 173_745_962);
    assert.ok(Math.abs(claude.cacheReuseRate - 0.98231) < 0.000005);
    assert.equal(claude.freshInputRate, claude.freshInput / claude.totalInput);

    const codexInput = {
      harness: "codex",
      tokensIn: 1_549_716_286,
      cacheRead: 1_490_230_656,
      cacheCreate: 0,
    } as const;
    const codex = normalizeHarnessUsage(codexInput);
    assert.equal(codex.status, "supported");
    if (codex.status !== "supported") return;
    assert.equal(codex.provider, "openai");
    assert.equal(codex.totalInput, 1_549_716_286);
    assert.equal(codex.ordinaryNonReadInput, 59_485_630);
    assert.equal(codex.cacheWrite, null);
    assert.equal(codex.freshInput, 59_485_630);
    assert.ok(Math.abs(codex.cacheReuseRate - 0.96162) < 0.000005);
    const legacyRate =
      codexInput.cacheRead /
      (codexInput.tokensIn + codexInput.cacheRead + codexInput.cacheCreate);
    assert.ok(Math.abs(legacyRate - 0.49022) < 0.000005);
    assert.ok(codex.cacheReuseRate > legacyRate);

    const zeroTotal = normalizeHarnessUsage({
      harness: "codex",
      tokensIn: 0,
      cacheRead: 0,
      cacheCreate: 0,
    });
    assert.deepEqual(zeroTotal, {
      status: "no_sample",
      reason: "zero_total",
      semanticsVersion: "harness-usage-v1",
      provider: "openai",
      raw: {
        harness: "codex",
        tokensIn: 0,
        cacheRead: 0,
        cacheCreate: 0,
      },
    });
  });

  it("A1-CG1-T2 rejects ambiguous Codex writes after checking read-over-total", () => {
    const ambiguousWrite = normalizeHarnessUsage({
      harness: "codex",
      tokensIn: 10,
      cacheRead: 1,
      cacheCreate: 1,
    });
    assert.equal(ambiguousWrite.status, "unsupported");
    if (ambiguousWrite.status !== "unsupported") return;
    assert.equal(ambiguousWrite.reason, "unsupported_usage_semantics");
    assert.deepEqual(ambiguousWrite.raw, {
      harness: "codex",
      tokensIn: 10,
      cacheRead: 1,
      cacheCreate: 1,
    });

    const readOverTotal = normalizeHarnessUsage({
      harness: "codex",
      tokensIn: 10,
      cacheRead: 11,
      cacheCreate: 1,
    });
    assert.equal(readOverTotal.status, "invalid");
    if (readOverTotal.status !== "invalid") return;
    assert.equal(readOverTotal.reason, "cache_read_exceeds_total");
    assert.deepEqual(readOverTotal.raw, {
      harness: "codex",
      tokensIn: 10,
      cacheRead: 11,
      cacheCreate: 1,
    });
  });

  it("A1-CG1-T3 applies deterministic validation precedence, checked addition, and no mutation", () => {
    const precedenceCases = [
      {
        name: "non-finite wins over all later predicates and fields",
        input: {
          harness: "unknown",
          tokensIn: Number.NaN,
          cacheRead: 1.5,
          cacheCreate: -1,
        },
        reason: "non_finite_input",
        field: "tokensIn",
      },
      {
        name: "non-integer wins over negative",
        input: {
          harness: "claude",
          tokensIn: -1.5,
          cacheRead: Number.NaN,
          cacheCreate: 0,
        },
        reason: "non_integer_input",
        field: "tokensIn",
      },
      {
        name: "unsafe integer wins over negative",
        input: {
          harness: "codex",
          tokensIn: -(Number.MAX_SAFE_INTEGER + 1),
          cacheRead: Number.NaN,
          cacheCreate: 0,
        },
        reason: "unsafe_integer_input",
        field: "tokensIn",
      },
      {
        name: "an earlier negative field wins over a later non-finite field",
        input: {
          harness: "claude",
          tokensIn: -1,
          cacheRead: Number.NaN,
          cacheCreate: 0,
        },
        reason: "negative_input",
        field: "tokensIn",
      },
      {
        name: "cacheRead is checked before cacheCreate",
        input: {
          harness: "claude",
          tokensIn: 0,
          cacheRead: 1.25,
          cacheCreate: Number.NaN,
        },
        reason: "non_integer_input",
        field: "cacheRead",
      },
      {
        name: "cacheCreate is checked after valid earlier fields",
        input: {
          harness: "codex",
          tokensIn: 1,
          cacheRead: 0,
          cacheCreate: -1,
        },
        reason: "negative_input",
        field: "cacheCreate",
      },
    ] as const;

    for (const testCase of precedenceCases) {
      const before = { ...testCase.input };
      const result = normalizeHarnessUsage(testCase.input);
      assert.equal(result.status, "invalid", testCase.name);
      if (result.status !== "invalid") continue;
      assert.equal(result.reason, testCase.reason, testCase.name);
      assert.equal(result.field, testCase.field, testCase.name);
      assert.deepEqual(testCase.input, before, `${testCase.name}: input mutated`);
      assert.notEqual(result.raw, testCase.input, `${testCase.name}: raw aliases input`);
    }

    const unknownHarness = normalizeHarnessUsage({
      harness: "other",
      tokensIn: 1,
      cacheRead: 0,
      cacheCreate: 0,
    });
    assert.equal(unknownHarness.status, "unsupported");
    if (unknownHarness.status === "unsupported") {
      assert.equal(unknownHarness.reason, "unsupported_harness");
    }

    for (const input of [
      {
        harness: "claude",
        tokensIn: Number.MAX_SAFE_INTEGER,
        cacheRead: 1,
        cacheCreate: 0,
      },
      {
        harness: "claude",
        tokensIn: Number.MAX_SAFE_INTEGER - 1,
        cacheRead: 1,
        cacheCreate: 1,
      },
    ]) {
      const before = { ...input };
      const result = normalizeHarnessUsage(input);
      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") continue;
      assert.equal(result.reason, "derived_total_overflow");
      assert.deepEqual(result.raw, before);
      assert.deepEqual(input, before);
    }
  });
});
