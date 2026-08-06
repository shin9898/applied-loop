/**
 * B5-3: 採点 CLI が使える状態なら grading_failed を自動で再採点キューへ戻す。
 * 同一プロセス内はクールダウン付き（手動の retryGateGrading は別経路）。
 */
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { gradeGate } from "@/lib/gate";
import { probeGradingCli } from "@/lib/headless-llm";

const COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_LIMIT = 8;
/** gateId → 最後に自動再キューした時刻 */
const lastAuto = new Map<string, number>();

export async function requeueFailedGradingIfCliReady(opts?: {
  limit?: number;
}): Promise<number> {
  const probe = probeGradingCli();
  if (!probe.ok) return 0;

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const now = Date.now();
  const failed = await prisma.gate.findMany({
    where: { status: "grading_failed" },
    orderBy: { createdAt: "asc" },
    take: limit * 2,
    select: { id: true },
  });

  const ids = failed
    .map((g) => g.id)
    .filter((id) => {
      const t = lastAuto.get(id);
      return t == null || now - t >= COOLDOWN_MS;
    })
    .slice(0, limit);

  if (ids.length === 0) return 0;

  const updated = await prisma.gate.updateMany({
    where: { id: { in: ids }, status: "grading_failed" },
    data: { status: "answered", gradeNote: null },
  });
  if (updated.count === 0) return 0;

  for (const id of ids) {
    lastAuto.set(id, now);
    after(async () => {
      await gradeGate(id).catch((e) =>
        console.error("[gate] auto-regrade failed:", id, e),
      );
    });
  }
  return updated.count;
}
