// 週のしょのcron用エントリポイント。ensureRecentWeeklyTextbooks は冪等なので
// 手動実行しても launchd から叩かれても安全（既存週は即skip）。
//
// server-only パッケージ利用モジュール（weekly-textbook.ts）を tsx 直接実行から
// 解決可能にするため、NODE_OPTIONS="--conditions=react-server" が必須。
// Usage: npm run weekly:textbook
//   （直接叩く場合: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/generate-weekly-textbook.ts）
import { prisma } from "../src/lib/db";
import { ensureRecentWeeklyTextbooks } from "../src/lib/weekly-textbook";

async function main() {
  await ensureRecentWeeklyTextbooks(8);
  const rows = await prisma.weeklyTextbook.findMany({
    orderBy: { weekKey: "desc" },
    take: 3,
    select: { weekKey: true, materialCount: true, chapterCount: true },
  });
  console.log(`# ensured recent weekly textbooks, latest 3:`);
  for (const r of rows) {
    console.log(`${r.weekKey}\tmaterials=${r.materialCount}\tchapters=${r.chapterCount}`);
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
