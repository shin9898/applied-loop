// 出題生成のデバッグ: 実際のエラーを直接表示する
// 使い方: npx tsx scripts/debug-gate-gen.ts
import { prisma } from "../src/lib/db";
import { generateGate, recordEvent } from "../src/lib/gate";
import { runHeadlessLLM } from "../src/lib/headless-llm";

async function main() {
  console.log("== 1. runHeadlessLLM 直接テスト ==");
  try {
    const out = await runHeadlessLLM(
      '日本語で OK とだけ返してください。JSON: {"ok": true}'
    );
    console.log("OK:", out.slice(0, 300));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n== 2. recordEvent + generateGate (実在コミット) ==");
  // 既存のテスト用 DevEvent を消してから実在コミットで試す
  await prisma.devEvent.deleteMany({ where: { ref: "3e9a720" } });
  const ref = "3e9a720";
  const result = await recordEvent({
    kind: "commit",
    repo: "applied-loop",
    repoPath: "/Users/koki/tools/applied-loop",
    ref,
    summary: "Add MVP: event-driven learning loop",
  });
  console.log("recordEvent:", result);
  if (result.outcome === "fired") {
    await generateGate(result.eventId);
    const event = await prisma.devEvent.findUnique({
      where: { id: result.eventId },
    });
    console.log("after generateGate:", {
      fired: event?.fired,
      skipReason: event?.skipReason,
    });
    const gates = await prisma.gate.findMany({
      where: { eventId: result.eventId },
    });
    console.log("gates:", gates);
  }
}

main().finally(() => process.exit(0));
