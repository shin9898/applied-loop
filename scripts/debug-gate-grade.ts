// 採点のデバッグ: 最新の pending Gate に回答して gradeGate を直接実行する
// 使い方: npx tsx scripts/debug-gate-grade.ts
import { prisma } from "../src/lib/db";
import { gradeGate } from "../src/lib/gate";

async function main() {
  const gate = await prisma.gate.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (!gate) {
    console.log("pending の Gate がありません");
    return;
  }
  console.log("対象 Gate:", gate.question);

  // わざと浅い回答を入れて failed + 誤解検出の経路を確認する
  const answer = "イベント駆動にしたのは非同期で処理するためです。冪等にしたのはエラーが起きた時のためです。";
  await prisma.gate.update({
    where: { id: gate.id },
    data: { answer, status: "answered", answeredAt: new Date() },
  });
  console.log("回答を保存しました。採点を実行します...");

  await gradeGate(gate.id);

  const graded = await prisma.gate.findUnique({ where: { id: gate.id } });
  console.log("\n== 採点結果 ==");
  console.log("status:", graded?.status);
  console.log("gradeNote:", graded?.gradeNote);

  const captures = await prisma.capture.findMany({
    where: { sourceTool: "gate" },
    orderBy: { capturedAt: "desc" },
    take: 5,
  });
  console.log("\n== gate 由来の受信箱 ==");
  for (const c of captures) {
    console.log(`- [${c.status}] ${c.title} (${c.sourceContext})`);
  }
}

main().finally(() => process.exit(0));
