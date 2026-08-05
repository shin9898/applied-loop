import { prisma } from "@/lib/db";
import { weekRangeJST } from "@/lib/date";

export type QuadrantFlows = {
  weekKey: string;
  /** 未知の未知の発見: 今週作成の Misconception + ハーネスパターン検出数 */
  unknownUnknownDiscovery: number;
  misconceptionCreated: number;
  harnessPatternsDetected: number;
  /** 知の未知 → 知の知: 今週 resolved の Misconception */
  knownUnknownToKnownKnown: number;
  /** 未知の知 → 知の知: 合格ゲート answerMode=researched */
  unknownKnownToKnownKnown: number;
  /** 知の知の維持: 合格ゲート kind=sr_review */
  knownKnownMaintenance: number;
};

const PASSED_STATUSES = ["passed", "self_graded_pass"] as const;

/**
 * 認知 4 象限の週次フロー集計 (ADR-0013 §2)。
 * ハーネス観測が未導入の環境でも misconception 件数だけで動く。
 */
export async function computeQuadrantFlows(
  now: Date = new Date()
): Promise<QuadrantFlows> {
  const { start, end, weekKey } = weekRangeJST(now);

  const [
    misconceptionCreated,
    harnessPatternsDetected,
    knownUnknownToKnownKnown,
    unknownKnownToKnownKnown,
    knownKnownMaintenance,
  ] = await Promise.all([
    prisma.misconception.count({
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ["open", "regressed"] },
      },
    }),
    prisma.capture
      .count({
        where: {
          sourceTool: "harness",
          capturedAt: { gte: start, lt: end },
        },
      })
      .catch(() => 0),
    prisma.misconception.count({
      where: {
        status: "resolved",
        resolvedAt: { gte: start, lt: end },
      },
    }),
    prisma.gate.count({
      where: {
        status: { in: [...PASSED_STATUSES] },
        answerMode: "researched",
        OR: [
          { gradedAt: { gte: start, lt: end } },
          { gradedAt: null, answeredAt: { gte: start, lt: end } },
        ],
      },
    }),
    prisma.gate.count({
      where: {
        status: { in: [...PASSED_STATUSES] },
        kind: "sr_review",
        OR: [
          { gradedAt: { gte: start, lt: end } },
          { gradedAt: null, answeredAt: { gte: start, lt: end } },
        ],
      },
    }),
  ]);

  return {
    weekKey,
    unknownUnknownDiscovery: misconceptionCreated + harnessPatternsDetected,
    misconceptionCreated,
    harnessPatternsDetected,
    knownUnknownToKnownKnown,
    unknownKnownToKnownKnown,
    knownKnownMaintenance,
  };
}
