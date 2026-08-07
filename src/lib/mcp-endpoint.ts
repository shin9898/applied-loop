/**
 * MCP エンドポイント URL の解決とクライアント設定スニペット。
 *
 * Desktop / 手元 CLI は常に localMcpUrl（localhost）。
 * Cloud Agent など別ホストは reachableMcpUrl（トンネル／公開 URL）。
 * 両者を混ぜない（Reachable 設定が Desktop 案内を汚染しない）。
 */

export const LOCAL_APPLIED_LOOP_BASE = "http://localhost:3100";

export type McpEndpointInfo = {
  /** 手元用原点（常に localhost:3100） */
  localBaseUrl: string;
  /** 手元用 MCP URL */
  localMcpUrl: string;
  /** 非 loopback の公開原点（未設定なら null） */
  reachableBaseUrl: string | null;
  /** Cloud 用 MCP URL（未設定なら null） */
  reachableMcpUrl: string | null;
  /** env に Reachable URL がある */
  reachable: boolean;
  /** MCP_TOKEN が設定されているか */
  tokenConfigured: boolean;
  /**
   * 設定上の主原点（Reachable があればそれ、なければ local）。
   * Cloud スニペット・認証トリガー向け。Desktop 本線は localMcpUrl。
   */
  baseUrl: string;
  /** baseUrl + /api/mcp（同上） */
  mcpUrl: string;
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
    LOCAL_APPLIED_LOOP_BASE;
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

/** env から Reachable 原点だけ取る（loopback や空は null） */
export function resolveReachableBaseUrl(env: EnvMap = process.env): string | null {
  const raw = env.MCP_PUBLIC_URL?.trim() || env.APPLIED_LOOP_URL?.trim() || "";
  if (!raw) return null;
  const base = trimBase(raw);
  if (isLoopbackBaseUrl(base)) return null;
  return base;
}

export function getMcpEndpointInfo(env: EnvMap = process.env): McpEndpointInfo {
  const localBaseUrl = LOCAL_APPLIED_LOOP_BASE;
  const localMcpUrl = `${localBaseUrl}/api/mcp`;
  const reachableBaseUrl = resolveReachableBaseUrl(env);
  const reachableMcpUrl = reachableBaseUrl
    ? `${reachableBaseUrl}/api/mcp`
    : null;
  const baseUrl = reachableBaseUrl ?? localBaseUrl;
  return {
    localBaseUrl,
    localMcpUrl,
    reachableBaseUrl,
    reachableMcpUrl,
    reachable: Boolean(reachableBaseUrl),
    tokenConfigured: Boolean(env.MCP_TOKEN?.trim()),
    baseUrl,
    mcpUrl: `${baseUrl}/api/mcp`,
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
          type: "http",
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

/** Reachable URL が生きているか（DNS/接続の簡易プローブ） */
export async function probeReachableMcpUrl(
  mcpUrl: string | null | undefined,
  ms = 2500,
): Promise<"ok" | "fail" | "n/a"> {
  if (!mcpUrl) return "n/a";
  try {
    const res = await fetch(mcpUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(ms),
    });
    // Streamable HTTP は GET で 405 等でもホストが生きていれば成功扱い
    void res;
    return "ok";
  } catch {
    return "fail";
  }
}
