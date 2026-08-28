import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireBearerToken } from "@/lib/api-auth";
import {
  buildHarnessRunUpsertArgs,
  parseHarnessRunPayload,
} from "@/lib/harness-run-ingestion";

export const dynamic = "force-dynamic";

/**
 * A long-running local dev server can retain a Prisma client/build from before
 * an additive migration was merged. Keep the collector failure explicit and
 * actionable instead of returning an opaque 500 (or leaking driver details).
 */
function isSchemaDriftError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  return (
    error instanceof Prisma.PrismaClientValidationError
    && /Unknown argument `[^`]+`/.test(error.message)
  );
}

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
  try {
    const row = await prisma.harnessRun.upsert(buildHarnessRunUpsertArgs(data));
    return Response.json({ ok: true, id: row.id });
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    console.error("[harness-runs] database schema is behind application code", {
      code: error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : "client_schema_mismatch",
    });
    return Response.json(
      {
        error: "database schema is out of date",
        code: "SCHEMA_OUT_OF_DATE",
        remediation: "Run npm run setup (or npx prisma migrate deploy), then restart the dev server.",
      },
      { status: 503 },
    );
  }
}
