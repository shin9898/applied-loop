/**
 * MCP エンドポイント URL の解決とクライアント設定スニペット。
 * Cloud Agent 向け Reachable MCP（トンネル／公開 URL）の薄い楔。
 */

export type McpEndpointInfo = {
  /** アプリ原点（末尾スラッシュなし） */
  baseUrl: string;
  /** Streamable HTTP MCP URL */
  mcpUrl: string;
  /** localhost 以外（Cloud から届きうる） */
  reachable: boolean;
  /** MCP_TOKEN が設定されているか */
  tokenConfigured: boolean;
};

function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

type EnvMap = Record<string, string | undefined>;

/** APPLIED_LOOP_URL / MCP_PUBLIC_URL → 原点。未設定は localhost:3100 */
export function resolveAppliedLoopBaseUrl(env: EnvMap = process.env): string {
  const raw =
    env.MCP_PUBLIC_URL?.trim() ||
    env.APPLIED_LOOP_URL?.trim() ||
    "http://localhost:3100";
  return trimBase(raw);
}

export function mcpEndpointUrl(env: EnvMap = process.env): string {
  return `${resolveAppliedLoopBaseUrl(env)}/api/mcp`;
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return true;
  }
}

/** Host / X-Forwarded-Host が手元ループバックか */
export function isLocalRequestHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(",")[0]?.trim().toLowerCase() ?? "";
  const bare = host.replace(/:\d+$/, "");
  return bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]" || bare === "::1";
}

export function getMcpEndpointInfo(env: EnvMap = process.env): McpEndpointInfo {
  const baseUrl = resolveAppliedLoopBaseUrl(env);
  return {
    baseUrl,
    mcpUrl: `${baseUrl}/api/mcp`,
    reachable: !isLoopbackBaseUrl(baseUrl),
    tokenConfigured: Boolean(env.MCP_TOKEN?.trim()),
  };
}

export type McpClientSnippets = {
  cursorJson: string;
  /** 手元 / SSH 上の Claude Code CLI 用 */
  claudeCli: string;
  /**
   * Claude Code on the web が読むプロジェクト scope。
   * `type: http` 必須。秘密は ${MCP_TOKEN}（公式の env 展開）。
   */
  claudeProjectJson: string;
  /**
   * Codex 公式の Streamable HTTP + bearer_token_env_var。
   * 値は環境変数 MCP_TOKEN（TOML にトークン本文を置かない）。
   */
  codexToml: string;
};

/** LLM クライアントへ貼る設定片（トークンはプレースホルダ可） */
export function buildMcpClientSnippets(opts: {
  mcpUrl: string;
  token?: string;
}): McpClientSnippets {
  const token = opts.token?.trim() || "<MCP_TOKEN>";
  const cursorJson = JSON.stringify(
    {
      mcpServers: {
        "applied-loop": {
          url: opts.mcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
  const claudeCli = [
    `claude mcp add --transport http applied-loop ${opts.mcpUrl} \\`,
    `  --header "Authorization: Bearer ${token}"`,
    `# Web 向けにリポジトリへ書くなら: --scope project（.mcp.json）。秘密は環境変数推奨`,
  ].join("\n");
  const claudeProjectJson = JSON.stringify(
    {
      mcpServers: {
        "applied-loop": {
          type: "http",
          url: opts.mcpUrl,
          headers: {
            Authorization: "Bearer ${MCP_TOKEN}",
          },
        },
      },
    },
    null,
    2,
  );
  const codexToml = [
    `# .codex/config.toml（project・trusted）または ~/.codex/config.toml`,
    `# 事前に: export MCP_TOKEN=...  （同じホストの環境変数）`,
    `[mcp_servers.applied-loop]`,
    `url = "${opts.mcpUrl}"`,
    `bearer_token_env_var = "MCP_TOKEN"`,
  ].join("\n");
  return { cursorJson, claudeCli, claudeProjectJson, codexToml };
}
