/**
 * Gate.rubricResult の保存形式。
 * 旧: RubricScore[]
 * 新: { rubric, correctModel?, misconception?, rootCause? }
 * 読み側は両方を受け付ける。
 */
import { buildWeakAspectCards } from "@/lib/micro-cards";

export type RubricScore = {
  aspect: string;
  score: 0 | 1 | 2;
  note: string;
  /** 学習者向けミニチェックの問い（score<2 で推奨） */
  teach?: string;
  /** 答え合わせ用の肯定模範（score<2 で推奨） */
  model?: string;
};

export type GradePayload = {
  rubric: RubricScore[];
  /** 不合格時: 実際の仕組み・正しいモデルの短い説明 */
  correctModel: string | null;
  misconception: string | null;
  rootCause: "knowledge" | "verification" | "premise" | null;
};

export type WeakAspect = {
  aspect: string;
  score: number;
  note: string;
  teach?: string;
  model?: string;
  /** 表示用の問い（teach または派生） */
  prompt: string;
  /** 表示用の模範（model または派生） */
  modelAnswer: string;
};

export type GateDebrief = {
  feedback: string | null;
  gap: string | null;
  correctModel: string | null;
  misconception: string | null;
  rootCause: GradePayload["rootCause"];
  weakAspects: WeakAspect[];
};

const ROOT = new Set(["knowledge", "verification", "premise"]);

function asRootCause(raw: unknown): GradePayload["rootCause"] {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return ROOT.has(v) ? (v as GradePayload["rootCause"]) : null;
}

function normalizeRubric(raw: unknown): RubricScore[] {
  if (!Array.isArray(raw)) return [];
  const items: RubricScore[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const aspect = typeof r.aspect === "string" ? r.aspect.trim() : "";
    const score = r.score;
    if (!aspect || (score !== 0 && score !== 1 && score !== 2)) continue;
    const teach =
      typeof r.teach === "string" && r.teach.trim()
        ? r.teach.trim()
        : typeof r.teach_prompt === "string" && r.teach_prompt.trim()
          ? r.teach_prompt.trim()
          : undefined;
    const model =
      typeof r.model === "string" && r.model.trim()
        ? r.model.trim()
        : typeof r.model_answer === "string" && r.model_answer.trim()
          ? r.model_answer.trim()
          : undefined;
    items.push({
      aspect,
      score,
      note: typeof r.note === "string" ? r.note.trim() : "",
      ...(teach ? { teach } : {}),
      ...(model ? { model } : {}),
    });
  }
  return items;
}

export function parseGradePayload(raw: string | null | undefined): GradePayload {
  if (!raw) {
    return { rubric: [], correctModel: null, misconception: null, rootCause: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        rubric: normalizeRubric(parsed),
        correctModel: null,
        misconception: null,
        rootCause: null,
      };
    }
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return {
        rubric: normalizeRubric(o.rubric),
        correctModel:
          typeof o.correctModel === "string" && o.correctModel.trim()
            ? o.correctModel.trim()
            : typeof o.correct_model === "string" && o.correct_model.trim()
              ? o.correct_model.trim()
              : null,
        misconception:
          typeof o.misconception === "string" && o.misconception.trim()
            ? o.misconception.trim()
            : null,
        rootCause: asRootCause(o.rootCause ?? o.root_cause),
      };
    }
  } catch {
    /* ignore */
  }
  return { rubric: [], correctModel: null, misconception: null, rootCause: null };
}

export function serializeGradePayload(payload: GradePayload): string {
  return JSON.stringify({
    rubric: payload.rubric.map((r) => ({
      aspect: r.aspect,
      score: r.score,
      note: r.note,
      ...(r.teach ? { teach: r.teach } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    correctModel: payload.correctModel,
    misconception: payload.misconception,
    rootCause: payload.rootCause,
  });
}

/** UI / poll 用: gradeNote + rubricResult からデブリーフを組み立てる */
export function buildGateDebrief(
  gradeNote: string | null | undefined,
  rubricResultRaw: string | null | undefined,
): GateDebrief {
  const payload = parseGradePayload(rubricResultRaw);
  const cards = buildWeakAspectCards({
    weakAspects: payload.rubric
      .filter((r) => r.score < 2)
      .map((r) => ({
        aspect: r.aspect,
        score: r.score,
        note: r.note,
        teach: r.teach,
        model: r.model,
      })),
    correctModel: payload.correctModel,
  });
  return {
    feedback: gradeNote?.trim() || null,
    gap: gradeNote?.trim() || null,
    correctModel: payload.correctModel,
    misconception: payload.misconception,
    rootCause: payload.rootCause,
    weakAspects: cards,
  };
}

export function rootCauseLabel(cause: GradePayload["rootCause"]): string | null {
  if (cause === "knowledge") return "知識不足";
  if (cause === "verification") return "確認不足";
  if (cause === "premise") return "前提の誤認";
  return null;
}
