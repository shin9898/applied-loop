/**
 * 供給健全性の週次3数値（B9-3）。
 * - 発火数: 今週 fired=true の DevEvent
 * - 生成失敗率: gen_failed* / (fired + gen_failed*)
 * - 回答率: answeredAt あり / 今週作成 Gate（dismissed 除外）
 *
 * Usage: npx tsx scripts/supply-health-weekly.ts
 */
import { prisma } from "../src/lib/db";
import { weekRangeJST } from "../src/lib/date";

async function main() {
  const { start, end, weekKey } = weekRangeJST(new Date());

  const [fired, genFailed, createdGates, answeredGates] = await Promise.all([
    prisma.devEvent.count({
      where: { fired: true, receivedAt: { gte: start, lt: end } },
    }),
    prisma.devEvent.count({
      where: {
        skipReason: { startsWith: "gen_failed" },
        receivedAt: { gte: start, lt: end },
      },
    }),
    prisma.gate.count({
      where: {
        createdAt: { gte: start, lt: end },
        NOT: { status: "dismissed" },
      },
    }),
    prisma.gate.count({
      where: {
        createdAt: { gte: start, lt: end },
        answeredAt: { not: null },
        NOT: { status: "dismissed" },
      },
    }),
  ]);

  const genDenom = fired + genFailed;
  const genFailRate =
    genDenom === 0 ? null : Math.round((genFailed / genDenom) * 1000) / 10;
  const answerRate =
    createdGates === 0
      ? null
      : Math.round((answeredGates / createdGates) * 1000) / 10;

  console.log(`# Supply health ${weekKey}`);
  console.log(`range: ${start.toISOString()} .. ${end.toISOString()}`);
  console.log("");
  console.log(`発火数: ${fired}`);
  console.log(
    `生成失敗率: ${genFailRate == null ? "-" : `${genFailRate}%`} (failed=${genFailed} / denom=${genDenom})`,
  );
  console.log(
    `回答率: ${answerRate == null ? "-" : `${answerRate}%`} (answered=${answeredGates} / created=${createdGates})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
