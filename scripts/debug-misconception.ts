// 誤解確定フローのデバッグ: gate 由来 Capture の accept → Misconception 確定を検証
// 使い方: npx tsx scripts/debug-misconception.ts
import { prisma } from "../src/lib/db";
import { confirmMisconception, scheduleDueGates } from "../src/lib/gate";

async function main() {
  const capture = await prisma.capture.findFirst({
    where: { sourceTool: "gate", status: "pending" },
    orderBy: { capturedAt: "desc" },
  });
  if (!capture) {
    console.log("gate 由来の pending Capture がありません");
    return;
  }
  console.log("対象 Capture:", capture.title);

  // acceptCapture (actions.ts) の gate 分岐と同じ処理を再現
  const gateId = capture.sourceContext?.startsWith("gateId:")
    ? capture.sourceContext.slice("gateId:".length)
    : null;
  await confirmMisconception(capture.title, gateId);
  await prisma.capture.update({
    where: { id: capture.id },
    data: { status: "accepted", reviewedAt: new Date() },
  });

  const m = await prisma.misconception.findFirst({
    orderBy: { createdAt: "desc" },
    include: { gates: { select: { id: true, kind: true, status: true } } },
  });
  console.log("\n== 確定した Misconception ==");
  console.log("concept:", m?.concept);
  console.log("status:", m?.status);
  console.log("nextReviewAt:", m?.nextReviewAt, "(72h 後のはず)");
  console.log("linked gates:", m?.gates);

  // 72h ルールのテスト: nextReviewAt を過去に書き換えて scheduleDueGates を呼ぶ
  console.log("\n== 再出題スケジュールのテスト ==");
  await prisma.misconception.update({
    where: { id: m!.id },
    data: { nextReviewAt: new Date(Date.now() - 1000) },
  });
  const created = await scheduleDueGates();
  console.log("生成された retry Gate 数:", created);
  const retryGate = await prisma.gate.findFirst({
    where: { misconceptionId: m!.id },
    orderBy: { createdAt: "desc" },
  });
  console.log("retry Gate:", {
    kind: retryGate?.kind,
    status: retryGate?.status,
    question: retryGate?.question,
  });
}

main().finally(() => process.exit(0));
