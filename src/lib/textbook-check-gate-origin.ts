import { createHash } from "node:crypto";

export const TEXTBOOK_CHECK_GATE_KIND = "textbook_check" as const;
export const MAX_TEXTBOOK_GATE_REFERENCE_CHARS = 1_200;
export const MAX_TEXTBOOK_GATE_EVIDENCE = 5;
const MAX_TEXTBOOK_GATE_EVIDENCE_LABEL_CHARS = 160;
const MAX_TEXTBOOK_GATE_EVIDENCE_REF_CHARS = 400;

export type TextbookCheckSourceKind = "daily" | "weekly";
export type TextbookCheckSource = "auto" | "compiled";

export type TextbookGateEvidence = Readonly<{
  kind: string;
  label: string;
  ref: string;
}>;

export type TextbookCheckGateOriginInput = Readonly<{
  sourceKind: TextbookCheckSourceKind;
  textbookKey: string;
  source: TextbookCheckSource;
  checkIndex: number;
  chapterIndex: number | null;
  question: string;
  chapter: Readonly<{
    title: string;
    oneLiner: string;
    bodyPlain: string;
    evidence: readonly TextbookGateEvidence[];
  }>;
}>;

export type TextbookCheckGateReferenceV1 = Readonly<{
  schema: "textbook_check_gate_reference_v1";
  sourceKind: TextbookCheckSourceKind;
  textbookKey: string;
  source: TextbookCheckSource;
  checkIndex: number;
  chapterIndex: number | null;
  chapterTitle: string;
  oneLiner: string;
  bodyPlain: string;
  evidence: readonly TextbookGateEvidence[];
}>;

export type TextbookCheckGateOriginV1 = Readonly<{
  gateKind: typeof TEXTBOOK_CHECK_GATE_KIND;
  question: string;
  rubricCriteria: readonly [string, string, string];
  contextSummary: string;
  reference: TextbookCheckGateReferenceV1;
  sourceRevisionHash: string;
  questionHash: string;
  referenceHash: string;
}>;

/**
 * Privacy-minimized identity projection for the H-CYCLE evidence ledger.
 * Its hashes deliberately come from the exact immutable A6 origin projection;
 * this is not a second identity scheme.
 */
export type TextbookCheckSourceRevisionV1 = Readonly<{
  schema: "textbook_check_source_revision_v1";
  sourceKind: TextbookCheckSourceKind;
  textbookKey: string;
  source: TextbookCheckSource;
  checkIndex: number;
  chapterIndex: number | null;
  sourceRevisionHash: string;
  questionHash: string;
}>;

export type TextbookCheckPromotionDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "not_actionable" | "invalid_mastery" }>;

export type StoredTextbookCheckGateOriginV1 = Readonly<{
  sourceKind: string;
  textbookKey: string;
  source: string;
  checkIndex: number;
  chapterIndex: number | null;
  sourceRevisionHash: string;
  questionHash: string;
  referenceHash: string;
  referenceJson: string;
}>;

export type TextbookCheckGateOriginValidation =
  | Readonly<{ ok: true; origin: TextbookCheckGateOriginV1 }>
  | Readonly<{ ok: false; code: "invalid_origin" }>;

const RUBRIC_CRITERIA = [
  "取り組みと判断を具体化している",
  "その判断の理由を説明している",
  "別案または次回への適用に触れている",
] as const;

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new Error("origin contains an invalid number");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("origin contains an unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireNonBlank(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${field}`);
  return normalized;
}

function requireSafeIndex(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${field}`);
  return value;
}

function boundedEvidence(evidence: readonly TextbookGateEvidence[]): readonly TextbookGateEvidence[] {
  if (evidence.length > MAX_TEXTBOOK_GATE_EVIDENCE) throw new Error("too many evidence references");
  return evidence.map((entry) =>
    deepFreeze({
      kind: requireNonBlank(entry.kind, "evidence kind", 40),
      label: requireNonBlank(entry.label, "evidence label", MAX_TEXTBOOK_GATE_EVIDENCE_LABEL_CHARS),
      ref: requireNonBlank(entry.ref, "evidence ref", MAX_TEXTBOOK_GATE_EVIDENCE_REF_CHARS),
    }),
  );
}

function contextSummary(reference: TextbookCheckGateReferenceV1): string {
  return [
    `【${reference.sourceKind === "daily" ? "日次" : "週次"}のしょ ${reference.textbookKey} / 問${reference.checkIndex}】`,
    `${reference.chapterTitle}: ${reference.oneLiner}`,
    reference.bodyPlain,
  ].join("\n").slice(0, 600);
}

/**
 * Creates the immutable, local-only source bundle used when a textbook Check
 * is explicitly promoted to a Gate. It intentionally has no answer field.
 */
export function createTextbookCheckGateOriginV1(
  input: TextbookCheckGateOriginInput,
): TextbookCheckGateOriginV1 {
  const sourceKind = input.sourceKind;
  if (sourceKind !== "daily" && sourceKind !== "weekly") throw new Error("invalid source kind");
  const source = input.source;
  if (source !== "auto" && source !== "compiled") throw new Error("invalid source");

  const textbookKey = requireNonBlank(input.textbookKey, "textbook key", 32);
  const question = requireNonBlank(input.question, "question", 2_000);
  const checkIndex = requireSafeIndex(input.checkIndex, "check index");
  if (checkIndex === null) throw new Error("invalid check index");
  const chapterIndex = requireSafeIndex(input.chapterIndex, "chapter index");
  const reference = deepFreeze({
    schema: "textbook_check_gate_reference_v1" as const,
    sourceKind,
    textbookKey,
    source,
    checkIndex,
    chapterIndex,
    chapterTitle: requireNonBlank(input.chapter.title, "chapter title", 240),
    oneLiner: requireNonBlank(input.chapter.oneLiner, "chapter one-liner", 600),
    bodyPlain: requireNonBlank(input.chapter.bodyPlain, "chapter body", 20_000)
      .slice(0, MAX_TEXTBOOK_GATE_REFERENCE_CHARS),
    evidence: boundedEvidence(input.chapter.evidence),
  });
  const referenceHash = sha256(canonicalJson(reference));
  const questionHash = sha256(question);
  const origin = {
    schema: "textbook_check_gate_origin_v1",
    question,
    rubricCriteria: [...RUBRIC_CRITERIA],
    reference,
  };
  return deepFreeze({
    gateKind: TEXTBOOK_CHECK_GATE_KIND,
    question,
    rubricCriteria: RUBRIC_CRITERIA,
    contextSummary: contextSummary(reference),
    reference,
    sourceRevisionHash: sha256(canonicalJson(origin)),
    questionHash,
    referenceHash,
  });
}

/**
 * Derives the ledger-safe identity from the same canonical source bundle used
 * by explicit A6 promotion. The returned value intentionally contains neither
 * question nor chapter/reference material.
 */
export function createTextbookCheckSourceRevisionV1(
  input: TextbookCheckGateOriginInput,
): TextbookCheckSourceRevisionV1 {
  const origin = createTextbookCheckGateOriginV1(input);
  return deepFreeze({
    schema: "textbook_check_source_revision_v1" as const,
    sourceKind: origin.reference.sourceKind,
    textbookKey: origin.reference.textbookKey,
    source: origin.reference.source,
    checkIndex: origin.reference.checkIndex,
    chapterIndex: origin.reference.chapterIndex,
    sourceRevisionHash: origin.sourceRevisionHash,
    questionHash: origin.questionHash,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parseStoredReference(raw: string): TextbookCheckGateReferenceV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const referenceKeys = [
    "bodyPlain",
    "chapterIndex",
    "chapterTitle",
    "checkIndex",
    "evidence",
    "oneLiner",
    "schema",
    "source",
    "sourceKind",
    "textbookKey",
  ];
  if (!hasExactKeys(value, referenceKeys)) return null;
  if (value.schema !== "textbook_check_gate_reference_v1") return null;
  if (value.sourceKind !== "daily" && value.sourceKind !== "weekly") return null;
  if (value.source !== "auto" && value.source !== "compiled") return null;
  if (
    typeof value.textbookKey !== "string" ||
    typeof value.checkIndex !== "number" ||
    (value.chapterIndex !== null && typeof value.chapterIndex !== "number") ||
    typeof value.chapterTitle !== "string" ||
    typeof value.oneLiner !== "string" ||
    typeof value.bodyPlain !== "string" ||
    !Array.isArray(value.evidence)
  ) {
    return null;
  }
  const evidence: TextbookGateEvidence[] = [];
  for (const item of value.evidence) {
    if (!isRecord(item) || !hasExactKeys(item, ["kind", "label", "ref"])) return null;
    if (typeof item.kind !== "string" || typeof item.label !== "string" || typeof item.ref !== "string") {
      return null;
    }
    evidence.push({ kind: item.kind, label: item.label, ref: item.ref });
  }
  return {
    schema: "textbook_check_gate_reference_v1",
    sourceKind: value.sourceKind,
    textbookKey: value.textbookKey,
    source: value.source,
    checkIndex: value.checkIndex,
    chapterIndex: value.chapterIndex,
    chapterTitle: value.chapterTitle,
    oneLiner: value.oneLiner,
    bodyPlain: value.bodyPlain,
    evidence,
  };
}

/**
 * Rebuilds and compares a persisted textbook origin before it is allowed into
 * an LLM grading prompt. The exact JSON comparison rejects extra fields,
 * duplicate-key spellings, and any answer-like material rather than trusting
 * a mutable Gate row.
 */
export function validateTextbookCheckGateOriginV1(input: Readonly<{
  question: string;
  stored: StoredTextbookCheckGateOriginV1;
}>): TextbookCheckGateOriginValidation {
  const invalid = Object.freeze({ ok: false as const, code: "invalid_origin" as const });
  const reference = parseStoredReference(input.stored.referenceJson);
  if (reference === null) return invalid;
  try {
    const expected = createTextbookCheckGateOriginV1({
      sourceKind: reference.sourceKind,
      textbookKey: reference.textbookKey,
      source: reference.source,
      checkIndex: reference.checkIndex,
      chapterIndex: reference.chapterIndex,
      question: input.question,
      chapter: {
        title: reference.chapterTitle,
        oneLiner: reference.oneLiner,
        bodyPlain: reference.bodyPlain,
        evidence: reference.evidence,
      },
    });
    if (
      input.question !== expected.question ||
      input.stored.referenceJson !== JSON.stringify(expected.reference) ||
      input.stored.sourceKind !== expected.reference.sourceKind ||
      input.stored.textbookKey !== expected.reference.textbookKey ||
      input.stored.source !== expected.reference.source ||
      input.stored.checkIndex !== expected.reference.checkIndex ||
      input.stored.chapterIndex !== expected.reference.chapterIndex ||
      input.stored.sourceRevisionHash !== expected.sourceRevisionHash ||
      input.stored.questionHash !== expected.questionHash ||
      input.stored.referenceHash !== expected.referenceHash
    ) {
      return invalid;
    }
    return Object.freeze({ ok: true as const, origin: expected });
  } catch {
    return invalid;
  }
}

/** Self-report is not proof; only partial/stuck can be explicitly promoted. */
export function evaluateTextbookCheckPromotion(
  mastery: unknown,
): TextbookCheckPromotionDecision {
  if (mastery === "partial" || mastery === "stuck") return Object.freeze({ ok: true as const });
  if (mastery === "clear" || mastery === "parked" || mastery === null) {
    return Object.freeze({ ok: false as const, code: "not_actionable" as const });
  }
  return Object.freeze({ ok: false as const, code: "invalid_mastery" as const });
}
