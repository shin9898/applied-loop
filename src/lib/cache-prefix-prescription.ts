import {
  repoCacheReadRates,
  type RepoCacheReadRate,
} from "@/lib/harness-stats";

export type CachePrefixPrescription = {
  repo: string;
  observed: {
    thisWeekRate: number;
    lastWeekRate: number;
    declineRatio: number;
    thisWeekTokens: number;
  } | null;
  severity: "ok" | "watch" | "act";
  summary: string;
  checklist: string[];
  candidatePatches: {
    target: string;
    suggestion: string;
  }[];
  nextSteps: string[];
};

function severityFor(row: RepoCacheReadRate | null): CachePrefixPrescription["severity"] {
  if (!row) return "watch";
  if (row.insufficientThisWeek) return "watch";
  if (row.declineRatio >= 0.15) return "act";
  if (row.declineRatio >= 0.05) return "watch";
  return "ok";
}

/** repo 別の cache 再利用率から、安定プレフィックス向けの advisory 処方を作る（ADR-0017）。 */
export function buildCachePrefixPrescription(
  repo: string,
  row: RepoCacheReadRate | null
): CachePrefixPrescription {
  const sev = severityFor(row);
  const ratePct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const summary =
    !row
      ? `「${repo}」の十分な観測がまだありません。共有パックのチェックリストから始め、観測が溜まったら再確認してください。`
      : row.insufficientThisWeek
        ? `「${repo}」は今週の有効観測がまだ薄いです（先週 ${ratePct(row.lastWeekRate)}）。0% 悪化とみなさず、共有パックの安定プレフィックスを維持しつつ観測を待ちましょう。`
        : sev === "act"
          ? `「${repo}」は今週の cache read 率が先週より相対 ${Math.round(row.declineRatio * 100)}% 悪化しています（${ratePct(row.lastWeekRate)} → ${ratePct(row.thisWeekRate)}）。先頭の安定プレフィックスが揺れている可能性が高いです。`
          : sev === "watch"
            ? `「${repo}」は軽度の悪化または境界域です（${ratePct(row.lastWeekRate)} → ${ratePct(row.thisWeekRate)}）。可変メモが先頭に混ざっていないか確認してください。`
            : `「${repo}」の再利用率は悪化していません（今週 ${ratePct(row.thisWeekRate)}）。共有パックの順序規約を維持してください。`;

  // 正典: docs/harness-pack/README.md の「チェックリスト（trim / 安定）」と同一文言で
  // 同期させる(5項目目の /harness 再確認は上の nextSteps 側に既にあるため含めない)。
  const checklist = [
    "先頭ブロックは先週と同じ並び・同じ文言か（日付・一時メモを先頭に足していないか）",
    "「今日だけ」「今週の Issue」は先頭ではなく、会話または可変節の後ろか",
    "長い手順書は skill / ドキュメントへのポインタに置き換えたか",
    "ツール定義や MCP 一覧を毎セッション全文で増やしていないか",
  ];

  const candidatePatches = [
    {
      target: "CLAUDE.md または AGENTS.md（repo 根）",
      suggestion:
        "安定プレフィックスを docs/harness-pack/templates の順に揃え、日付付き・今週の焦点は可変節へ移す（差分提案のみ・強制書き込みしない）。",
    },
    {
      target: ".cursor/rules（短い alwaysApply）",
      suggestion:
        "常時適用ルールを短く固定し、プロジェクト一時メモは globs 付きの別 rule に分離する。",
    },
    {
      target: "グローバル ~/.claude/CLAUDE.md",
      suggestion:
        "毎セッション全文ロードされる節を短いポインタに trim する（CloudWatch 監視節の削減と同型）。",
    },
  ];

  const nextSteps =
    sev === "ok" && row && !row.insufficientThisWeek
      ? [
          "維持ラインはクリア。より良くするならチェックリストを1項目でも実行",
          "目標の目安: cache read 80%超（今週の数値と比較）",
          "原理: /harness/concepts/prompt-cache",
          "適用後は record_application で appliedTo にこの repo を含める",
          "翌週 /harness で再利用率を確認する",
        ]
      : [
          "原理: /harness/concepts/prompt-cache",
          "共有パック: docs/harness-pack/README.md",
          "適用後は record_application で appliedTo にこの repo を含める",
          "翌週 /harness で当該 repo の再利用率を確認する",
        ];

  return {
    repo,
    observed: row
      ? {
          thisWeekRate: row.thisWeekRate,
          lastWeekRate: row.lastWeekRate,
          declineRatio: row.declineRatio,
          thisWeekTokens: row.thisWeekTokens,
        }
      : null,
    severity: sev,
    summary,
    checklist,
    candidatePatches,
    nextSteps,
  };
}

export async function suggestCachePrefixFix(
  repo: string,
  now: Date = new Date()
): Promise<CachePrefixPrescription> {
  const trimmed = repo.trim();
  if (!trimmed) {
    throw new Error("repo が空です");
  }
  const rates = await repoCacheReadRates(now, { take: 50 });
  const row =
    rates.find((r) => r.repo === trimmed) ??
    rates.find((r) => r.repo.endsWith(trimmed) || trimmed.endsWith(r.repo)) ??
    null;
  return buildCachePrefixPrescription(trimmed, row);
}

export function formatPrescriptionMarkdown(p: CachePrefixPrescription): string {
  const lines = [
    `# キャッシュ先頭の処方: ${p.repo}`,
    "",
    `深刻度: **${p.severity}**`,
    "",
    p.summary,
    "",
    "## 観測",
    p.observed
      ? [
          `- 今週 cache read 率: ${(p.observed.thisWeekRate * 100).toFixed(1)}%`,
          `- 先週: ${(p.observed.lastWeekRate * 100).toFixed(1)}%`,
          `- 前週比相対変化: ${p.observed.declineRatio >= 0 ? "悪化" : "改善"} ${Math.abs(Math.round(p.observed.declineRatio * 100))}%`,
          `- 今週トークン量: ${p.observed.thisWeekTokens}`,
        ].join("\n")
      : "- （観測なし）",
    "",
    "## チェックリスト",
    ...p.checklist.map((c) => `- [ ] ${c}`),
    "",
    "## 候補パッチ（提案のみ）",
    ...p.candidatePatches.flatMap((c) => [
      `### ${c.target}`,
      c.suggestion,
      "",
    ]),
    "## 次の一手",
    ...p.nextSteps.map((s) => `- ${s}`),
  ];
  return lines.join("\n");
}
