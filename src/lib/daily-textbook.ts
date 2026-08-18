/**
 * 日次教科書 DB 操作 (server-only)。
 */

import "server-only";

import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";
import {
  chapterDidSummary,
  chapterHasLessonSlots,
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  dayDigest,
  dayRangeFromDateKey,
  distillChecks,
  distillSingleCheck,
  draftChapterFromRepo,
  groupMaterialsIntoBandDrafts,
  isMasteryState,
  nextCompiledIndex,
  parseLessonSlots,
  peakHourFromMaterials,
  TEXTBOOK_MAX_MATERIALS_PER_CHAPTER,
  type CheckDraft,
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
      incorporatedAt: true,
    },
  });
  return rows;
}

/** $transaction 内でも外でも使える最小の client 面（tx は $-系を持たない） */
type TextbookWriteClient = Pick<
  typeof prisma,
  "dailyTextbook" | "dailyTextbookChapter" | "dailyTextbookCheck"
>;

/**
 * 自動生成分の確認問いを作る。章 index → chapterId の解決を伴うため、
 * 章を作った直後（再生成では同じトランザクション内）で呼ぶ。
 */
async function createAutoChecks(
  client: TextbookWriteClient,
  textbookId: string,
  checks: CheckDraft[],
): Promise<void> {
  if (checks.length === 0) return;
  const freshChapters = await client.dailyTextbookChapter.findMany({
    where: { textbookId, source: "auto" },
    select: { id: true, index: true },
  });
  const chapterIdByIndex = new Map(
    freshChapters.map((c) => [c.index, c.id] as const),
  );
  await client.dailyTextbookCheck.createMany({
    data: checks.map((ck) => ({
      textbookId,
      chapterId:
        ck.chapterIndex != null
          ? (chapterIdByIndex.get(ck.chapterIndex) ?? null)
          : null,
      index: ck.index,
      question: ck.question,
      source: "auto",
    })),
  });
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

  let textbookId: string;
  if (existing) {
    textbookId = existing.id;
    const id = existing.id;
    // 削除→再作成を1トランザクションにまとめる（2026-08-17）。
    // 途中で落ちると「自動章を消したまま作り直せない日」が残り、UI からは
    // 再生成を押しても同じ所で落ち続けるため復旧手段が無くなる。
    await prisma.$transaction(async (tx) => {
      // source="compiled" の章・チェック（編纂で足したもの）は再圧縮の対象外。
      // 自動生成分だけを作り直す（2026-08-16、Phase1設計の核心）。
      await tx.dailyTextbookCheck.deleteMany({
        where: { textbookId: id, source: "auto" },
      });
      await tx.dailyTextbookChapter.deleteMany({
        where: { textbookId: id, source: "auto" },
      });
      await tx.dailyTextbook.update({
        where: { id },
        data: {
          title,
          lead,
          status: "ready",
          materialCount: materials.length,
          chapterCount: chapters.length,
          peakHour,
          droppedMaterialIds: JSON.stringify([]),
        },
      });
      await tx.dailyTextbookChapter.createMany({
        data: chapters.map((ch) => ({
          textbookId: id,
          index: ch.index,
          title: ch.title,
          oneLiner: ch.oneLiner,
          bodyPlain: ch.bodyPlain,
          bodyDeep: ch.bodyDeep,
          diagramKind: ch.diagramKind,
          evidenceJson: JSON.stringify(ch.evidence),
          materialIds: JSON.stringify(ch.materialIds),
          source: "auto",
        })),
      });
      await createAutoChecks(tx, id, checks);
    });
  } else {
    const created = await prisma.dailyTextbook.create({
      data: {
        dateKey,
        title,
        lead,
        status: "ready",
        materialCount: materials.length,
        chapterCount: chapters.length,
        peakHour,
        droppedMaterialIds: JSON.stringify([]),
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
            source: "auto",
          })),
        },
      },
    });
    textbookId = created.id;
    await createAutoChecks(prisma, textbookId, checks);
  }

  // あふれた材料を repo 単位で帯へ保存する（2026-08-16、取りこぼし対応）。
  // 既に章へ組み込み済み（incorporatedAt あり＝過去の編纂などで救済済み）の材料は
  // あふれとして数え直さない。これを混ぜると、編纂済みの帯が新しいあふれで
  // 上書きされても compiledChapterId が残り、UI が「対応済み」として隠してしまう
  // （＝二度と拾えない材料が生まれる。2026-08-17）。
  const droppedSet = new Set(droppedMaterialIds);
  const droppedMaterials = materials.filter(
    (m) => droppedSet.has(m.id) && m.incorporatedAt == null,
  );
  const bandDrafts = groupMaterialsIntoBandDrafts(droppedMaterials);
  for (const band of bandDrafts) {
    await prisma.materialBand.upsert({
      where: { dateKey_repo: { dateKey, repo: band.repo } },
      update: {
        materialIds: JSON.stringify(band.materialIds),
        digest: band.digest,
        count: band.count,
        // 中身が入れ替わった帯は「編纂済み」ではない。未捕捉のあふれが残っている
        // 以上、もう一度編纂できる状態に戻す（章そのものは消さない）。
        compiledChapterId: null,
        // 再びあふれが発生した以上「解決済み」ではない（2026-08-17、書庫の物理削除撤回）。
        resolvedAt: null,
      },
      create: {
        dateKey,
        repo: band.repo,
        materialIds: JSON.stringify(band.materialIds),
        digest: band.digest,
        count: band.count,
      },
    });
  }
  // 未捕捉のあふれが1件も残らなくなった repo の帯は「解決済み」にする。
  // 中身が全部どこかの章に入っている帯を「編纂待ち」として並べても意味がないが、
  // 物理削除はしない（書庫が全期間検索できるという設計を守るため。2026-08-17）。
  const openRepos = bandDrafts.map((b) => b.repo);
  await prisma.materialBand.updateMany({
    where:
      openRepos.length > 0 ? { dateKey, repo: { notIn: openRepos } } : { dateKey },
    data: { resolvedAt: new Date() },
  });

  // 章に入った（kept）材料を「捕捉済み」として記録する（2026-08-16）
  const keptIds = chapters.flatMap((ch) => ch.materialIds);
  if (keptIds.length > 0) {
    await prisma.devEvent.updateMany({
      where: { id: { in: keptIds } },
      data: { incorporatedAt: new Date() },
    });
  }

  return {
    dateKey,
    textbookId,
    materialCount: materials.length,
    chapterCount: chapters.length,
    checkCount: checks.length,
    droppedMaterialIds,
    peakHour,
  };
}

/** よみもの帯を、今日の教科書に追加章として編纂する（2026-08-16） */
export async function compileMaterialBand(
  bandId: string,
): Promise<{ chapterId: string; dateKey: string }> {
  const band = await prisma.materialBand.findUnique({ where: { id: bandId } });
  if (!band) throw new Error(`compileMaterialBand: band not found: ${bandId}`);
  if (band.compiledChapterId) {
    return { chapterId: band.compiledChapterId, dateKey: band.dateKey };
  }

  const ids: string[] = JSON.parse(band.materialIds);
  const events = await prisma.devEvent.findMany({
    where: { id: { in: ids } },
    orderBy: { receivedAt: "desc" },
  });
  const materials: MaterialRow[] = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    repo: e.repo,
    ref: e.ref,
    summary: e.summary,
    skipReason: e.skipReason,
    receivedAt: e.receivedAt,
    incorporatedAt: e.incorporatedAt,
  }));

  const kept = materials.slice(0, TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
  const overflow = materials.slice(TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);

  let textbook = await prisma.dailyTextbook.findUnique({
    where: { dateKey: band.dateKey },
  });
  if (!textbook) {
    await generateDailyTextbook(band.dateKey);
    textbook = await prisma.dailyTextbook.findUnique({
      where: { dateKey: band.dateKey },
    });
    if (!textbook) throw new Error("compileMaterialBand: textbook creation failed");
  }

  // 採番は compiled 専用レンジ（>= COMPILED_INDEX_BASE）で閉じる。自動章の index は
  // 再生成のたびに 1..TEXTBOOK_MAX_CHAPTERS の範囲で伸び縮みするので、
  // 「編纂時点の全章 MAX + 1」で取ると後から自動側がそこまで伸びて
  // @@unique([textbookId, index]) で衝突する（2026-08-17、C1）。
  const maxIndex = await prisma.dailyTextbookChapter.aggregate({
    where: { textbookId: textbook.id, source: "compiled" },
    _max: { index: true },
  });
  const nextIndex = nextCompiledIndex(maxIndex._max.index);

  const draft = draftChapterFromRepo(nextIndex, band.repo, kept, overflow);
  if (!chapterHasLessonSlots(draft)) {
    throw new Error("compileMaterialBand: lesson slots missing");
  }

  const chapter = await prisma.dailyTextbookChapter.create({
    data: {
      textbookId: textbook.id,
      index: draft.index,
      title: draft.title,
      oneLiner: draft.oneLiner,
      bodyPlain: draft.bodyPlain,
      bodyDeep: draft.bodyDeep,
      diagramKind: draft.diagramKind,
      evidenceJson: JSON.stringify(draft.evidence),
      materialIds: JSON.stringify(draft.materialIds),
      source: "compiled",
    },
  });

  // チェックも同じ理由で compiled 専用レンジに隔離する（自動側は 1..7）。
  const maxCheckIndex = await prisma.dailyTextbookCheck.aggregate({
    where: { textbookId: textbook.id, source: "compiled" },
    _max: { index: true },
  });
  const check = distillSingleCheck(draft);
  await prisma.dailyTextbookCheck.create({
    data: {
      textbookId: textbook.id,
      chapterId: chapter.id,
      index: nextCompiledIndex(maxCheckIndex._max.index),
      question: check.question,
      source: "compiled",
    },
  });

  await prisma.devEvent.updateMany({
    where: { id: { in: kept.map((m) => m.id) } },
    data: { incorporatedAt: new Date() },
  });
  await prisma.materialBand.update({
    where: { id: band.id },
    data: { compiledChapterId: chapter.id },
  });

  return { chapterId: chapter.id, dateKey: band.dateKey };
}

/** 指定日の帯（未編纂・編纂済み双方）を新しい順で返す */
export async function loadMaterialBandsForDate(dateKey: string): Promise<
  Array<{
    id: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
    createdAt: Date;
  }>
> {
  return prisma.materialBand.findMany({
    where: { dateKey },
    orderBy: { count: "desc" },
    select: {
      id: true,
      repo: true,
      digest: true,
      count: true,
      compiledChapterId: true,
      createdAt: true,
    },
  });
}

/** 書庫: 全期間の帯を検索する（読む前提ゼロ・引く時に引く） */
export async function loadMaterialArchive(query?: string): Promise<
  Array<{
    id: string;
    dateKey: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
  }>
> {
  const rows = await prisma.materialBand.findMany({
    where: query
      ? {
          OR: [
            { repo: { contains: query } },
            { digest: { contains: query } },
          ],
        }
      : undefined,
    orderBy: { dateKey: "desc" },
    take: 200,
    select: {
      id: true,
      dateKey: true,
      repo: true,
      digest: true,
      count: true,
      compiledChapterId: true,
    },
  });
  return rows;
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
          title: c.title,
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
 * incorporatedAt が付いた（章・編纂・週のしょのいずれかに組み込まれた）
 * 材料の割合で測る。編纂すればその日の数値も遡って改善する（生きた指標。
 * 2026-08-16、生成時スナップショットのdroppedMaterialIdsから移行）。
 */
export async function listMaterialCaptureHealth(limit = 14): Promise<
  Array<{
    dateKey: string;
    materialCount: number;
    droppedCount: number;
  }>
> {
  const textbooks = await prisma.dailyTextbook.findMany({
    orderBy: { dateKey: "desc" },
    take: limit,
    select: { dateKey: true },
  });
  const results: Array<{ dateKey: string; materialCount: number; droppedCount: number }> = [];
  for (const tb of textbooks) {
    const { start, end } = dayRangeFromDateKey(tb.dateKey);
    const [materialCount, incorporatedCount] = await Promise.all([
      prisma.devEvent.count({
        where: { receivedAt: { gte: start, lt: end } },
      }),
      prisma.devEvent.count({
        where: {
          receivedAt: { gte: start, lt: end },
          incorporatedAt: { not: null },
        },
      }),
    ]);
    results.push({
      dateKey: tb.dateKey,
      materialCount,
      droppedCount: materialCount - incorporatedCount,
    });
  }
  return results.reverse();
}
