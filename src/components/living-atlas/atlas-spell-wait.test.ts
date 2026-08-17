import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleCharsForElapsed } from "./atlas-spell-wait";

describe("visibleCharsForElapsed", () => {
  it("t=0 では0文字", () => {
    assert.equal(visibleCharsForElapsed(0, 10, 140, 900), 0);
  });

  it("charIntervalMs ごとに1文字ずつ進む", () => {
    assert.equal(visibleCharsForElapsed(140, 10, 140, 900), 1);
    assert.equal(visibleCharsForElapsed(700, 10, 140, 900), 5);
  });

  it("全文表示後はholdMsの間、文字数が満了のまま止まる", () => {
    assert.equal(visibleCharsForElapsed(10 * 140, 10, 140, 900), 10);
    assert.equal(visibleCharsForElapsed(10 * 140 + 500, 10, 140, 900), 10);
  });

  it("1サイクル（タイピング+ホールド）を過ぎると0文字から再開する", () => {
    const cycle = 10 * 140 + 900;
    assert.equal(visibleCharsForElapsed(cycle, 10, 140, 900), 0);
    assert.equal(visibleCharsForElapsed(cycle + 140, 10, 140, 900), 1);
  });

  it("phraseLength が0以下なら常に0", () => {
    assert.equal(visibleCharsForElapsed(500, 0, 140, 900), 0);
    assert.equal(visibleCharsForElapsed(500, -1, 140, 900), 0);
  });
});
