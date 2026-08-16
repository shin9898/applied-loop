/**
 * /api/events・/api/harness-runs 共通の Bearer 認証。
 * MCP_TOKEN 未設定時に素通りさせない（配布前提の既定値, ADR-0015 追記）。
 * MCP 本体 (/api/mcp) は withAuth 側で reachable 判定込みの検証を行う。
 */
export function requireBearerToken(request: Request): Response | null {
  const token = process.env.MCP_TOKEN?.trim();
  if (!token) {
    return Response.json(
      {
        error:
          "MCP_TOKEN が未設定。npm run setup で生成するか .env に設定して再起動する",
      },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
