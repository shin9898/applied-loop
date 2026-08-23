import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_TEXTBOOK_GATE_REFERENCE_CHARS,
  createTextbookCheckGateOriginV1,
  evaluateTextbookCheckPromotion,
  validateTextbookCheckGateOriginV1,
} from "./textbook-check-gate-origin";

const source = {
  sourceKind: "daily" as const,
  textbookKey: "2026-08-23",
  source: "auto" as const,
  checkIndex: 1,
  chapterIndex: 1,
  question: "なぜこの判断を選び、別案を採らなかったか説明してください。",
  chapter: {
    title: "証拠を先に固定する",
    oneLiner: "自己申告と検証済みの結果を混同しない。",
    bodyPlain: "raw counterを残し、derived evidenceはserver側で計算する。",
    evidence: [
      { kind: "adr", label: "ADR-0025", ref: "docs/adr/0025-hypothesis-driven-learning-harness.md" },
      { kind: "file", label: "normalizer", ref: "src/lib/harness-usage-normalization.ts" },
    ],
  },
};

test("A6-CG1-T1 creates a deterministic bounded origin without a user answer", () => {
  const first = createTextbookCheckGateOriginV1(source);
  const second = createTextbookCheckGateOriginV1({
    ...source,
    chapter: { ...source.chapter, bodyPlain: source.chapter.bodyPlain.repeat(100) },
  });

  assert.equal(first.gateKind, "textbook_check");
  assert.deepEqual(first.rubricCriteria, [
    "取り組みと判断を具体化している",
    "その判断の理由を説明している",
    "別案または次回への適用に触れている",
  ]);
  assert.equal(first.reference.schema, "textbook_check_gate_reference_v1");
  assert.equal(first.reference.sourceKind, "daily");
  assert.equal(first.reference.textbookKey, "2026-08-23");
  assert.equal(first.reference.checkIndex, 1);
  assert.equal(first.reference.chapterIndex, 1);
  assert.equal(first.reference.bodyPlain, source.chapter.bodyPlain);
  assert.deepEqual(first.reference.evidence, source.chapter.evidence);
  assert.match(first.sourceRevisionHash, /^[0-9a-f]{64}$/);
  assert.match(first.questionHash, /^[0-9a-f]{64}$/);
  assert.match(first.referenceHash, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.reference), true);
  assert.equal(JSON.stringify(first).includes("answer"), false);

  assert.equal(second.reference.bodyPlain.length, MAX_TEXTBOOK_GATE_REFERENCE_CHARS);
  assert.notEqual(second.sourceRevisionHash, first.sourceRevisionHash);
  assert.notEqual(second.referenceHash, first.referenceHash);
});

test("A6-CG1-T2 allows only explicit partial/stuck promotion candidates", () => {
  assert.deepEqual(evaluateTextbookCheckPromotion("partial"), { ok: true });
  assert.deepEqual(evaluateTextbookCheckPromotion("stuck"), { ok: true });
  assert.deepEqual(evaluateTextbookCheckPromotion("clear"), {
    ok: false,
    code: "not_actionable",
  });
  assert.deepEqual(evaluateTextbookCheckPromotion("parked"), {
    ok: false,
    code: "not_actionable",
  });
  assert.deepEqual(evaluateTextbookCheckPromotion(null), {
    ok: false,
    code: "not_actionable",
  });
  assert.deepEqual(evaluateTextbookCheckPromotion("forged"), {
    ok: false,
    code: "invalid_mastery",
  });
});

test("A6-CG3-T1 accepts only the exact immutable textbook origin used for grading", () => {
  const origin = createTextbookCheckGateOriginV1(source);
  const stored = {
    sourceKind: origin.reference.sourceKind,
    textbookKey: origin.reference.textbookKey,
    source: origin.reference.source,
    checkIndex: origin.reference.checkIndex,
    chapterIndex: origin.reference.chapterIndex,
    sourceRevisionHash: origin.sourceRevisionHash,
    questionHash: origin.questionHash,
    referenceHash: origin.referenceHash,
    referenceJson: JSON.stringify(origin.reference),
  };

  const valid = validateTextbookCheckGateOriginV1({ question: source.question, stored });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.origin.referenceHash, origin.referenceHash);
    assert.equal(valid.origin.questionHash, origin.questionHash);
  }

  assert.deepEqual(
    validateTextbookCheckGateOriginV1({
      question: `${source.question}（改変）`,
      stored,
    }),
    { ok: false, code: "invalid_origin" },
  );
  assert.deepEqual(
    validateTextbookCheckGateOriginV1({
      question: source.question,
      stored: {
        ...stored,
        referenceJson: JSON.stringify({ ...origin.reference, answer: "入力回答を混入させない" }),
      },
    }),
    { ok: false, code: "invalid_origin" },
  );
  assert.deepEqual(
    validateTextbookCheckGateOriginV1({
      question: source.question,
      stored: { ...stored, referenceHash: "0".repeat(64) },
    }),
    { ok: false, code: "invalid_origin" },
  );
});
