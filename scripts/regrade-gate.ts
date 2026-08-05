/**
 * grading_failed / answered のゲートを再採点する。
 * Usage: npx tsx scripts/regrade-gate.ts <gateId>
 */
import { prisma } from "../src/lib/db";
import { gradeGate } from "../src/lib/gate";

async function main() {
  const id = process.argv[2]?.trim();
  if (!id) {
    console.error("Usage: npx tsx scripts/regrade-gate.ts <gateId>");
    process.exit(1);
  }

  const gate = await prisma.gate.findUnique({ where: { id } });
  if (!gate) {
    console.error("gate not found:", id);
    process.exit(1);
  }
  if (!gate.answer) {
    console.error("gate has no answer");
    process.exit(1);
  }

  await prisma.gate.update({
    where: { id },
    data: { status: "answered", gradeNote: null },
  });
  console.log("reset → answered; grading...", id);
  console.log("PATH has claude?", process.env.PATH?.includes(".local/bin"));

  await gradeGate(id);

  const graded = await prisma.gate.findUnique({ where: { id } });
  console.log("status:", graded?.status);
  console.log("gradeNote:", graded?.gradeNote?.slice(0, 500));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
