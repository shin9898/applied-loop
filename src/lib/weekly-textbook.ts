/**
 * 週のしょ DB 操作 (server-only)。
 *
 * 週のしょは「閉じた過去の週」のスナップショットなので、日次と違い
 * 再生成（regenerate）は無い。同一 weekKey に対する generateWeeklyTextbook は
 * 既存行があれば即 skip する（冪等）。cron・lazy フォールバックの両方から
 * 何度呼ばれても安全。
 */

import "server-only";

import { prisma } from "@/lib/db";
import {
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  distillChecks,
  isMasteryState,
  type MasteryState,
  type MaterialRow,
} from "@/lib/daily-textbook-shared";
import {
  buildWeeklyLead,
  buildWeeklyTitle,
  recentCompletedWeekRanges,
  type WeekRange,
} from "@/lib/weekly-textbook-shared";

async function loadUncoveredMaterialsForWeek(
  start: Date,
  end: Date,
): Promise<MaterialRow[]> {
  return prisma.devEvent.findMany({
    where: { receivedAt: { gte: start, lt: end }, incorporatedAt: null },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      kind: true,
      repo: true,
      ref: true,
      summary: true,
      skipReason: true,
      receivedAt: true,
      incorporatedAt: true,
    },
  });
}

/**
 * 指定週の週のしょを生成する。既に存在すれば何もせず skip を返す
 * （週は閉じているため、2回目以降の呼び出しは意味を持たない）。
 * 材料が0件の週は行を作らない（空の儀式を作らない）。
 */
export async function generateWeeklyTextbook(
  range: WeekRange,
): Promise<{
  skipped: boolean;
  weeklyId?: string;
  materialCount?: number;
  chapterCount?: number;
}> {
  const existing = await prisma.weeklyTextbook.findUnique({
    where: { weekKey: range.weekKey },
    select: { id: true },
  });
  if (existing) return { skipped: true, weeklyId: existing.id };

  const materials = await loadUncoveredMaterialsForWeek(range.start, range.end);
  if (materials.length === 0) return { skipped: true };

  const { chapters } = clusterMaterialsIntoChapters(materials);
  if (!chaptersHaveLessonSlots(chapters)) {
    throw new Error("generateWeeklyTextbook: lesson slots missing after cluster");
  }
  const checks = distillChecks(chapters);
  const title = buildWeeklyTitle(range.weekKey);
  const lead = buildWeeklyLead(materials.length, chapters.length);

  // create → checks の chapterId 解決 → incorporatedAt スタンプを1トランザクションに
  // まとめる（2026-08-17）。束ねないと、create 成功直後・checks/updateMany 実行前に
  // プロセスが落ちた場合、WeeklyTextbook 行は既に存在してしまい、次回呼び出しは
  // findUnique で既存行を検出して即 skip するだけになる（週のしょは delete→recreate
  // しない設計のため）。結果、確認問いが永久欠落／材料が実際は章に入っているのに
  // incorporatedAt が永久 null のまま残り、自己修復できなくなる。
  // 日次側 generateDailyTextbook（daily-textbook.ts）の $transaction パターンに倣う。
  const weeklyId = await prisma.$transaction(async (tx) => {
    const created = await tx.weeklyTextbook.create({
      data: {
        weekKey: range.weekKey,
        title,
        lead,
        status: "ready",
        materialCount: materials.length,
        chapterCount: chapters.length,
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
    });

    if (checks.length > 0) {
      const freshChapters = await tx.weeklyTextbookChapter.findMany({
        where: { weeklyId: created.id },
        select: { id: true, index: true },
      });
      const chapterIdByIndex = new Map(
        freshChapters.map((c) => [c.index, c.id] as const),
      );
      await tx.weeklyTextbookCheck.createMany({
        data: checks.map((ck) => ({
          weeklyId: created.id,
          chapterId:
            ck.chapterIndex != null
              ? (chapterIdByIndex.get(ck.chapterIndex) ?? null)
              : null,
          index: ck.index,
          question: ck.question,
        })),
      });
    }

    // 章に入った材料を「捕捉済み」にする。溢れた分（droppedMaterialIds）は
    // incorporatedAt を null のまま残す＝書庫のみで発見可能（spec L215）。
    // MaterialBand への書き込みは行わない（週のしょは「編纂」を持たない）。
    const keptIds = chapters.flatMap((ch) => ch.materialIds);
    if (keptIds.length > 0) {
      await tx.devEvent.updateMany({
        where: { id: { in: keptIds } },
        data: { incorporatedAt: new Date() },
      });
    }

    return created.id;
  });

  return {
    skipped: false,
    weeklyId,
    materialCount: materials.length,
    chapterCount: chapters.length,
  };
}

/**
 * 直近 `count` 週のうち、まだ週のしょが無い週をまとめて生成する。
 * cron が落ちていた期間があってもこれで埋まる（取りこぼしゼロ）。
 * `/retro` 訪問時に毎回呼ぶ想定。既存週は1クエリで skip されるため軽い。
 */
export async function ensureRecentWeeklyTextbooks(count = 8): Promise<void> {
  for (const range of recentCompletedWeekRanges(new Date(), count)) {
    const existing = await prisma.weeklyTextbook.findUnique({
      where: { weekKey: range.weekKey },
      select: { id: true },
    });
    if (existing) continue;
    await generateWeeklyTextbook(range);
  }
}

function parseEvidence(raw: string): Array<{ kind: string; label: string; url?: string; ref?: string }> {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as Array<{ kind: string; label: string; url?: string; ref?: string }>) : [];
  } catch {
    return [];
  }
}

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type WeeklyTextbookView = {
  id: string;
  weekKey: string;
  title: string;
  lead: string | null;
  materialCount: number;
  chapterCount: number;
  chapters: Array<{
    id: string;
    index: number;
    title: string;
    oneLiner: string;
    bodyPlain: string;
    bodyDeep: string | null;
    diagramKind: string;
    evidence: Array<{ kind: string; label: string; url?: string; ref?: string }>;
    materialIds: string[];
  }>;
  checks: Array<{
    id: string;
    index: number;
    chapterId: string | null;
    question: string;
    mastery: MasteryState | null;
    answeredAt: string | null;
  }>;
};

export async function loadWeeklyTextbook(
  weekKey: string,
): Promise<WeeklyTextbookView | null> {
  const row = await prisma.weeklyTextbook.findUnique({
    where: { weekKey },
    include: {
      chapters: { orderBy: { index: "asc" } },
      checks: { orderBy: { index: "asc" } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    weekKey: row.weekKey,
    title: row.title,
    lead: row.lead,
    materialCount: row.materialCount,
    chapterCount: row.chapterCount,
    chapters: row.chapters.map((c) => ({
      id: c.id,
      index: c.index,
      title: c.title,
      oneLiner: c.oneLiner,
      bodyPlain: c.bodyPlain,
      bodyDeep: c.bodyDeep,
      diagramKind: c.diagramKind,
      evidence: parseEvidence(c.evidenceJson),
      materialIds: parseIds(c.materialIds),
    })),
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

export async function loadLatestWeeklyTextbookSummary(): Promise<{
  weekKey: string;
  materialCount: number;
  chapterCount: number;
} | null> {
  return prisma.weeklyTextbook.findFirst({
    orderBy: { weekKey: "desc" },
    select: { weekKey: true, materialCount: true, chapterCount: true },
  });
}

export async function setWeeklyCheckMastery(
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  await prisma.weeklyTextbookCheck.update({
    where: { id: checkId },
    data: { mastery, answeredAt: new Date() },
  });
}
