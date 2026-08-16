import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireBearerToken } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const toolSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(40).optional(),
  calls: z.number().int().nonnegative(),
});

const harnessRunSchema = z.object({
  harness: z.enum(["claude", "codex"]),
  sessionId: z.string().min(1).max(200),
  model: z.string().max(120).nullable().optional(),
  repo: z.string().max(200).nullable().optional(),
  tools: z.array(toolSchema).max(200).optional(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheCreate: z.number().int().nonnegative().default(0),
  thinking: z.number().int().nonnegative().default(0),
  turns: z.number().int().nonnegative().default(0),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
});

/**
 * ハーネス観測の upsert (ADR-0009 §3)。
 * 認証は /api/events・MCP と同じ Bearer (MCP_TOKEN)。
 * 会話本文は受け取らない (メタデータのみ)。
 */
export async function POST(request: Request) {
  const denied = requireBearerToken(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = harnessRunSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const toolsJson = data.tools ? JSON.stringify(data.tools) : null;
  const startedAt = new Date(data.startedAt);
  const endedAt = data.endedAt ? new Date(data.endedAt) : null;

  const row = await prisma.harnessRun.upsert({
    where: {
      harness_sessionId: {
        harness: data.harness,
        sessionId: data.sessionId,
      },
    },
    create: {
      harness: data.harness,
      sessionId: data.sessionId,
      model: data.model ?? null,
      repo: data.repo ?? null,
      tools: toolsJson,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      cacheRead: data.cacheRead,
      cacheCreate: data.cacheCreate,
      thinking: data.thinking,
      turns: data.turns,
      startedAt,
      endedAt,
    },
    update: {
      model: data.model ?? null,
      repo: data.repo ?? null,
      tools: toolsJson,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      cacheRead: data.cacheRead,
      cacheCreate: data.cacheCreate,
      thinking: data.thinking,
      turns: data.turns,
      startedAt,
      endedAt,
    },
  });

  return Response.json({ ok: true, id: row.id });
}
