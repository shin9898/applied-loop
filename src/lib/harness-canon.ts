import { prisma } from "@/lib/db";
import {
  formatRepoRatesForPrompt,
  repoCacheReadRates,
} from "@/lib/harness-stats";

/** プロンプトキャッシュ誤解シード (横断概念。ADR-0016) */
export const PROMPT_CACHE_MISCONCEPTION_SEEDS = [
  {
    concept: "プロンプトキャッシュは意味が似ていればヒットする",
    dedupe: "prompt-cache:semantic-hit",
  },
  {
    concept: "『続けて』のような短い指示なら長い履歴はモデルに送られない",
    dedupe: "prompt-cache:short-prompt-cheap",
  },
  {
    concept: "古い会話履歴を削れば必ずトークンコストが下がる",
    dedupe: "prompt-cache:trim-always-wins",
  },
  {
    concept: "ツール定義を1つ追加しても、後ろの長い履歴のキャッシュには影響しない",
    dedupe: "prompt-cache:tool-def-safe",
  },
  {
    concept: "キャッシュが切れると会話の文脈そのものが失われる",
    dedupe: "prompt-cache:ttl-means-amnesia",
  },
] as const;

const MODULE_GATE_QUESTIONS: {
  misconceptionDedupe: string;
  question: string;
  rubric: string[];
  contextSummary: string;
}[] = [
  {
    misconceptionDedupe: "prompt-cache:semantic-hit",
    question:
      "プロンプトキャッシュは『意味が近い文』でも再利用される、という理解は正しいか。正しくない場合、何を見て再利用可否が決まるか。あなたの観測にある repo 別 cache read 率を踏まえ、途中で1か所だけ変わったときに後ろの履歴に何が起きるかを説明せよ。",
    rubric: [
      "キャッシュは意味類似ではなく同一の並び（接頭辞）に依存すると説明できる",
      "途中の不一致以降が再計算されることを説明できる",
      "観測データのどの repo で再利用率が落ちているかを読み取っている",
    ],
    contextSummary:
      "論点: キャッシュは人間的記憶ではなく、同じ先頭の計算再利用。意味が近くても並びが違えば別入力になる。",
  },
  {
    misconceptionDedupe: "prompt-cache:tool-def-safe",
    question:
      "会話の途中で、システム直後のツール定義に新しいツールを1つ追加した。長い会話履歴の本文は変えていない。次のリクエストで再計算されやすい範囲はどこか。対策として定義の置き方・安定化をどう設計するか。下記の repo 別観測を根拠に、どのプロジェクトのハーネスを先に直すべきかも述べよ。",
    rubric: [
      "ツール定義が履歴より前にあると破壊点になることを説明できる",
      "履歴本文が同じでも後ろが再処理されやすいことを説明できる",
      "repo 別の悪化を見て処方の対象プロジェクトを特定している",
    ],
    contextSummary:
      "論点: 前方の定義変更は後ろの長い文脈を巻き込む。概念は横断、処方は局所 (repo)。",
  },
  {
    misconceptionDedupe: "prompt-cache:trim-always-wins",
    question:
      "トークンを減らすために会話履歴の途中メッセージを削除した。入力トークン数は減ったが、かえってコストや遅延が増えることがあるのはなぜか。削除とキャッシュ再計算、必要な文脈喪失のトレードオフを説明せよ。",
    rubric: [
      "途中削除が後ろの並びを変え再計算を招くことを説明できる",
      "トークン数減少だけでは得かどうかわからないと述べている",
      "必要な根拠（試行錯誤の履歴）を消しすぎるリスクに触れている",
    ],
    contextSummary:
      "論点: 短くなったか・どこから再計算か・文脈を失っていないかを同時に見る。",
  },
];

/**
 * 誤解シードを open Misconception として冪等投入 (概念は横断)。
 * Capture 経由ではなく正典モジュールの種として直接作成する。
 */
export async function ensurePromptCacheMisconceptionSeeds(): Promise<{
  created: number;
  ids: string[];
}> {
  let created = 0;
  const ids: string[] = [];
  for (const seed of PROMPT_CACHE_MISCONCEPTION_SEEDS) {
    const existing = await prisma.misconception.findFirst({
      where: { concept: seed.concept },
    });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const row = await prisma.misconception.create({
      data: {
        concept: seed.concept,
        status: "open",
        rootCause: "verification",
      },
    });
    ids.push(row.id);
    created += 1;
  }
  return { created, ids };
}

/**
 * module ゲートを不足分だけ生成 (ADR-0016)。
 * 出題に repo 別 cache read 率を差し込む。
 */
export async function ensurePromptCacheModuleGates(
  now: Date = new Date()
): Promise<{ created: number; gateIds: string[] }> {
  await ensurePromptCacheMisconceptionSeeds();
  const rates = await repoCacheReadRates(now, { take: 8 });
  const ratesBlock = formatRepoRatesForPrompt(rates);
  const resources = JSON.stringify([
    {
      kind: "doc",
      label: "プロンプトキャッシュの原理 (正典)",
      ref: "/harness/concepts/prompt-cache",
    },
    {
      kind: "doc",
      label: "Anthropic Prompt caching",
      ref: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
    },
  ]);

  let created = 0;
  const gateIds: string[] = [];

  for (const q of MODULE_GATE_QUESTIONS) {
    const seed = PROMPT_CACHE_MISCONCEPTION_SEEDS.find(
      (s) => s.dedupe === q.misconceptionDedupe
    );
    if (!seed) continue;
    const misconception = await prisma.misconception.findFirst({
      where: { concept: seed.concept },
    });
    if (!misconception) continue;

    const existing = await prisma.gate.findFirst({
      where: {
        kind: "module",
        misconceptionId: misconception.id,
        status: { in: ["pending", "answered", "grading", "grading_failed"] },
      },
    });
    if (existing) {
      gateIds.push(existing.id);
      continue;
    }

    const question = `${q.question}\n\n【あなたの観測 (repo 別 cache read 率)】\n${ratesBlock}`;
    const gate = await prisma.gate.create({
      data: {
        kind: "module",
        misconceptionId: misconception.id,
        question,
        targetConcept: seed.concept,
        domain: "Harness / Prompt cache",
        status: "pending",
        contextSummary: q.contextSummary,
        rubricCriteria: JSON.stringify(q.rubric),
        resources,
      },
    });
    gateIds.push(gate.id);
    created += 1;
  }

  return { created, gateIds };
}
