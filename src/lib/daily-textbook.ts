/**
 * 日次教科書 DB 操作 (server-only)。
 */

import "server-only";

import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";
import {
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  dayRangeFromDateKey,
  distillChecks,
  isMasteryState,
  parseLessonSlots,
  peakHourFromMaterials,
  type EvidenceLink,
  type MaterialRow,
  type MasteryState,
  type TextbookGenerateResult,
  type TextbookView,
} from "@/lib/daily-textbook-shared";

export * from "@/lib/daily-textbook-shared";

export async function loadMaterialsForDate(
  dateKey: string,
): Promise<MaterialRow[]> {
  const { start, end } = dayRangeFromDateKey(dateKey);
  const rows = await prisma.devEvent.findMany({
    where: { receivedAt: { gte: start, lt: end } },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      kind: true,
      repo: true,
      ref: true,
      summary: true,
      skipReason: true,
      receivedAt: true,
    },
  });
  return rows;
}

/** 指定日の Textbook を（再）生成して保存する。 */
export async function generateDailyTextbook(
  dateKey: string = dateKeyJST(),
): Promise<TextbookGenerateResult> {
  const materials = await loadMaterialsForDate(dateKey);
  const { chapters, droppedMaterialIds } =
    clusterMaterialsIntoChapters(materials);
  if (!chaptersHaveLessonSlots(chapters)) {
    throw new Error("generateDailyTextbook: lesson slots missing after cluster");
  }
  const checks = distillChecks(chapters);
  const peakHour = peakHourFromMaterials(materials);
  const title = `きょうのぼうけんのしょ — ${dateKey}`;
  const lead =
    materials.length === 0
      ? "この日の材料はまだない。実装の足跡が溜まると章が立つ。"
      : `材料 ${materials.length} 件 → 章 ${chapters.length}。新規も再圧縮も同じ規則で「なぜ／型／結果／別案」を埋める。磨くのは任意。`;

  const existing = await prisma.dailyTextbook.findUnique({
    where: { dateKey },
    select: { id: true },
  });
  if (existing) {
    await prisma.dailyTextbook.delete({ where: { id: existing.id } });
  }

  const textbook = await prisma.dailyTextbook.create({
    data: {
      dateKey,
      title,
      lead,
      status: "ready",
      materialCount: materials.length,
      chapterCount: chapters.length,
      peakHour,
      droppedMaterialIds: JSON.stringify(droppedMaterialIds),
      chapters: {
        create: chapters.map((ch) => ({
          index: ch.index,
          title: ch.title,
          oneLiner: ch.oneLiner,
          bodyPlain: ch.bodyPlain,
          bodyDeep: ch.bodyDeep,
          diagramKind: ch.diagramKind,
          evidenceJson: JSON.stringify(ch.evidence),
          materialIds: JSON.stringify(ch.materialIds),
        })),
      },
    },
    include: { chapters: { orderBy: { index: "asc" } } },
  });

  const chapterIdByIndex = new Map(
    textbook.chapters.map((c) => [c.index, c.id] as const),
  );

  if (checks.length > 0) {
    await prisma.dailyTextbookCheck.createMany({
      data: checks.map((ck) => ({
        textbookId: textbook.id,
        chapterId:
          ck.chapterIndex != null
            ? (chapterIdByIndex.get(ck.chapterIndex) ?? null)
            : null,
        index: ck.index,
        question: ck.question,
      })),
    });
  }

  return {
    dateKey,
    textbookId: textbook.id,
    materialCount: materials.length,
    chapterCount: chapters.length,
    checkCount: checks.length,
    droppedMaterialIds,
    peakHour,
  };
}

function parseEvidence(raw: string): EvidenceLink[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as EvidenceLink[]) : [];
  } catch {
    return [];
  }
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function loadDailyTextbook(
  dateKey: string,
): Promise<TextbookView | null> {
  const row = await prisma.dailyTextbook.findUnique({
    where: { dateKey },
    include: {
      chapters: { orderBy: { index: "asc" } },
      checks: { orderBy: { index: "asc" } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    dateKey: row.dateKey,
    title: row.title,
    lead: row.lead,
    materialCount: row.materialCount,
    chapterCount: row.chapterCount,
    peakHour: row.peakHour,
    droppedMaterialIds: parseIds(row.droppedMaterialIds),
    chapters: row.chapters.map((c) => {
      const slots = parseLessonSlots(c.bodyDeep);
      return {
        id: c.id,
        index: c.index,
        title: c.title,
        oneLiner: c.oneLiner,
        bodyPlain: c.bodyPlain,
        bodyDeep: c.bodyDeep,
        diagramKind: c.diagramKind,
        diagramBad:
          slots.diagramBad ??
          `「${c.title}」を動いた事実だけで終え、選定理由を残さない`,
        diagramOk:
          slots.diagramOk ??
          `「${c.title}」について採った一手・別案・結果を1セットで書く`,
        work:
          slots.work ||
          `「${c.title}」系の改修を進めていた。代表コミットから何を直していたかを復元せよ。`,
        timing:
          slots.timing ||
          `この日の材料として足跡が溜まったタイミングを、件数ときっかけから復元せよ。`,
        action:
          slots.action ||
          `対応: 「${c.title}」で実際に採った一手を1文で復元せよ。`,
        why:
          slots.why ||
          `その対応を採った理由を、代表コミットから1文で復元せよ。`,
        practice:
          slots.practice ||
          `ベストプラクティス: 代表コミットを開き、目的と採った形を固定してから次へ進む。`,
        consequence:
          slots.consequence ||
          `従うと: 翌日に『なぜこうなったか』を再発明せずに済む。`,
        alternative:
          slots.alternative ||
          `やりがちな別案: ログだけ残して選定は頭の中に置く。採らない理由: 根拠が消える。`,
        evidence: parseEvidence(c.evidenceJson),
        materialIds: parseIds(c.materialIds),
      };
    }),
    checks: row.checks.map((c) => ({
      id: c.id,
      index: c.index,
      chapterId: c.chapterId,
      question: c.question,
      mastery: c.mastery && isMasteryState(c.mastery) ? c.mastery : null,
      answeredAt: c.answeredAt?.toISOString() ?? null,
    })),
  };
}

export async function setCheckMastery(
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  await prisma.dailyTextbookCheck.update({
    where: { id: checkId },
    data: { mastery, answeredAt: new Date() },
  });
}

export async function listTextbookDates(limit = 14): Promise<
  Array<{
    dateKey: string;
    chapterCount: number;
    materialCount: number;
    title: string;
    lead: string | null;
    lines: string[];
  }>
> {
  const rows = await prisma.dailyTextbook.findMany({
    orderBy: { dateKey: "desc" },
    take: limit,
    select: {
      dateKey: true,
      chapterCount: true,
      materialCount: true,
      title: true,
      lead: true,
      chapters: {
        orderBy: { index: "asc" },
        take: 5,
        select: { title: true, oneLiner: true },
      },
    },
  });
  return rows.map((r) => ({
    dateKey: r.dateKey,
    chapterCount: r.chapterCount,
    materialCount: r.materialCount,
    title: r.title,
    lead: r.lead,
    lines: r.chapters.map((c) => c.oneLiner?.trim() || c.title).filter(Boolean),
  }));
}
