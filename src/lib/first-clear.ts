/**
 * 初 CLEAR 検知（B3-3 段階開示）。
 * チュートリアルサンプル以外の合格が1件あれば証跡面を解放する。
 */
import { prisma } from "@/lib/db";
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";

export async function hasFirstClear(): Promise<boolean> {
  const n = await prisma.gate.count({
    where: {
      status: { in: ["passed", "self_graded_pass"] },
      NOT: { id: TUTORIAL_GATE_ID },
    },
  });
  return n > 0;
}
