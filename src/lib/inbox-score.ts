import { prisma } from "@/lib/db";
import { runHeadlessLLM, parseLLMJson } from "@/lib/headless-llm";

export type ImportanceLabel = "高" | "中" | "低";

/** スコアを表示用ラベルに丸める (ADR-0012 §2)。 */
export function importanceLabel(score: number | null | undefined): ImportanceLabel | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 70) return "高";
  if (score >= 40) return "中";
  return "低";
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Capture の重要度をヘッドレス LLM でスコアリングし保存する (ADR-0012 §2)。
 * タイトル・メモ・既存 Entry タイトルのみ渡す (コード本文は送らない)。
 * 失敗時はログだけ残してスコア未設定のままにする。
 */
export async function scoreCaptureImportance(captureId: string): Promise<void> {
  const capture = await prisma.capture.findUnique({ where: { id: captureId } });
  if (!capture || capture.status !== "pending") return;
  if (capture.importanceScore != null) return;

  const recentEntries = await prisma.entry.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, title: true },
  });

  const prompt = [
    "あなたは学習受信箱の仕分けアシスタントです。",
    "以下の学び候補の重要度を 0〜100 で採点し、短い根拠を日本語で書いてください。",
    "採点基準:",
    "- 非自明性: 一般常識ではなく、デバッグや設計判断から得た知見か",
    "- 再利用性: 別の場面でも使えるか",
    "- 誤解につながる可能性: 間違ったまま残ると後で損するか",
    "- 既存 Entry との重複: 既知の学びと実質同じなら低く",
    "重要な制約:",
    "- コードや回答全文は渡していない。タイトルとメモのみで判断すること",
    '- JSON のみで出力: {"score":0-100,"reason":"..."}',
    "",
    `候補タイトル: ${capture.title}`,
    capture.note ? `メモ: ${capture.note}` : "メモ: (なし)",
    `発生元: ${capture.sourceTool}`,
    "",
    "既存の学び (重複判定用・タイトルのみ):",
    recentEntries.length === 0
      ? "(なし)"
      : recentEntries.map((e) => `- ${e.title}`).join("\n"),
  ].join("\n");

  try {
    const parsed = parseLLMJson<{ score?: unknown; reason?: unknown }>(
      await runHeadlessLLM(prompt)
    );
    const rawScore = typeof parsed?.score === "number" ? parsed.score : null;
    const reason =
      typeof parsed?.reason === "string" ? parsed.reason.trim().slice(0, 500) : null;
    if (rawScore == null) {
      console.error("[inbox-score] invalid score JSON for", captureId);
      return;
    }
    await prisma.capture.update({
      where: { id: captureId },
      data: {
        importanceScore: clampScore(rawScore),
        triageReason: reason || null,
      },
    });
  } catch (e) {
    console.error("[inbox-score] scoring failed:", e);
  }
}
