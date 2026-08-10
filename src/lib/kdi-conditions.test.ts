import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kdiConditions } from "./kdi-conditions";

describe("kdiConditions", () => {
  it("splits by newline and middle dot", () => {
    assert.deepEqual(kdiConditions("Aをやる\nBを残す"), ["Aをやる", "Bを残す"]);
    assert.deepEqual(kdiConditions("条件1・条件2"), ["条件1", "条件2"]);
  });

  it("returns empty for blank", () => {
    assert.deepEqual(kdiConditions(null), []);
    assert.deepEqual(kdiConditions("  "), []);
  });
});
