import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGatesSupplyState } from "./gates-supply";

describe("resolveGatesSupplyState", () => {
  it("has_items when list non-empty", () => {
    const s = resolveGatesSupplyState({
      itemCount: 2,
      everHadGate: true,
      gitHookInstalled: true,
      genFailures: { auth: 0, other: 0 },
    });
    assert.equal(s.kind, "has_items");
  });

  it("no_hook when never had gate and no hook", () => {
    const s = resolveGatesSupplyState({
      itemCount: 0,
      everHadGate: false,
      gitHookInstalled: false,
      genFailures: { auth: 0, other: 0 },
    });
    assert.equal(s.kind, "no_hook");
  });

  it("gen_failed_auth takes priority over waiting", () => {
    const s = resolveGatesSupplyState({
      itemCount: 0,
      everHadGate: false,
      gitHookInstalled: true,
      genFailures: { auth: 1, other: 2 },
    });
    assert.equal(s.kind, "gen_failed_auth");
  });
});
