import { after } from "next/server";
import { z } from "zod";
import { recordEvent, generateGate } from "@/lib/gate";
import { requireBearerToken } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const eventSchema = z.object({
  kind: z.string().min(1).max(40),
  repo: z.string().min(1).max(200),
  repoPath: z.string().max(500).optional(),
  ref: z.string().min(1).max(120),
  summary: z.string().max(500).optional(),
  // hook がコミット時点で添付する base64 diff（~9KB を base64 化した上限）
  diffB64: z.string().max(16000).optional(),
});

/**
 * hook からのイベント受信 (ADR-0006 §1)。
 * 認証は MCP と同じ Bearer トークン。出題生成は非同期 (after) で行う。
 */
export async function POST(request: Request) {
  const denied = requireBearerToken(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await recordEvent(parsed.data);
  if (result.outcome === "fired") {
    const eventId = result.eventId;
    after(async () => {
      await generateGate(eventId).catch((e) => {
        console.error("[events] generateGate failed:", e);
      });
    });
  }
  return Response.json(result);
}
