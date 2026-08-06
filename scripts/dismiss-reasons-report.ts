/**
 * 悪問スキップ理由の集計（B5-4）。
 * Usage: npx tsx scripts/dismiss-reasons-report.ts
 */
import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.gate.groupBy({
    by: ["dismissReason"],
    where: { status: "dismissed" },
    _count: { _all: true },
  });
  if (rows.length === 0) {
    console.log("dismissed gates: 0");
    return;
  }
  console.log("# dismissReason counts");
  for (const r of rows) {
    console.log(`${r.dismissReason ?? "(null)"}\t${r._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
