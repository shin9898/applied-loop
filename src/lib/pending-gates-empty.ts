/**
 * list_pending_gates が 0 件のときの診断付き応答（Fable G2 / B4-3）。
 * 「空＝何も起きていない」に見せない。
 */
export function buildEmptyPendingGatesMessage(input: {
  tutorialGateId: string;
  sampleSubmitted: boolean;
}): string {
  const { tutorialGateId, sampleSubmitted } = input;
  if (sampleSubmitted) {
    return [
      "# 出題中のしれん: 0 件",
      "",
      "サンプルしれんは提出済みです。いま解く出題はありません（空＝未接続ではない）。",
      "次の一手（どれか1つ）:",
      `- get_gate_result(gateId: "${tutorialGateId}") でサンプルの判定を見る`,
      `- Web: http://localhost:3100/gates/${tutorialGateId}`,
      "- 本運用の供給: request_gate(diff, repo?) か git hook（./scripts/setup-git-hook.sh <repo>）",
    ].join("\n");
  }
  return [
    "# 出題中のしれん: 0 件",
    "",
    "出題中のしれんはありません。",
    "次の一手: request_gate(diff) で1問作る、または git hook（./scripts/setup-git-hook.sh <repo>）。",
  ].join("\n");
}
