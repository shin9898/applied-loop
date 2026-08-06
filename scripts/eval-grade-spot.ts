/**
 * 採点再現性スポット（B11-2）。
 * 直近の採点済み Gate（または --gateId）の同一 Q/A を2回採点し、verdict 一致を測る。
 * DB は書き換えない。
 *
 * Usage:
 *   npx tsx scripts/eval-grade-spot.ts
 *   npx tsx scripts/eval-grade-spot.ts --gateId <id>
 *   npx tsx scripts/eval-grade-spot.ts --take 3
 */
import { prisma } from "../src/lib/db";
import { spotCheckGradeConsistency } from "../src/lib/gate";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

async function main() {
  const gateId = argValue("--gateId");
  const take = Math.max(1, Number(argValue("--take") ?? "1") || 1);

  const gates = gateId
    ? await prisma.gate.findMany({
        where: { id: gateId },
        take: 1,
      })
    : await prisma.gate.findMany({
        where: {
          answer: { not: null },
          status: {
            in: ["passed", "failed", "self_graded_pass", "self_graded_fail"],
          },
        },
        orderBy: { gradedAt: "desc" },
        take,
      });

  if (gates.length === 0) {
    console.error("採点済み Gate がありません（先に1問採点せよ）");
    process.exit(1);
  }

  let agree = 0;
  let total = 0;

  console.log("# Grade reproducibility spot check (B11-2)");
  console.log("");

  for (const g of gates) {
    if (!g.answer) continue;
    let criteria: string[] | null = null;
    if (g.rubricCriteria) {
      try {
        const parsed = JSON.parse(g.rubricCriteria) as unknown;
        if (Array.isArray(parsed)) {
          criteria = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        criteria = null;
      }
    }

    console.log(`gateId: ${g.id}`);
    console.log(`stored: ${g.status}`);
    const r = await spotCheckGradeConsistency({
      question: g.question,
      answer: g.answer,
      rubricCriteria: criteria,
    });
    total += 1;
    if (r.agree) agree += 1;
    const label = (v: boolean | null) =>
      v === true ? "pass" : v === false ? "fail" : "null";
    console.log(
      `  run1=${label(r.a)}  run2=${label(r.b)}  agree=${r.agree ? "yes" : "no"}`,
    );
    console.log("");
  }

  const rate = total === 0 ? 0 : Math.round((agree / total) * 1000) / 10;
  console.log(`一致率: ${rate}% (${agree}/${total})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
