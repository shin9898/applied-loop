import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import {
  createTextbookCheckGateOriginV1,
  evaluateTextbookCheckPromotion,
  MAX_TEXTBOOK_GATE_EVIDENCE,
  type TextbookCheckGateOriginInput,
  type TextbookCheckGateOriginV1,
  type TextbookCheckSourceKind,
  type TextbookGateEvidence,
} from "./textbook-check-gate-origin";

type PromotionClient = PrismaClient | Prisma.TransactionClient;

export type TextbookCheckGatePromotionResult =
  | Readonly<{ ok: true; disposition: "created" | "existing"; gateId: string }>
  | Readonly<{
      ok: false;
      code: "not_found" | "not_actionable" | "invalid_mastery" | "invalid_source";
    }>;

type SourceChapter = Readonly<{
  index: number;
  title: string;
  oneLiner: string;
  bodyPlain: string;
  evidenceJson: string;
}>;

type SourceCheck = Readonly<{
  sourceKind: TextbookCheckSourceKind;
  textbookKey: string;
  source: string;
  checkIndex: number;
  question: string;
  mastery: string | null;
  chapter: SourceChapter | null;
  fallbackChapters: readonly SourceChapter[];
}>;

/** A server-re-read source bundle shared by A6 promotion and A7 evidence. */
export type ReadTextbookCheckSourceResultV1 = Readonly<{
  input: TextbookCheckGateOriginInput;
  mastery: string | null;
}>;

class InvalidSourceError extends Error {}

function sourceError(message: string): never {
  throw new InvalidSourceError(message);
}

function isTextbookSource(value: string): value is "auto" | "compiled" {
  return value === "auto" || value === "compiled";
}

function parseEvidence(raw: string): readonly TextbookGateEvidence[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return sourceError("invalid evidence JSON");
  }
  if (!Array.isArray(value)) return sourceError("invalid evidence shape");
  const dedupe = new Set<string>();
  const evidence: TextbookGateEvidence[] = [];
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return sourceError("invalid evidence item");
    }
    const record = candidate as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const ref = typeof record.ref === "string"
      ? record.ref.trim()
      : typeof record.url === "string"
        ? record.url.trim()
        : "";
    if (!kind || !label || !ref) return sourceError("invalid evidence fields");
    const key = `${kind}\u0000${label}\u0000${ref}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    evidence.push({ kind, label, ref });
  }
  return evidence;
}

function referenceChapter(source: SourceCheck) {
  if (source.chapter !== null) {
    return {
      index: source.chapter.index,
      title: source.chapter.title,
      oneLiner: source.chapter.oneLiner,
      bodyPlain: source.chapter.bodyPlain,
      evidence: parseEvidence(source.chapter.evidenceJson),
    };
  }

  if (source.fallbackChapters.length === 0) return sourceError("cross-check has no chapter reference");
  const evidence: TextbookGateEvidence[] = [];
  const seen = new Set<string>();
  for (const chapter of source.fallbackChapters) {
    for (const entry of parseEvidence(chapter.evidenceJson)) {
      const key = `${entry.kind}\u0000${entry.label}\u0000${entry.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Cross-checks can span several chapters. Validate every local evidence
      // item above, but retain only the stable first five for the bounded
      // immutable origin and grading prompt.
      if (evidence.length < MAX_TEXTBOOK_GATE_EVIDENCE) evidence.push(entry);
    }
  }
  return {
    index: null,
    title: "横断確認",
    oneLiner: source.fallbackChapters.map((chapter) => chapter.oneLiner).join(" / "),
    bodyPlain: source.fallbackChapters
      .map((chapter) => `${chapter.title}\n${chapter.bodyPlain}`)
      .join("\n\n"),
    evidence,
  };
}

async function readDailySource(
  client: PromotionClient,
  checkId: string,
): Promise<SourceCheck | null> {
  const row = await client.dailyTextbookCheck.findUnique({
    where: { id: checkId },
    include: {
      textbook: {
        select: {
          dateKey: true,
          chapters: {
            select: { index: true, title: true, oneLiner: true, bodyPlain: true, evidenceJson: true },
            orderBy: { index: "asc" },
            take: 3,
          },
        },
      },
      chapter: { select: { index: true, title: true, oneLiner: true, bodyPlain: true, evidenceJson: true } },
    },
  });
  if (row === null) return null;
  return {
    sourceKind: "daily",
    textbookKey: row.textbook.dateKey,
    source: row.source,
    checkIndex: row.index,
    question: row.question,
    mastery: row.mastery,
    chapter: row.chapter,
    fallbackChapters: row.textbook.chapters,
  };
}

async function readWeeklySource(
  client: PromotionClient,
  checkId: string,
): Promise<SourceCheck | null> {
  const row = await client.weeklyTextbookCheck.findUnique({
    where: { id: checkId },
    include: {
      weekly: {
        select: {
          weekKey: true,
          chapters: {
            select: { index: true, title: true, oneLiner: true, bodyPlain: true, evidenceJson: true },
            orderBy: { index: "asc" },
            take: 3,
          },
        },
      },
      chapter: { select: { index: true, title: true, oneLiner: true, bodyPlain: true, evidenceJson: true } },
    },
  });
  if (row === null) return null;
  return {
    sourceKind: "weekly",
    textbookKey: row.weekly.weekKey,
    // WeeklyTextbookCheck has no mutable source column: the sole writer is
    // generateWeeklyTextbook, so its immutable origin is always `auto`.
    source: "auto",
    checkIndex: row.index,
    question: row.question,
    mastery: row.mastery,
    chapter: row.chapter,
    fallbackChapters: row.weekly.chapters,
  };
}

async function readSource(
  client: PromotionClient,
  sourceKind: TextbookCheckSourceKind,
  checkId: string,
): Promise<SourceCheck | null> {
  return sourceKind === "daily"
    ? readDailySource(client, checkId)
    : readWeeklySource(client, checkId);
}

/**
 * Reads the current Check only on the server and rebuilds the canonical input
 * used by both A6 origin creation and A7 evidence. No caller-provided source,
 * question, reference, hash, or timestamp crosses this boundary.
 */
export async function readTextbookCheckSourceInputV1(
  client: PromotionClient,
  sourceKind: TextbookCheckSourceKind,
  checkId: string,
): Promise<ReadTextbookCheckSourceResultV1 | null> {
  const source = await readSource(client, sourceKind, checkId);
  if (source === null) return null;
  if (!isTextbookSource(source.source)) return sourceError("invalid source");
  const chapter = referenceChapter(source);
  return Object.freeze({
    mastery: source.mastery,
    input: {
      sourceKind: source.sourceKind,
      textbookKey: source.textbookKey,
      source: source.source,
      checkIndex: source.checkIndex,
      chapterIndex: chapter.index,
      question: source.question,
      chapter: {
        title: chapter.title,
        oneLiner: chapter.oneLiner,
        bodyPlain: chapter.bodyPlain,
        evidence: chapter.evidence,
      },
    },
  });
}

function isUniqueOriginError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function originWhereFor(origin: TextbookCheckGateOriginV1) {
  return {
    sourceKind_textbookKey_source_checkIndex_sourceRevisionHash: {
      sourceKind: origin.reference.sourceKind,
      textbookKey: origin.reference.textbookKey,
      source: origin.reference.source,
      checkIndex: origin.reference.checkIndex,
      sourceRevisionHash: origin.sourceRevisionHash,
    },
  };
}

/**
 * Creates (or returns) a Gate only after an explicit caller has selected a
 * partial/stuck Textbook Check. No caller-supplied question, rubric, or
 * reference can cross this boundary.
 */
export async function promoteTextbookCheckToGate(
  client: PrismaClient,
  input: Readonly<{ sourceKind: TextbookCheckSourceKind; checkId: string }>,
): Promise<TextbookCheckGatePromotionResult> {
  const checkId = input.checkId.trim();
  if (!checkId) return Object.freeze({ ok: false as const, code: "not_found" as const });

  let racedOriginWhere: ReturnType<typeof originWhereFor> | null = null;
  try {
    return await client.$transaction(async (tx) => {
      let source: ReadTextbookCheckSourceResultV1 | null;
      try {
        source = await readTextbookCheckSourceInputV1(tx, input.sourceKind, checkId);
      } catch (error) {
        if (error instanceof InvalidSourceError) {
          return Object.freeze({ ok: false as const, code: "invalid_source" as const });
        }
        throw error;
      }
      if (source === null) return Object.freeze({ ok: false as const, code: "not_found" as const });
      const eligibility = evaluateTextbookCheckPromotion(source.mastery);
      if (!eligibility.ok) return eligibility;

      let origin: TextbookCheckGateOriginV1;
      try {
        origin = createTextbookCheckGateOriginV1(source.input);
      } catch (error) {
        if (error instanceof InvalidSourceError || error instanceof Error) {
          return Object.freeze({ ok: false as const, code: "invalid_source" as const });
        }
        throw error;
      }

      const originWhere = originWhereFor(origin);
      racedOriginWhere = originWhere;
      const existing = await tx.textbookCheckGateOrigin.findUnique({
        where: originWhere,
        select: { gateId: true },
      });
      if (existing !== null) {
        return Object.freeze({ ok: true as const, disposition: "existing" as const, gateId: existing.gateId });
      }

      const gate = await tx.gate.create({
        data: {
          kind: origin.gateKind,
          question: origin.question,
          contextSummary: origin.contextSummary,
          rubricCriteria: JSON.stringify(origin.rubricCriteria),
          resources: origin.reference.evidence.length > 0
            ? JSON.stringify(origin.reference.evidence)
            : null,
          textbookCheckOrigin: {
            create: {
              sourceKind: origin.reference.sourceKind,
              textbookKey: origin.reference.textbookKey,
              source: origin.reference.source,
              checkIndex: origin.reference.checkIndex,
              chapterIndex: origin.reference.chapterIndex,
              sourceRevisionHash: origin.sourceRevisionHash,
              questionHash: origin.questionHash,
              referenceHash: origin.referenceHash,
              referenceJson: JSON.stringify(origin.reference),
            },
          },
        },
      });
      return Object.freeze({ ok: true as const, disposition: "created" as const, gateId: gate.id });
    });
  } catch (error) {
    if (!isUniqueOriginError(error) || racedOriginWhere === null) throw error;
    const raced = await client.textbookCheckGateOrigin.findUnique({
      where: racedOriginWhere,
      select: { gateId: true },
    });
    if (raced === null) throw error;
    return Object.freeze({ ok: true as const, disposition: "existing" as const, gateId: raced.gateId });
  }
}
