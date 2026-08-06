import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateGeneratedQuestion } from "./gate-question-eval";

describe("evaluateGeneratedQuestion", () => {
  it("accepts a solid principle question", () => {
    const r = evaluateGeneratedQuestion({
      principle: "永続化の正しさは書き込みだけでなく読み戻しまで含めて確認する",
      question:
        "書き込み成功だけを見て完了とみなす設計のリスクを、別サービスの障害対応に転用して説明せよ。",
      context_summary: "DB 書き込み後に再読しない変更。",
      rubric: ["ライフサイクル全体に触れている", "代替案との差がある"],
      type: "transfer",
    });
    assert.equal(r.ok, true);
  });

  it("rejects blank-fill and missing principle", () => {
    const r = evaluateGeneratedQuestion({
      question: "この関数の戻り値は _____ である。",
      rubric: ["暗記"],
    });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === "blank_fill"));
    assert.ok(r.issues.some((i) => i.code === "principle_missing"));
  });
});
