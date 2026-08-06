/**
 * 出題品質の構造チェック（B11-1）。
 * LLM 呼び出しなしで「暗記クイズでないか」を機械判定する。
 */

export type GeneratedQuestionShape = {
  question?: string;
  principle?: string;
  target_concept?: string;
  targetConcept?: string;
  domain?: string;
  context_summary?: string;
  contextSummary?: string;
  rubric?: unknown;
  resources?: unknown;
  type?: string;
};

export type QuestionEvalIssue = {
  code: string;
  message: string;
};

export type QuestionEvalResult = {
  ok: boolean;
  issues: QuestionEvalIssue[];
};

const BLANK_FILL = /_{3,}|（\s*空欄\s*）|穴埋め/;
const MEMORIZATION =
  /この時の\s*Lesson|この変更の要点|何をしたか覚え|コミットメッセージを暗記/i;

/** 生成問いがコア基準を満たすか（代表 diff 回帰で共有） */
export function evaluateGeneratedQuestion(
  parsed: GeneratedQuestionShape | null | undefined,
): QuestionEvalResult {
  const issues: QuestionEvalIssue[] = [];
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      issues: [{ code: "missing", message: "問い JSON が無い" }],
    };
  }

  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  if (question.length < 20) {
    issues.push({ code: "question_short", message: "question が短すぎる" });
  }
  if (BLANK_FILL.test(question)) {
    issues.push({ code: "blank_fill", message: "穴埋め形式は禁止" });
  }
  if (MEMORIZATION.test(question)) {
    issues.push({ code: "memorization", message: "事例暗記クイズは禁止" });
  }

  const principle =
    (typeof parsed.principle === "string" && parsed.principle.trim()) ||
    (typeof parsed.target_concept === "string" && parsed.target_concept.trim()) ||
    (typeof parsed.targetConcept === "string" && parsed.targetConcept.trim()) ||
    "";
  if (principle.length < 10) {
    issues.push({ code: "principle_missing", message: "一般原則が無い／短い" });
  }

  const context =
    (typeof parsed.context_summary === "string" && parsed.context_summary.trim()) ||
    (typeof parsed.contextSummary === "string" && parsed.contextSummary.trim()) ||
    "";
  if (!context) {
    issues.push({ code: "context_missing", message: "context_summary が無い" });
  }

  const rubric = Array.isArray(parsed.rubric)
    ? parsed.rubric.filter((x) => typeof x === "string" && x.trim())
    : [];
  if (rubric.length < 1) {
    issues.push({ code: "rubric_missing", message: "rubric が空" });
  }
  if (rubric.length > 3) {
    issues.push({ code: "rubric_too_many", message: "rubric は最大3" });
  }

  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];
  const validResources = resources.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    const kind = typeof r.kind === "string" ? r.kind.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const ref = typeof r.ref === "string" ? r.ref.trim() : "";
    return (
      (kind === "doc" ||
        kind === "file" ||
        kind === "commit" ||
        kind === "adr") &&
      !!label &&
      !!ref
    );
  });
  if (validResources.length < 1) {
    issues.push({
      code: "resources_missing",
      message: "resources が空（doc/file/commit/adr が1件以上必要）",
    });
  }

  return { ok: issues.length === 0, issues };
}
