// 実行前に dev.db のバックアップを取ること（`cp dev.db dev.db.bak-before-band-backfill-<timestamp>`）。
// MaterialBand へ新規行を作る／既存行を更新する。
/**
 * 書庫の物理削除撤回（2026-08-17）に伴うバックフィル。
 *
 * 2026-08-16〜17 の間、generateDailyTextbook は「あふれが1件も残らなくなった repo の帯」を
 * materialBand.deleteMany で物理削除していた（resolvedAt マーカー方式へ変更済み、daily-textbook.ts）。
 * この間に削除された帯の元になった DevEvent（incorporatedAt が null のまま = どの章にも
 * 拾われていない）は、削除撤回後もそのままでは書庫に現れない（帯そのものが無いため）。
 *
 * このスクリプトは incorporatedAt が null な DevEvent 全件を dateKey（JST）×repo でグルーピングし、
 * 生成ロジックと同じ groupMaterialsIntoBandDrafts を通して MaterialBand として復元する。
 *
 * 冪等: 既存の MaterialBand（dateKey, repo）があれば内容を最新の未捕捉材料で上書き更新するのみ。
 *
 * Usage: npx tsx scripts/backfill-material-bands.ts
 */
import { prisma } from "../src/lib/db";
import { dateKeyJST } from "../src/lib/date";
import {
  groupMaterialsIntoBandDrafts,
  type MaterialRow,
} from "../src/lib/daily-textbook-shared";

async function main() {
  const materials: MaterialRow[] = await prisma.devEvent.findMany({
    where: { incorporatedAt: null },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      kind: true,
      repo: true,
      ref: true,
      summary: true,
      skipReason: true,
      receivedAt: true,
      incorporatedAt: true,
    },
  });

  const byDateKey = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    const key = dateKeyJST(m.receivedAt);
    const list = byDateKey.get(key) ?? [];
    list.push(m);
    byDateKey.set(key, list);
  }

  let created = 0;
  let updated = 0;
  for (const [dateKey, rows] of byDateKey) {
    const bands = groupMaterialsIntoBandDrafts(rows);
    for (const band of bands) {
      const existing = await prisma.materialBand.findUnique({
        where: { dateKey_repo: { dateKey, repo: band.repo } },
        select: { id: true },
      });
      await prisma.materialBand.upsert({
        where: { dateKey_repo: { dateKey, repo: band.repo } },
        update: {
          materialIds: JSON.stringify(band.materialIds),
          digest: band.digest,
          count: band.count,
        },
        create: {
          dateKey,
          repo: band.repo,
          materialIds: JSON.stringify(band.materialIds),
          digest: band.digest,
          count: band.count,
        },
      });
      if (existing) {
        updated++;
      } else {
        created++;
      }
      console.log(`${dateKey}\t${band.repo}\t${band.count}件`);
    }
  }
  console.log(
    `# devEvents=${materials.length} bandsCreated=${created} bandsUpdated=${updated}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
