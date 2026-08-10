/**
 * 日次教科書 (ADR-0020)。
 * Material = DevEvent 全量（cap で捨てない）。
 * Textbook = 圧縮ビュー。じゅもん注入は開いている1章＋URLのみ。
 */

import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";

export const TEXTBOOK_MAX_CHAPTERS = 5;
export const TEXTBOOK_MAX_MATERIALS_PER_CHAPTER = 8;
export const TEXTBOOK_MAX_EVIDENCE_URLS = 5;
/** じゅもん注入の文字数上限（章本文・diff 全量は入れない） */
export const JUMON_CONTEXT_MAX_CHARS = 900;

export const MASTERY_STATES = ["clear", "partial", "stuck", "parked"] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export type EvidenceLink = {
  kind: "commit" | "doc" | "file" | "other";
  label: string;
  url?: string;
  ref?: string;
};

export type MaterialRow = {
  id: string;
  kind: string;
  repo: string;
  ref: string;
  summary: string | null;
  skipReason: string | null;
  receivedAt: Date;
};

export type ChapterDraft = {
  index: number;
  title: string;
  oneLiner: string;
  bodyPlain: string;
  bodyDeep: string;
  diagramKind: "silent_gap" | "drift" | "prefix" | "generic";
  evidence: EvidenceLink[];
  materialIds: string[];
};

export type CheckDraft = {
  index: number;
  chapterIndex: number | null;
  question: string;
};

export type TextbookGenerateResult = {
  dateKey: string;
  textbookId: string;
  materialCount: number;
  chapterCount: number;
  checkCount: number;
  droppedMaterialIds: string[];
  peakHour: number | null;
};

export function isMasteryState(v: string): v is MasteryState {
  return (MASTERY_STATES as readonly string[]).includes(v);
}

/** dateKey ("2026-08-10") の JST 日レンジ [start, end)。 */
export function dayRangeFromDateKey(dateKey: string): {
  start: Date;
  end: Date;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`invalid dateKey: ${dateKey}`);
  }
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

function repoShort(repo: string): string {
  const parts = repo.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || repo;
}

function hourJST(d: Date): number {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

export function peakHourFromMaterials(materials: MaterialRow[]): number | null {
  if (materials.length === 0) return null;
  const counts = new Array<number>(24).fill(0);
  for (const m of materials) counts[hourJST(m.receivedAt)] += 1;
  let best = 0;
  for (let h = 1; h < 24; h++) if (counts[h] > counts[best]) best = h;
  return best;
}

function diagramFor(materials: MaterialRow[]): ChapterDraft["diagramKind"] {
  const hasBacklog = materials.some((m) => m.skipReason === "backlog");
  if (hasBacklog) return "silent_gap";
  const kinds = new Set(materials.map((m) => m.kind));
  if (kinds.size > 1) return "drift";
  const text = materials.map((m) => `${m.summary ?? ""} ${m.ref}`).join(" ");
  if (/prefix|cache|harness/i.test(text)) return "prefix";
  return "generic";
}

function evidenceFrom(materials: MaterialRow[]): EvidenceLink[] {
  const out: EvidenceLink[] = [];
  for (const m of materials) {
    if (out.length >= TEXTBOOK_MAX_EVIDENCE_URLS) break;
    const short = m.ref.length > 12 ? `${m.ref.slice(0, 7)}…` : m.ref;
    out.push({
      kind: m.kind === "commit" ? "commit" : "other",
      label: `${repoShort(m.repo)} ${short}`,
      ref: m.ref,
    });
  }
  return out;
}

/**
 * 材料を repo 単位で章に圧縮。超過は dropped に残す（捨てない＝証跡）。
 */
export function clusterMaterialsIntoChapters(
  materials: MaterialRow[],
): { chapters: ChapterDraft[]; droppedMaterialIds: string[] } {
  const byRepo = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    const list = byRepo.get(m.repo) ?? [];
    list.push(m);
    byRepo.set(m.repo, list);
  }

  const repos = [...byRepo.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const chapters: ChapterDraft[] = [];
  const droppedMaterialIds: string[] = [];

  for (const [repo, rows] of repos) {
    if (chapters.length >= TEXTBOOK_MAX_CHAPTERS) {
      droppedMaterialIds.push(...rows.map((r) => r.id));
      continue;
    }
    const sorted = [...rows].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
    const kept = sorted.slice(0, TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
    const overflow = sorted.slice(TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
    droppedMaterialIds.push(...overflow.map((r) => r.id));

    const backlogN = kept.filter((m) => m.skipReason === "backlog").length;
    const summaries = kept
      .map((m) => m.summary?.trim())
      .filter((s): s is string => Boolean(s))
      .slice(0, 3);
    const name = repoShort(repo);
    const oneLiner =
      backlogN > 0
        ? `${name} で ${kept.length} 件の足跡。うち ${backlogN} 件は即時しれんを止めつつ材料として残った。`
        : `${name} で ${kept.length} 件の実装の足跡が残った。`;

    const bodyPlain = [
      `この章は ${name} の今日の材料を圧縮したものじゃ。`,
      summaries.length
        ? `代表: ${summaries.map((s) => `「${s}」`).join(" / ")}`
        : `参照: ${kept.map((m) => m.ref.slice(0, 7)).join(", ")}`,
      backlogN > 0
        ? `即時しれんは backlog で止まったが、材料は消えておらぬ（ADR-0020）。`
        : `覚える一手: 一次情報（commit）を開き、自分の言葉で1行説明する。`,
    ].join("\n");

    const bodyDeep = [
      bodyPlain,
      "",
      `材料 ID（章内）: ${kept.map((m) => m.id.slice(0, 8)).join(", ")}`,
      overflow.length
        ? `章予算超えで畳んだ材料: ${overflow.length} 件（dropped 証跡へ）`
        : "",
      `skipReason 内訳: ${summarizeSkip(kept)}`,
    ]
      .filter(Boolean)
      .join("\n");

    chapters.push({
      index: chapters.length + 1,
      title: `${name} の足跡`,
      oneLiner,
      bodyPlain,
      bodyDeep,
      diagramKind: diagramFor(kept),
      evidence: evidenceFrom(kept),
      materialIds: kept.map((m) => m.id),
    });
  }

  return { chapters, droppedMaterialIds };
}

function summarizeSkip(materials: MaterialRow[]): string {
  const counts = new Map<string, number>();
  for (const m of materials) {
    const k = m.skipReason ?? "fired_or_none";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(", ") || "なし";
}

/** 章あたり最大1問＋横断1問。合計は 3〜7 に収める。 */
export function distillChecks(chapters: ChapterDraft[]): CheckDraft[] {
  if (chapters.length === 0) return [];
  const checks: CheckDraft[] = [];
  for (const ch of chapters.slice(0, 5)) {
    checks.push({
      index: checks.length + 1,
      chapterIndex: ch.index,
      question: `「${ch.title}」を、同僚に30秒で説明するとしたら何と言う？（ひとこと＋なぜ今日残ったか）`,
    });
  }
  if (checks.length < 3 && chapters[0]) {
    checks.push({
      index: checks.length + 1,
      chapterIndex: chapters[0].index,
      question: `今日の材料のうち、明日もう一度開く一次情報はどれか？理由付きで1つ。`,
    });
  }
  if (chapters.length >= 2) {
    checks.push({
      index: checks.length + 1,
      chapterIndex: null,
      question:
        "今日の章をまたいで、いちばん重要な学びを1文で。どの章の材料が根拠かも含めて。",
    });
  }
  return checks.slice(0, 7);
}

/**
 * じゅもん注入コンテキスト。開いている1章＋ひとこと＋URL/ref のみ。
 * 日次全量・diff 本文・他章は入れない。
 */
export function buildJumonContext(input: {
  dateKey: string;
  depth: "plain" | "deep";
  chapter: Pick<
    ChapterDraft,
    "index" | "title" | "oneLiner" | "evidence"
  > & { bodyPlain?: string; bodyDeep?: string };
}): string {
  const urls = input.chapter.evidence
    .map((e) => e.url || e.ref || e.label)
    .filter(Boolean)
    .slice(0, TEXTBOOK_MAX_EVIDENCE_URLS);
  const lines = [
    `【きょうのしょ】${input.dateKey} 章${input.chapter.index}: ${input.chapter.title}`,
    `ひとこと: ${input.chapter.oneLiner}`,
    `深さ: ${input.depth === "deep" ? "実務" : "初学者"}`,
    urls.length ? `一次情報:` : null,
    ...urls.map((u) => `- ${u}`),
    "",
    "指示: この章だけを深掘りせよ。日次の他章・diff 全文は持っていない。必要なら検索ツールで足りぬ材料を引け。",
  ].filter((x): x is string => x != null);

  let text = lines.join("\n");
  if (text.length > JUMON_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, JUMON_CONTEXT_MAX_CHARS - 20)}\n…(budget)`;
  }
  return text;
}

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
  const checks = distillChecks(chapters);
  const peakHour = peakHourFromMaterials(materials);
  const title = `きょうのぼうけんのしょ — ${dateKey}`;
  const lead =
    materials.length === 0
      ? "この日の材料はまだない。実装の足跡が溜まると章が立つ。"
      : `材料 ${materials.length} 件 → 章 ${chapters.length}。即時しれんで止められた分も材料に含む。`;

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

export type TextbookView = {
  id: string;
  dateKey: string;
  title: string;
  lead: string | null;
  materialCount: number;
  chapterCount: number;
  peakHour: number | null;
  droppedMaterialIds: string[];
  chapters: Array<{
    id: string;
    index: number;
    title: string;
    oneLiner: string;
    bodyPlain: string;
    bodyDeep: string | null;
    diagramKind: string;
    evidence: EvidenceLink[];
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
  Array<{ dateKey: string; chapterCount: number; materialCount: number }>
> {
  const rows = await prisma.dailyTextbook.findMany({
    orderBy: { dateKey: "desc" },
    take: limit,
    select: {
      dateKey: true,
      chapterCount: true,
      materialCount: true,
    },
  });
  return rows;
}
