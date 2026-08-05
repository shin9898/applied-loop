import { after } from "next/server";
import { z } from "zod";
import { recordEvent, generateGate } from "@/lib/gate";

export const dynamic = "force-dynamic";

const eventSchema = z.object({
  kind: z.string().min(1).max(40),
  repo: z.string().min(1).max(200),
  repoPath: z.string().max(500).optional(),
  ref: z.string().min(1).max(120),
  summary: z.string().max(500).optional(),
});

/**
 * hook からのイベント受信 (ADR-0006 §1)。
 * 認証は MCP と同じ Bearer トークン。出題生成は非同期 (after) で行う。
 */
export async function POST(request: Request) {
  const token = process.env.MCP_TOKEN;
  if (token) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
