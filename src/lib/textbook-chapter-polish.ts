/**
 * 日次教科書の章単位 LLM 研磨（ADR-0020）。
 * 入力は1章分のみ。失敗時は規則文を維持する。
 */

import "server-only";

import { prisma } from "@/lib/db";
import { HeadlessLLMError, parseLLMJson, runHeadlessLLM } from "@/lib/headless-llm";
import {
  encodeLessonMarkers,
  parseLessonSlots,
  type EvidenceLink,
  type LessonSlots,
} from "@/lib/daily-textbook-shared";
import { buildPolishPrompt } from "@/lib/textbook-chapter-polish-shared";

export type PolishChapterResult =
  | { ok: true; chapterId: string }
  | { ok: false; chapterId: string; error: string; keptRule: true };

export { buildPolishPrompt } from "@/lib/textbook-chapter-polish-shared";

type PolishJson = {
  work?: unknown;
  timing?: unknown;
  action?: unknown;
  why?: unknown;
  practice?: unknown;
  consequence?: unknown;
  alternative?: unknown;
  diagramBad?: unknown;
  diagramOk?: unknown;
  bodyFacts?: unknown;
};

function asNonEmpty(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function rebuildBodies(input: {
  nameLine: string;
  bodyFacts: string;
  lessons: LessonSlots;
  diagramBad: string;
  diagramOk: string;
  metaTail: string;
}): { bodyPlain: string; bodyDeep: string } {
  const facts = input.bodyFacts.trim() || "・（要約なし）";
  const bodyPlain = [
    input.nameLine,
    "",
    "いま進めていた改修:",
    input.lessons.work,
    facts.startsWith("・") ? facts : `・${facts}`,
    "",
    "ナレッジが溜まったタイミング:",
    input.lessons.timing,
    "",
    "とった対応:",
    input.lessons.action,
    "",
    "その理由:",
    input.lessons.why,
    "",
    "ベストプラクティス:",
    input.lessons.practice,
    "",
    "従うとどうなる:",
    input.lessons.consequence,
    "",
    "やりがちな別案:",
    input.lessons.alternative,
    "",
    "覚える一手: 改修→対応→理由→型 の順で1文にする。",
  ].join("\n");

  const bodyDeep = [
    bodyPlain,
    "",
    input.metaTail,
    "",
    encodeLessonMarkers({
      work: input.lessons.work,
      timing: input.lessons.timing,
      action: input.lessons.action,
      why: input.lessons.why,
      practice: input.lessons.practice,
      consequence: input.lessons.consequence,
      alternative: input.lessons.alternative,
      diagramBad: input.diagramBad,
      diagramOk: input.diagramOk,
    }),
  ]
    .filter(Boolean)
    .join("\n");

  return { bodyPlain, bodyDeep };
}

export async function polishTextbookChapter(
  chapterId: string,
): Promise<PolishChapterResult> {
  const chapter = await prisma.dailyTextbookChapter.findUnique({
    where: { id: chapterId },
    include: { textbook: { select: { id: true, dateKey: true } } },
  });
  if (!chapter) {
    return {
      ok: false,
      chapterId,
      error: "章が見つからない",
      keptRule: true,
    };
  }

  let evidence: EvidenceLink[] = [];
  try {
    const v = JSON.parse(chapter.evidenceJson) as unknown;
    if (Array.isArray(v)) evidence = v as EvidenceLink[];
  } catch {
    evidence = [];
  }

  let materialIds: string[] = [];
  try {
    const v = JSON.parse(chapter.materialIds) as unknown;
    if (Array.isArray(v)) {
      materialIds = v.filter((x): x is string => typeof x === "string");
    }
  } catch {
    materialIds = [];
  }

  const materials = materialIds.length
    ? await prisma.devEvent.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, summary: true },
      })
    : [];
  const idSet = new Set(materialIds);
  const materialSummaries = materials
    .filter((m) => idSet.has(m.id))
    .map((m) => m.summary?.trim() || m.id.slice(0, 8))
    .filter(Boolean);

  const slots = parseLessonSlots(chapter.bodyDeep);
  const lessons: LessonSlots = {
    work: slots.work || "（改修が未記入）",
    timing: slots.timing || "（タイミングが未記入）",
    action: slots.action || "（対応が未記入）",
    why: slots.why || "（理由が未記入）",
    practice: slots.practice || "（型が未記入）",
    consequence: slots.consequence || "（結果が未記入）",
    alternative: slots.alternative || "（別案が未記入）",
  };
  const diagramBad = slots.diagramBad || chapter.title;
  const diagramOk = slots.diagramOk || chapter.title;

  const prompt = buildPolishPrompt({
    title: chapter.title,
    oneLiner: chapter.oneLiner,
    diagramKind: chapter.diagramKind,
    lessons,
    diagramBad,
    diagramOk,
    evidence: evidence.map((e) => ({
      label: e.label,
      ref: e.ref,
      url: e.url,
    })),
    materialSummaries,
  });

  if (prompt.includes("日次全材料") || prompt.includes("全章")) {
    return {
      ok: false,
      chapterId,
      error: "研磨プロンプトが不正",
      keptRule: true,
    };
  }

  let parsed: PolishJson | null;
  try {
    parsed = parseLLMJson<PolishJson>(await runHeadlessLLM(prompt));
  } catch (e) {
    const msg =
      e instanceof HeadlessLLMError
        ? e.message
        : e instanceof Error
          ? e.message
          : "LLM 失敗";
    console.warn(`[textbook-polish] chapter ${chapterId}: ${msg}`);
    return { ok: false, chapterId, error: msg, keptRule: true };
  }
  if (!parsed) {
    console.warn(`[textbook-polish] chapter ${chapterId}: JSON パース失敗`);
    return { ok: false, chapterId, error: "JSON パース失敗", keptRule: true };
  }

  const nextLessons: LessonSlots = {
    work: asNonEmpty(parsed.work, lessons.work),
    timing: asNonEmpty(parsed.timing, lessons.timing),
    action: asNonEmpty(parsed.action, lessons.action),
    why: asNonEmpty(parsed.why, lessons.why),
    practice: asNonEmpty(parsed.practice, lessons.practice),
    consequence: asNonEmpty(parsed.consequence, lessons.consequence),
    alternative: asNonEmpty(parsed.alternative, lessons.alternative),
  };
  const nextBad = asNonEmpty(parsed.diagramBad, diagramBad);
  const nextOk = asNonEmpty(parsed.diagramOk, diagramOk);

  const nameLine =
    chapter.bodyPlain.match(/^場所:.*$/m)?.[0] ??
    `場所: 章${chapter.index}`;
  const metaTail = [
    chapter.bodyDeep?.match(/^主題タグ:.*$/m)?.[0],
    chapter.bodyDeep?.match(/^skipReason:.*$/m)?.[0],
    chapter.bodyDeep?.match(/^章予算超え.*$/m)?.[0],
    chapter.bodyDeep?.match(/^材料 ID:.*$/m)?.[0],
  ]
    .filter(Boolean)
    .join("\n");

  const factsFromBody =
    chapter.bodyPlain
      .split("いま進めていた改修:")[1]
      ?.split("ナレッジが溜まったタイミング:")[0]
      ?.split("\n")
      .filter((l) => l.startsWith("・"))
      .join("\n")
      .trim() ||
    chapter.bodyPlain
      .split("今日やったこと:")[1]
      ?.split("なぜこの一手か:")[0]
      ?.trim() ||
    "";
  const bodyFacts = asNonEmpty(parsed.bodyFacts, factsFromBody);

  const { bodyPlain, bodyDeep } = rebuildBodies({
    nameLine,
    bodyFacts,
    lessons: nextLessons,
    diagramBad: nextBad,
    diagramOk: nextOk,
    metaTail,
  });

  await prisma.dailyTextbookChapter.update({
    where: { id: chapterId },
    data: { bodyPlain, bodyDeep },
  });

  return { ok: true, chapterId };
}
