import { prisma } from "@/lib/db";
import { requireBearerToken } from "@/lib/api-auth";
import {
  buildHarnessRunUpsertArgs,
  parseHarnessRunPayload,
} from "@/lib/harness-run-ingestion";

export const dynamic = "force-dynamic";

/**
 * ハーネス観測の upsert (ADR-0009 §3)。
 * 認証は /api/events・MCP と同じ Bearer (MCP_TOKEN)。
 * 会話本文は受け取らない (メタデータのみ)。
 */
export async function POST(request: Request) {
  const denied = requireBearerToken(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = parseHarnessRunPayload(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const row = await prisma.harnessRun.upsert(buildHarnessRunUpsertArgs(data));

  return Response.json({ ok: true, id: row.id });
}
