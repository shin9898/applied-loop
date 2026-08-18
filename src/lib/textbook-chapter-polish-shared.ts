/**
 * 章研磨プロンプト組み立て（client / test 可）。DB・LLM は textbook-chapter-polish.ts。
 */

import type { LessonSlots } from "@/lib/daily-textbook-shared";

export type PolishPromptInput = {
  title: string;
  oneLiner: string;
  diagramKind: string;
  lessons: LessonSlots;
  diagramBad: string;
  diagramOk: string;
  evidence: Array<{ label: string; ref?: string; url?: string }>;
  /** 章に紐づく材料要約のみ（他章・全日分は混ぜない） */
  materialSummaries: string[];
};

/** 単体テスト用: プロンプトに1章以外が混ざらないことを検証しやすくする */
export function buildPolishPrompt(input: PolishPromptInput): string {
  const evidenceLines = input.evidence
    .slice(0, 5)
    .map(
      (e) =>
        `- ${e.label}${e.ref ? ` ref=${e.ref}` : ""}${e.url ? ` ${e.url}` : ""}`,
    )
    .join("\n");
  const mats = input.materialSummaries
    .slice(0, 8)
    .map((s) => `- ${s}`)
    .join("\n");

  return [
    "あなたは実務エンジニア向けの日次教科書編集者である。",
    "次の1章だけを、物語順の教科書として厚く磨き直せ。他章・日次全量・diff 全文は持っていないし、捏造しない。",
    "物語順: 改修 → タイミング → 対応 → 理由 → 一般化（型／結果／別案）。",
    "出力は JSON オブジェクトのみ。キー:",
    "work, timing, action, why, practice, consequence, alternative, diagramBad, diagramOk, bodyFacts, oneLiner",
    "各値は日本語の短文（1〜3文）。コードブロックや前置きは禁止。",
    "work=いま進めていた改修 / timing=ナレッジが溜まったタイミング / action=とった対応 / why=その理由",
    "practice=ベストプラクティス / consequence=従うとどうなる / alternative=やりがちな別案と採らない理由",
    "diagramBad/Ok は技術選定の対比（態度の説教ではない）。",
    "bodyFacts は足跡の箇条書きのみ（スロット見出しは含めない）。",
    "oneLiner=にっきの1ページ要約に使う1〜2文の自然な日本語。実際に何をしたかを地の文で書け。" +
      "英語のコミット文でも意味を読み取って日本語で説明してよい。" +
      "conventional commitの記法（type(scope):）やPR番号・角括弧タグはそのまま繰り返さない。",
    "",
    `title: ${input.title}`,
    `oneLiner: ${input.oneLiner}`,
    `diagramKind: ${input.diagramKind}`,
    "現行スロット:",
    `work: ${input.lessons.work}`,
    `timing: ${input.lessons.timing}`,
    `action: ${input.lessons.action}`,
    `why: ${input.lessons.why}`,
    `practice: ${input.lessons.practice}`,
    `consequence: ${input.lessons.consequence}`,
    `alternative: ${input.lessons.alternative}`,
    `BAD: ${input.diagramBad}`,
    `OK: ${input.diagramOk}`,
    "evidence:",
    evidenceLines || "- (none)",
    "material summaries (this chapter only):",
    mats || "- (none)",
  ].join("\n");
}
