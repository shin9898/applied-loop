/**
 * MCP ツールの公開面（ADR-0019 / P0 B1-1）。
 * 既定は core。本人のフル面は MCP_SURFACE=full。
 */

export type McpSurface = "core" | "full";

/** core 面（≤7）。供給対象 repo の確認・登録を含む */
export const MCP_CORE_TOOLS = [
  "morning_briefing",
  "list_pending_gates",
  "request_gate",
  "answer_gate",
  "get_gate_result",
  "watch_repos",
] as const;

export type McpCoreTool = (typeof MCP_CORE_TOOLS)[number];

const CORE_SET = new Set<string>(MCP_CORE_TOOLS);

export function resolveMcpSurface(
  env: Record<string, string | undefined> = process.env,
): McpSurface {
  const raw = env.MCP_SURFACE?.trim().toLowerCase();
  return raw === "full" ? "full" : "core";
}

export function mcpToolAllowedOnSurface(
  toolName: string,
  surface: McpSurface = resolveMcpSurface(),
): boolean {
  if (surface === "full") return true;
  return CORE_SET.has(toolName);
}
