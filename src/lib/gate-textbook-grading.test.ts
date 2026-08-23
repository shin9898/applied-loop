import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGradingPrompt, resolveGateGradingSource } from "./gate";
import { createTextbookCheckGateOriginV1 } from "./textbook-check-gate-origin";

const origin = createTextbookCheckGateOriginV1({
  sourceKind: "daily",
  textbookKey: "2026-08-23",
  source: "auto",
  checkIndex: 1,
  chapterIndex: 1,
  question: "なぜこの判断を選び、別案を採らなかったか説明してください。",
  chapter: {
    title: "証拠を先に固定する",
    oneLiner: "自己申告と検証済みの結果を混同しない。",
    bodyPlain: "raw counterを残し、derived evidenceはserver側で計算する。",
    evidence: [{ kind: "adr", label: "ADR-0025", ref: "docs/adr/0025-hypothesis-driven-learning-harness.md" }],
  },
});

test("A6-CG3-T2 uses a verified textbook reference instead of a diff and preserves normal diff prompts", () => {
  const textbookPrompt = buildGradingPrompt({
    diff: "this diff must never be used for textbook grading",
    textbookReference: origin.reference,
    question: origin.question,
    answer: "判断の根拠を示し、別案との違いを説明する。",
    rubricCriteria: [...origin.rubricCriteria],
    goalsBlock: null,
  });
  assert.match(textbookPrompt, /教材参照/);
  assert.match(textbookPrompt, /<textbook_reference>/);
  assert.match(textbookPrompt, /証拠を先に固定する/);
  assert.doesNotMatch(textbookPrompt, /this diff must never be used/);
  assert.doesNotMatch(textbookPrompt, /<diff>/);

  const diffPrompt = buildGradingPrompt({
    diff: "diff --git a/example.ts b/example.ts",
    textbookReference: null,
    question: "なぜ変えたか説明してください。",
    answer: "確認した。",
    rubricCriteria: null,
    goalsBlock: null,
  });
  assert.match(diffPrompt, /以下の git diff/);
  assert.match(diffPrompt, /<diff>/);
  assert.match(diffPrompt, /diff --git a\/example\.ts/);
  assert.doesNotMatch(diffPrompt, /<textbook_reference>/);
});

test("A6-CG3-T3 fails closed before grading when a textbook origin or rubric no longer matches", () => {
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
  const accepted = resolveGateGradingSource({
    kind: "textbook_check",
    question: origin.question,
    rubricCriteria: JSON.stringify(origin.rubricCriteria),
    textbookCheckOrigin: stored,
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.deepEqual(accepted.rubricCriteria, origin.rubricCriteria);
    assert.equal(accepted.textbookReference?.chapterTitle, origin.reference.chapterTitle);
  }

  assert.deepEqual(
    resolveGateGradingSource({
      kind: "textbook_check",
      question: origin.question,
      rubricCriteria: JSON.stringify(["差し替えた観点"]),
      textbookCheckOrigin: stored,
    }),
    { ok: false, code: "invalid_textbook_origin" },
  );
  assert.deepEqual(
    resolveGateGradingSource({
      kind: "initial",
      question: "既存Gateの問い",
      rubricCriteria: null,
      textbookCheckOrigin: null,
    }),
    { ok: true, rubricCriteria: null, textbookReference: null },
  );
});
