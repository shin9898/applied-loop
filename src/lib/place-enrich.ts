/**
 * Gate.domain / ばしょのヒューリスティック補完。
 * LLM なしで repo名・問い文から大分類を埋める。MCP からも呼べる。
 */
import { prisma } from "@/lib/db";

/** repo 名 → domain ラベル */
const REPO_DOMAIN: Record<string, string> = {
  "triple-onboarding": "ONBOARDING",
  "triple-engagement": "ENGAGEMENT",
  "triple-report": "REPORT",
  "triple-list": "LIST",
  "triple-manual-frontend": "MANUAL FE",
  "applied-loop": "ハーネス / applied-loop",
  workbench: "ハーネス / workbench",
  "my-copy": "ハーネス / my-copy",
};

export function inferDomain(input: {
  repo?: string | null;
  question?: string | null;
  targetConcept?: string | null;
  contextSummary?: string | null;
}): string | null {
  const repo = input.repo?.trim();
  if (repo) {
    const short = repo.includes("/") ? repo.split("/").pop()! : repo;
    const mapped = REPO_DOMAIN[short.toLowerCase()] ?? REPO_DOMAIN[repo.toLowerCase()];
    if (mapped) return mapped;
    // triple-* はプロダクト領として短名を大文字っぽく
    if (/^triple-/i.test(short)) {
      return short.replace(/^triple-/i, "").toUpperCase();
    }
    if (/harness|hook|my-copy|workbench|applied-loop/i.test(short)) {
      return `ハーネス / ${short}`;
    }
    return short;
  }

  const blob = [input.question, input.targetConcept, input.contextSummary]
    .filter(Boolean)
    .join(" ");
  if (!blob.trim()) return null;

  // 明示プロダクト名
  if (/onboarding/i.test(blob)) return "ONBOARDING";
  if (/engagement/i.test(blob)) return "ENGAGEMENT";
  if (/triple-report|\breport\b|レポート/i.test(blob)) return "REPORT";
  if (/\blist\b|triple-list/i.test(blob)) return "LIST";
  if (/manual.?fe|マニュアル/i.test(blob)) return "MANUAL FE";

  // REPORT 系（得点・割合・画面/PDF 出力）
  if (
    /得点率|割合指標|画面とPDF|画面・CSV・PDF|切り捨てて表示|二進浮動|ページネーション|履歴推移|集計・比較/i.test(
      blob,
    )
  ) {
    return "REPORT";
  }

  // ONBOARDING 系（認証・ログイン・所属）
  if (
    /ログイン|認証プロバイダー|認証基盤|トークン|本人確認|所属情報|外部認証|認証属性/i.test(
      blob,
    )
  ) {
    return "ONBOARDING";
  }

  // ENGAGEMENT 系（通知永続化など）
  if (/NotificationRepository|fallback_reason|notifications\./i.test(blob)) {
    return "ENGAGEMENT";
  }

  // ハーネス / 開発プロセス
  if (/prompt.?cache|キャッシュ|prefix/i.test(blob)) return "ハーネス / cache";
  if (
    /harness|フック|CLAUDE\.md|fail-closed|事前ガード|worktree|Git index|品質ゲート|自動化された作業者|スキルを二つの環境|差分取得API|検査の自動化/i.test(
      blob,
    )
  ) {
    return "ハーネス";
  }

  // 横断設計
  if (/PdM|プロダクト|ロードマップ|権限を付与|管理者」権限/i.test(blob)) {
    return "PdM / 設計";
  }
  if (/自律ワークフロー|顧客データ/i.test(blob)) return "ハーネス / 自律フロー";

  return null;
}

/**
 * domain が空の Gate を推測で埋める。
 * dryRun なら更新せず件数だけ返す。
 */
export async function enrichMissingGateDomains(opts?: {
  dryRun?: boolean;
  take?: number;
}): Promise<{ scanned: number; updated: number; samples: string[] }> {
  const dryRun = opts?.dryRun ?? false;
  const take = opts?.take ?? 80;
  const gates = await prisma.gate.findMany({
    where: {
      OR: [{ domain: null }, { domain: "" }],
    },
    take,
    orderBy: { createdAt: "desc" },
    include: { event: { select: { repo: true } } },
  });

  let updated = 0;
  const samples: string[] = [];
  for (const g of gates) {
    const domain = inferDomain({
      repo: g.event?.repo,
      question: g.question,
      targetConcept: g.targetConcept,
      contextSummary: g.contextSummary,
    });
    if (!domain) continue;
    samples.push(`${g.id.slice(0, 8)}… → ${domain}`);
    if (!dryRun) {
      await prisma.gate.update({
        where: { id: g.id },
        data: { domain },
      });
    }
    updated += 1;
  }
  return { scanned: gates.length, updated, samples: samples.slice(0, 8) };
}
