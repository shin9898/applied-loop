import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRubricHint } from "./gate-hint";

describe("formatRubricHint", () => {
  it("lists criteria without revealing an answer", () => {
    const text = formatRubricHint([
      "ライフサイクル全体に触れている",
      "代替案との差がある",
    ]);
    assert.match(text, /採点観点/);
    assert.match(text, /1\. ライフサイクル/);
    assert.match(text, /2\. 代替案/);
    assert.doesNotMatch(text, /正解|答えは/);
  });

  it("falls back when empty", () => {
    const text = formatRubricHint([]);
    assert.match(text, /観点ヒントがまだ無い/);
  });
});
