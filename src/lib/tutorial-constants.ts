/** チュートリアル用の固定 ID（seed / 診断で共有） */
export const TUTORIAL_GATE_ID = "tutorial-sample-gate";
export const TUTORIAL_ENTRY_ID = "tutorial-sample-entry";
export const TUTORIAL_MISC_ID = "tutorial-sample-misc";

export type TutorialLlmTrack = "claude" | "cursor" | "codex" | "jumon";

export const TUTORIAL_LLM_LABELS: Record<TutorialLlmTrack, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  jumon: "じゅもん（アプリ内）",
};

/** 貼るだけの依頼文。ツール名は文中に埋め、ユーザーはコピーだけする（ADR-0019 P0 B4-2） */
export function tutorialPastePrompt(
  track: TutorialLlmTrack,
  mcpUrl = "http://localhost:3100/api/mcp",
): string {
  const common = [
    "Applied Loop の MCP（applied-loop）を使ってください。",
    "【最初にやること】まず list_pending_gates を呼び、出題中のしれん（理解度チェック）を一覧してください。",
    "一覧が出たら、どれを解くか短く提案してください。",
    "続けて morning_briefing で今日の要点を1段落にまとめてください。",
    "合否は会話中に断定せず、回答はユーザーが提出を明示したあと answer_gate で送ってください。",
    "結果確認は get_gate_result か Web のしれん画面です。",
  ].join("\n");

  if (track === "jumon") {
    return [
      "（この文はアプリの『じゅもんをとなえる』に貼るか、開いた Claude/Codex に貼ってください）",
      "",
      common,
    ].join("\n");
  }
  if (track === "claude") {
    return [
      "（Claude Code のチャットにこのまま貼る）",
      "",
      common,
      "",
      "MCP 未登録なら先に（その環境で）:",
      `claude mcp add --transport http applied-loop ${mcpUrl} --header "Authorization: Bearer <MCP_TOKEN>"`,
    ].join("\n");
  }
  if (track === "cursor") {
    return [
      "（Cursor の Agent チャットにこのまま貼る。先に MCP へ applied-loop を登録）",
      "",
      common,
      "",
      `MCP URL: ${mcpUrl}`,
      "Cloud Agent なら Desktop の mcp.json ではなく /setup の Cloud カード（任意・後回しで可）。",
    ].join("\n");
  }
  return [
    "（Codex のチャットにこのまま貼る。先に config へ applied-loop を登録）",
    "",
    common,
    "",
    `MCP URL: ${mcpUrl}`,
  ].join("\n");
}

export const TUTORIAL_TERMS: { ui: string; plain: string }[] = [
  { ui: "ぼうけんのしょ", plain: "Web ダッシュボード全体" },
  { ui: "しれん", plain: "理解度チェック（出題）" },
  { ui: "じゅもん", plain: "アプリ内から LLM／MCP を開く導線" },
  { ui: "ずかん", plain: "つまずき／誤解の一覧" },
  { ui: "じゅんび", plain: "セットアップ／チュートリアル画面（/setup）" },
  { ui: "たたかう", plain: "しれんの解答画面へ進む" },
];
