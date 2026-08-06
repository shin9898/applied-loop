/**
 * アプリ内ターミナル (ADR-0015) の WS 認証トークン。
 * terminal-server は MCP_TOKEN と同じ値で照合する。
 */
export function getTerminalWsToken(): string | null {
  const t = process.env.MCP_TOKEN?.trim();
  return t || null;
}

export function isTerminalEnabled(): boolean {
  return process.env.ENABLE_TERMINAL === "true" && !!getTerminalWsToken();
}
