import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInboxTriageContext, toFumiView } from "./ukebako-view";

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

  it("重複候補があるときはresolution付き2回目呼び出しを案内する（ADR-0021）", () => {
    const context = buildInboxTriageContext("cap-4", "誤解メモ", "accept", [
      { id: "m1", concept: "既存の誤解", relation: "duplicate", reason: "同じ内容" },
    ]);
    assert.match(context, /misconceptionId: m1 \(duplicate\) 「既存の誤解」— 同じ内容/);
    assert.match(
      context,
      /triage_inbox\(captureId: "cap-4", action: "accept", resolution: "create_new"\)/,
    );
    assert.match(
      context,
      /triage_inbox\(captureId: "cap-4", action: "accept", resolution: "link_existing", misconceptionId: "<上から選ぶ>"\)/,
    );
  });

  it("重複候補が空配列のときは従来どおりの文言のまま", () => {
    const context = buildInboxTriageContext("cap-5", "普通のメモ", null, []);
    assert.doesNotMatch(context, /にた ごかい/);
  });
});

describe("toFumiView needsDecision", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  it("defaults to false when not provided", () => {
    const view = toFumiView({ id: "c1", title: "t" }, now);
    assert.equal(view.needsDecision, false);
  });

  it("carries through true when the item needs a decision", () => {
    const view = toFumiView({ id: "c1", title: "t", needsDecision: true }, now);
    assert.equal(view.needsDecision, true);
  });
});
