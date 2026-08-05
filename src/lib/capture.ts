import { after } from "next/server";
import { prisma } from "@/lib/db";
import { confirmMisconception, parseGateSourceContext } from "@/lib/gate";
import { suggestLinksForTarget } from "@/lib/goal";

export type TriageAction = "accept" | "skip";

export type TriageResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * 受信箱の仕分け (ADR-0010)。accept 時は Entry/Misconception 化し、
 * LLM 提案 (goal_suggestions / domain) を after() で起動する。
 */
export async function triageCapture(
  captureId: string,
  action: TriageAction
): Promise<TriageResult> {
  const id = captureId.trim();
  if (!id) return { ok: false, message: "captureId が空です。" };

  const capture = await prisma.capture.findUnique({ where: { id } });
  if (!capture) return { ok: false, message: `Capture が見つかりません (id: ${id})。` };
  if (capture.status !== "pending") {
    return {
      ok: false,
      message: `既に処理済みです (status: ${capture.status})。`,
    };
  }

  if (action === "skip") {
    await prisma.capture.update({
      where: { id },
      data: { status: "ignored", reviewedAt: new Date() },
    });
    return { ok: true, message: `無視しました (id: ${id})。` };
  }

  // accept
  if (capture.sourceTool === "gate") {
    const { gateId, rootCause } = parseGateSourceContext(capture.sourceContext);
    await confirmMisconception(capture.title, gateId, rootCause);
    await prisma.capture.update({
      where: { id },
      data: { status: "accepted", reviewedAt: new Date() },
    });
    return {
      ok: true,
      message: `誤解として登録しました (id: ${id})。72 時間後に再出題されます。`,
    };
  }

  const entry = await prisma.entry.create({
    data: {
      title: capture.title,
      note: capture.note,
      kind: "insight",
      source: capture.sourceContext || capture.sourceTool,
    },
  });
  await prisma.capture.update({
    where: { id },
    data: { status: "accepted", reviewedAt: new Date(), entryId: entry.id },
  });

  // ADR-0008: active Goal への紐付け提案 (0 件なら no-op。タイトルのみ渡す)
  after(async () => {
    await suggestLinksForTarget({
      targetType: "entry",
      targetId: entry.id,
      title: entry.title,
    }).catch((e) => console.error("[goal] suggest on accept failed:", e));
  });

  return {
    ok: true,
    message: `学びとして登録しました (entryId: ${entry.id})。目標紐付け提案を非同期で起動しました。`,
  };
}
