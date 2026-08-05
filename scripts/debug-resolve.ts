// resolved 遷移の検証: retry Gate で合格 → Misconception resolved
// 使い方: npx tsx scripts/debug-resolve.ts
import { prisma } from "../src/lib/db";
import { gradeGate } from "../src/lib/gate";

async function main() {
  const gate = await prisma.gate.findFirst({
    where: { kind: "retry", status: "pending" },
    orderBy: { createdAt: "desc" },
    include: { misconception: true },
  });
  if (!gate) {
    console.log("pending の retry Gate がありません");
    return;
  }
  console.log("対象 retry Gate:", gate.question);
  console.log("誤解 status (前):", gate.misconception?.status);

  const answer = [
    "学びの証跡とは、知識を登録するイベント、復習で状態を更新するイベント、",
    "実務で適用した記録のイベントを関連づけることで、その知識が実際に使われたかを",
    "後から追跡・集計できる仕組みです。イベントとして独立して記録するため、",
    "再実行や集計の粒度を後から変えても履歴が失われません。",
  ].join("");
  await prisma.gate.update({
    where: { id: gate.id },
    data: { answer, status: "answered", answeredAt: new Date() },
  });
  await gradeGate(gate.id);

  const graded = await prisma.gate.findUnique({
    where: { id: gate.id },
    include: { misconception: true },
  });
  console.log("\n== 採点結果 ==");
  console.log("gate status:", graded?.status);
  console.log("gradeNote:", graded?.gradeNote?.slice(0, 200));
  console.log("\n== 誤解 status (後) ==");
  console.log("status:", graded?.misconception?.status, "(resolved のはず)");
  console.log("resolvedAt:", graded?.misconception?.resolvedAt);
  console.log("nextReviewAt:", graded?.misconception?.nextReviewAt, "(7日後=定着レビュー)");
}

main().finally(() => process.exit(0));
