// 実験#1 の seed: 「この開発自体」を最初の30日実験として記録する (メタ dogfooding)。
// 使い方: npx tsx scripts/seed-exp1.ts

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const entry = await prisma.entry.findFirst({
    where: { title: { contains: "プロダクトマネジメント" } },
  });
  if (!entry) throw new Error("PART I entry not found. Run scripts/import.ts first.");

  const existing = await prisma.experiment.findFirst({
    where: { entryId: entry.id, status: "active" },
  });
  if (existing) {
    console.log(`experiment#1 already exists: ${existing.id}`);
    await prisma.$disconnect();
    return;
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 30 * 86400000);
  const exp = await prisma.experiment.create({
    data: {
      entryId: entry.id,
      action: "applied-loop に自分の学びと適用を記録し続ける（開発も学びも）",
      successMetric: "30日後に適用記録が12件以上（pm-learn 実績の週3件ペース再現）",
      startDate,
      endDate,
    },
  });
  console.log(`experiment#1 created: ${exp.id} (${startDate.toISOString().slice(0, 10)} ~ ${endDate.toISOString().slice(0, 10)})`);
  await prisma.$disconnect();
}

main();
