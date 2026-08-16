/**
 * gen_failed* で止まった DevEvent の出題生成を再試行する。
 * 想定ユース: CLI 認証切れ (gen_failed_auth) の復旧後、または
 * diffSnapshot 導入後に git から diff が取れなくなったイベントの救済。
 *
 * Usage: npx tsx scripts/requeue-failed-gen.ts [--limit N] [--dry-run]
 */
import { prisma } from "../src/lib/db";
import { generateGate } from "../src/lib/gate";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 5 : 5;

  const failed = await prisma.devEvent.findMany({
    where: { skipReason: { startsWith: "gen_failed" } },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });

  if (failed.length === 0) {
    console.log("gen_failed* のイベントは無い。");
    return;
  }

  console.log(`# 再試行対象 ${failed.length} 件 (limit=${limit})`);
  for (const e of failed) {
    const snap = e.diffSnapshot ? "snapshot有" : "snapshot無";
    console.log(`- ${e.receivedAt.toISOString()} ${e.repo} ${e.skipReason} [${snap}]`);
  }
  if (dryRun) {
    console.log("(--dry-run のため実行しない)");
    return;
  }

  let ok = 0;
  for (const e of failed) {
    await prisma.devEvent.update({
      where: { id: e.id },
      data: { fired: true, skipReason: null },
    });
    await generateGate(e.id);
    const after = await prisma.devEvent.findUnique({
      where: { id: e.id },
      select: { fired: true, skipReason: true },
    });
    if (after?.fired && !after.skipReason) {
      ok += 1;
      console.log(`✓ ${e.repo} ${e.ref.slice(0, 7)} → 出題生成`);
    } else {
      console.log(`✗ ${e.repo} ${e.ref.slice(0, 7)} → ${after?.skipReason ?? "不明"}`);
    }
  }
  console.log(`\n成功 ${ok} / ${failed.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
