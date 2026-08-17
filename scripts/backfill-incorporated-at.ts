// 実行前に dev.db のバックアップを取ること（`cp dev.db dev.db.bak`）。DevEvent を直接書き換える。
/**
 * 既存の章に入っている材料へ DevEvent.incorporatedAt を後付けする（I3、2026-08-17）。
 *
 * incorporatedAt は 2026-08-16 の Phase1 から生成時にスタンプするようになった列で、
 * それ以前に作られた章の材料は null のまま残っている。null のままだと
 * generateDailyTextbook が「まだ捕捉されていないあふれ」として数え直し、
 * 既に章へ入った材料が再びよみもの帯に並ぶ。
 *
 * 冪等: 既に値が入っている DevEvent は上書きしない。
 * 章に createdAt が無いため、スタンプ値は親 DailyTextbook.createdAt を使う。
 * 同じ材料が複数章に入っている場合は、教科書の古い順に処理して最初の日付を残す。
 *
 * Usage: npx tsx scripts/backfill-incorporated-at.ts
 */
import { prisma } from "../src/lib/db";

function parseMaterialIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

async function main() {
  const chapters = await prisma.dailyTextbookChapter.findMany({
    select: {
      id: true,
      index: true,
      source: true,
      materialIds: true,
      textbook: { select: { dateKey: true, createdAt: true } },
    },
  });
  chapters.sort(
    (a, b) => a.textbook.createdAt.getTime() - b.textbook.createdAt.getTime(),
  );

  let scanned = 0;
  let stamped = 0;
  for (const ch of chapters) {
    const ids = parseMaterialIds(ch.materialIds);
    if (ids.length === 0) continue;
    scanned += ids.length;
    const res = await prisma.devEvent.updateMany({
      where: { id: { in: ids }, incorporatedAt: null },
      data: { incorporatedAt: ch.textbook.createdAt },
    });
    if (res.count > 0) {
      stamped += res.count;
      console.log(
        `${ch.textbook.dateKey}\tch${ch.index}(${ch.source})\t+${res.count}`,
      );
    }
  }
  console.log(
    `# chapters=${chapters.length} materialRefs=${scanned} stamped=${stamped}`,
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
