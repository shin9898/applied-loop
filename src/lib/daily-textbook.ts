/**
 * 日次教科書 DB 操作 (server-only)。
 */

import "server-only";

import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";
import {
  chapterDidSummary,
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  dayDigest,
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
    overview: string;
    lines: string[];
    chapters: Array<{ index: number; title: string; summary: string }>;
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
        select: { index: true, title: true, oneLiner: true, bodyDeep: true },
      },
    },
  });
  return rows.map((r) => ({
    dateKey: r.dateKey,
    chapterCount: r.chapterCount,
    materialCount: r.materialCount,
    title: r.title,
    lead: r.lead,
    // その日の大枠（全章に触れる冒険者日記文）。日ページの先頭に出す
    overview: dayDigest(
      r.chapters.map((c) => ({
        title: c.title,
        oneLiner: c.oneLiner?.trim() || c.title,
      })),
    ),
    lines: r.chapters.map((c) => c.oneLiner?.trim() || c.title).filter(Boolean),
    // めくった先の日ページに「章タイトル＋やったこと要約」を出すための組
    chapters: r.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      summary:
        chapterDidSummary({
          oneLiner: c.oneLiner ?? "",
          action: parseLessonSlots(c.bodyDeep).action,
        }) || c.title,
    })),
  }));
}

/**
 * 材料（DevEvent）はあるのに、まだ教科書になっていない日。
 * 一覧画面の「未作成の日をまとめて教科書化」で使う。
 */
export async function listUngeneratedDays(
  days = 60,
): Promise<Array<{ dateKey: string; materialCount: number }>> {
  const { start } = dayRangeFromDateKey(dateKeyJST());
  const from = new Date(start.getTime() - (days - 1) * 86400000);
  const rows = await prisma.devEvent.findMany({
    where: { receivedAt: { gte: from } },
    select: { receivedAt: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = dateKeyJST(r.receivedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const existing = await prisma.dailyTextbook.findMany({
    where: { dateKey: { in: [...counts.keys()] } },
    select: { dateKey: true },
  });
  const written = new Set(existing.map((e) => e.dateKey));
  return [...counts.entries()]
    .filter(([dateKey]) => !written.has(dateKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, materialCount]) => ({ dateKey, materialCount }));
}

/**
 * 日次教科書が「材料を漏れなく拾えているか」(ADR-0020 §6-4)。
 * 圧縮で落とした droppedMaterialIds の割合が高いほど、その日は取りこぼしが多い。
 */
export async function listMaterialCaptureHealth(limit = 14): Promise<
  Array<{
    dateKey: string;
    materialCount: number;
    droppedCount: number;
  }>
> {
  const rows = await prisma.dailyTextbook.findMany({
    orderBy: { dateKey: "desc" },
    take: limit,
    select: { dateKey: true, materialCount: true, droppedMaterialIds: true },
  });
  return rows
    .map((r) => ({
      dateKey: r.dateKey,
      materialCount: r.materialCount,
      droppedCount: parseIds(r.droppedMaterialIds).length,
    }))
    .reverse();
}
