/**
 * Cloud / リモート Agent 向け Reachable MCP の導線コピー。
 * /setup UI・docs・print-cloud-mcp-config で共有する。
 *
 * Cursor Cloud Agent は dogfood 済み。Claude / Codex は公式 docs に基づく
 * （未 dogfood）。過信を避けるため面ごとに登録先を分けて書く。
 */

export type CloudMcpClient = "cursor" | "claude" | "codex";

export const CLOUD_MCP_CLIENT_LABELS: Record<CloudMcpClient, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  codex: "Codex",
};

/** Cloud セッションに貼る疎通確認文（answer_gate は呼ばせない） */
export function cloudMcpVerifyPrompt(): string {
  return [
    "applied-loop の morning_briefing を呼んで要点をまとめて。",
    "続けて list_pending_gates で最大3件を見て、次に解くゲートを1つ提案して。",
    "answer_gate は私が「解く」と言うまで呼ばない。",
    "MCP が見えない / 401 / timeout ならそこで止めて原因を報告して。",
  ].join("\n");
}

export type CloudMcpClientGuide = {
  id: CloudMcpClient;
  /** 主登録先の一文 */
  registerWhere: string;
  /** Desktop / 別ホストでは足りない、という罠 */
  desktopTrap: string;
  steps: string[];
  /** Cursor Header フォームなど */
  headerGotcha?: string;
  configLabel: string;
  /** 未 dogfood のとき UI に出す注記 */
  confidenceNote?: string;
};

export function cloudMcpClientGuides(): CloudMcpClientGuide[] {
  return [
    {
      id: "cursor",
      registerWhere:
        "https://cursor.com/agents →「+」→ MCP Servers → Add MCP（HTTP）",
      desktopTrap:
        "Desktop の ~/.cursor/mcp.json は Cloud Agent に効かない。必ず Agents 画面で Add する。",
      steps: [
        "Type: HTTP。URL に下の mcp URL を入れる",
        "Headers: Key は Authorization、Value は Bearer <MCP_TOKEN>（Key に Bearer と書かない）",
        "保存して ON / ready を確認する",
        "新しい Cloud Agent を起動し、下の検証文を貼る",
      ],
      headerGotcha: "Key = Authorization ／ Value = Bearer <MCP_TOKEN>",
      configLabel: "Cursor 用 JSON（参考。Cloud では UI に同じ値を入れる）",
    },
    {
      id: "claude",
      registerWhere:
        "面で違う: Web はリポジトリ根の .mcp.json ／ 手元・SSH の CLI は claude mcp add",
      desktopTrap:
        "手元の ~/.claude.json（local/user scope）は Claude Code on the web に載らない。Web はプロジェクトの .mcp.json を読む（公式）。",
      steps: [
        "Reachable URL（トンネル）が生きていることを確認する",
        "Web なら: リポジトリ根に下の .mcp.json を置く（type: http 必須。トークンは ${MCP_TOKEN}）。コミット or その環境が読める場所へ",
        "手元 / リモート CLI なら: 下の claude mcp add をそのマシンで実行（--scope project なら .mcp.json に書かれる）",
        "セッションで /mcp → applied-loop。初回は project 承認プロンプトあり",
        "下の検証文を貼る",
      ],
      configLabel: "Claude Code — 主に .mcp.json（Web）／補助 CLI",
      confidenceNote:
        "公式 docs 準拠・未 dogfood。claude.ai Connectors は別経路（組織設定）。個人トンネル+Bearer は .mcp.json / CLI を推奨。",
    },
    {
      id: "codex",
      registerWhere:
        "Codex が動いているホストの config: 持ち運びなら .codex/config.toml（trusted project）、同一マシンなら ~/.codex/config.toml",
      desktopTrap:
        "CLI / IDE / ChatGPT desktop は同一ホスト上で config を共有する（公式）。別ホストのセッションに Mac の ~/.codex は自動では載らない。",
      steps: [
        "Reachable URL が、その Codex ホストから HTTPS で届くことを確認する",
        "下の TOML を .codex/config.toml（推奨・trusted）または ~/.codex/config.toml に追記",
        "MCP_TOKEN をそのホストの環境変数に export（bearer_token_env_var が読む。値を TOML に直書きしない）",
        "codex mcp list またはセッションの /mcp で接続を確認",
        "下の検証文を貼る",
      ],
      configLabel: "Codex 用 TOML（公式推奨は bearer_token_env_var）",
      confidenceNote:
        "公式 docs 準拠・未 dogfood。Cursor のような別 Cloud 専用 Add UI は未確認。同一ホストなら user config でも可。",
    },
  ];
}

/** トンネル〜.env までの共通手順（UI / docs 用） */
export const CLOUD_MCP_TUNNEL_STEPS = [
  "手元で npm run dev:all が動いていること",
  "別ターミナル: cloudflared tunnel --url http://localhost:3100",
  "表示された https://….trycloudflare.com を .env の APPLIED_LOOP_URL に書く（MCP_TOKEN 必須）",
  "Next を再起動し、/setup の MCP URL が Reachable になることを確認",
] as const;
