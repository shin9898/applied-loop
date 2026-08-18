import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInboxTriageContext } from "./ukebako-view";

describe("buildInboxTriageContext", () => {
  it("未選択のときは仕分けを促す文言になる", () => {
    const context = buildInboxTriageContext("cap-1", "会議メモ", null);
    assert.match(context, /captureId: cap-1/);
    assert.match(context, /title: 「会議メモ」/);
    assert.match(context, /まだ えらばれておらぬ/);
    assert.doesNotMatch(context, /triage_inbox\(/);
  });

  it("さいよう選択時はtriage_inbox(accept)呼び出しの指示になる", () => {
    const context = buildInboxTriageContext("cap-2", "記事の要約", "accept");
    assert.match(
      context,
      /triage_inbox\(captureId: "cap-2", action: "accept"\) … さいよう/,
    );
  });

  it("みおくり選択時はtriage_inbox(skip)呼び出しの指示になる", () => {
    const context = buildInboxTriageContext("cap-3", "断片メモ", "skip");
    assert.match(
      context,
      /triage_inbox\(captureId: "cap-3", action: "skip"\) … みおくり/,
    );
  });
});
