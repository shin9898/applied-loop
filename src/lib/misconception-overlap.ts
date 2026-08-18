import { runHeadlessLLM, parseLLMJson } from "@/lib/headless-llm";

/**
 * しれん重複の入口ガード（ADR-0021 / docs/superpowers/specs/2026-08-18-gate-duplicate-guard-design.md）。
 * `triageCapture` から呼ばれる。LLM は duplicate/refinement/unrelated の分類だけを行い、
 * 割り込むかどうか（duplicate × open/regressed のみ）はコード側が決定論的に判定する。
 */

export type OverlapRelation = "duplicate" | "refinement" | "unrelated";

export type OverlapMatch = {
  id: string;
  concept: string;
  /** 判定時点の既存 Misconception の status */
  status: string;
  relation: OverlapRelation;
  reason: string;
};

export type MisconceptionForOverlap = {
  id: string;
  concept: string;
  status: string;
  rootCause: string | null;
};

export type OverlapCheckOutcome =
  | { ok: true; matches: OverlapMatch[] }
  | { ok: false; error: string };

export type OverlapCheckLog = {
  comparedIds: string[];
  matches: OverlapMatch[];
  checkedAt: string;
  error?: string;
};

const RETRY_DELAY_MS = 72 * 3600 * 1000; // gate.ts の RETRY_DELAY_MS と同じ 72h ルール
const OVERLAP_TIMEOUT_MS = 30_000; // headless-llm.ts の既定 120s は MCP クライアント側タイムアウトと競合しうるため短縮
/** 実測10件で足りるが保険としてキャップ。呼び出し側の findMany({take}) もこれに揃えること */
export const MAX_COMPARED = 200;

/**
 * link_existing 実行時の nextReviewAt 前倒し（ADR-0021）。
 * 現在値が null（出題中で未設定）のまま Math.min に渡すと null→0 に強制変換され
 * epoch（常に期限切れ）になる誤動作が起きるため、null 分岐を必ず明示する。
 */
export function computeLinkExistingNextReviewAt(
  current: Date | null,
  now: Date,
): Date {
  const candidate = new Date(now.getTime() + RETRY_DELAY_MS);
  if (current == null) return candidate;
  return current.getTime() < candidate.getTime() ? current : candidate;
}

/** 割り込む条件は duplicate × (open|regressed) のときのみ（ADR-0021） */
export function selectInterruptCandidates(
  matches: OverlapMatch[],
): OverlapMatch[] {
  return matches.filter(
    (m) =>
      m.relation === "duplicate" &&
      (m.status === "open" || m.status === "regressed"),
  );
}

export function encodeOverlapCheckLog(log: OverlapCheckLog): string {
  return JSON.stringify(log);
}

export function decodeOverlapCheckLog(
  raw: string | null | undefined,
): OverlapCheckLog | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OverlapCheckLog;
  } catch {
    return null;
  }
}

/**
 * link_existing の targetId が、実際に needs_decision で提示された候補かどうかを検証する。
 * duplicate × (open|regressed) 以外（refinement / duplicate×resolved 等）への紐付けという
 * back door を塞ぐゲート（ADR-0021）。triageCapture の resolution=link_existing から呼ばれる。
 */
export function isLinkableCandidate(
  overlapCheckJson: string | null | undefined,
  targetId: string,
): boolean {
  const matches = decodeOverlapCheckLog(overlapCheckJson)?.matches ?? [];
  return selectInterruptCandidates(matches).some((m) => m.id === targetId);
}

function buildOverlapPrompt(
  candidate: { title: string; note: string | null; contextSummary: string | null },
  existing: MisconceptionForOverlap[],
): string {
  return [
    "あなたは学習記録の重複判定アシスタントです。",
    "新しい「誤解の概念」と、既存の誤解一覧それぞれとの関係を分類してください。",
    "分類は次の3種類です:",
    "- duplicate: 実質的に同じ誤解の言い直し",
    "- refinement: 既存の理解をより精密に言い直したもの、または粗い理解から精密な理解へ進んだ後継（重複ではない）",
    "- unrelated: 関係がない",
    "",
    "重要な教訓: resolved 済みの概念をより精密に言い直したものは duplicate ではなく refinement として扱うこと。",
    "例: 「キャッシュのヒットを識別子や意味の近さで引き当てる参照だと捉えていた」(resolved) に対し、",
    "「キャッシュのヒット判定を全体一致モデルで捉えており、先頭からの連続一致というプレフィックス構造を見落としていた」は、",
    "粗い理解から精密な理解へ進んだ健全な学習の軌跡であり refinement。duplicate は「意味的に完全に同じことの言い直し」の場合のみ使うこと。",
    "",
    "重要な制約:",
    "- コードや回答全文は渡していない。タイトル・メモ・文脈要約のみで判断すること",
    "- duplicate または refinement と判断したものだけを matches に含めよ（unrelated は matches に含めなくてよい）",
    '- JSON のみで出力: {"matches":[{"id":"...","relation":"duplicate"|"refinement","reason":"..."}]}',
    "",
    `新しい概念タイトル: ${candidate.title}`,
    candidate.note ? `メモ: ${candidate.note}` : "メモ: (なし)",
    candidate.contextSummary
      ? `文脈: ${candidate.contextSummary}`
      : "文脈: (なし)",
    "",
    "既存の誤解一覧:",
    existing
      .map(
        (m) =>
          `- id:${m.id} status:${m.status} concept:「${m.concept}」${
            m.rootCause ? ` rootCause:${m.rootCause}` : ""
          }`,
      )
      .join("\n"),
  ].join("\n");
}

function normalizeMatches(
  raw: unknown,
  existing: MisconceptionForOverlap[],
): OverlapMatch[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(existing.map((m) => [m.id, m]));
  const out: OverlapMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, relation, reason } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;
    const existingRow = byId.get(id);
    if (!existingRow) continue; // hallucinated id を除外
    if (relation !== "duplicate" && relation !== "refinement" && relation !== "unrelated") {
      continue;
    }
    out.push({
      id,
      concept: existingRow.concept,
      status: existingRow.status,
      relation,
      reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
    });
  }
  return out;
}

/**
 * 新概念と既存 Misconception 全件を LLM で比較する。
 * `llm` はテスト用の差し替え（既定は headless-llm.ts の runHeadlessLLM、短縮タイムアウト付き）。
 * 失敗（レート制限・タイムアウト・JSON解釈不能）は ok:false を返す（呼び出し側で fail-open する）。
 */
export async function checkMisconceptionOverlap(
  candidate: { title: string; note: string | null; contextSummary: string | null },
  existing: MisconceptionForOverlap[],
  llm: (prompt: string) => Promise<string> = (prompt) =>
    runHeadlessLLM(prompt, OVERLAP_TIMEOUT_MS),
): Promise<OverlapCheckOutcome> {
  if (existing.length === 0) return { ok: true, matches: [] };
  const capped = existing.slice(0, MAX_COMPARED);

  let raw: string;
  try {
    raw = await llm(buildOverlapPrompt(candidate, capped));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const parsed = parseLLMJson<{ matches?: unknown }>(raw);
  if (!parsed) {
    return { ok: false, error: "LLM 応答を JSON として解釈できませんでした。" };
  }
  return { ok: true, matches: normalizeMatches(parsed.matches, capped) };
}
