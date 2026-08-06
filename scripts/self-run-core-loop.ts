/**
 * 本人セルフラン（Activation 正本7点をコード経路で通す）。
 * 前提: npm run setup 済み・DB に tutorial seed あり。
 * サーバは別途 dev:all。setup_opened / zukan_viewed は curl 側でも可。
 *
 * Usage: npx tsx scripts/self-run-core-loop.ts
 */
import { acceptGateAnswer } from "../src/lib/gate-answer";
import { gradeGate, requestGateFromDiff } from "../src/lib/gate";
import { recordActivationOnce } from "../src/lib/activation-funnel";
import { TUTORIAL_GATE_ID } from "../src/lib/tutorial-constants";
import { prisma } from "../src/lib/db";
import { buildFunnelReport } from "../src/lib/activation-funnel";

const SAMPLE_ANSWER = [
  "金曜に AI で出した PR を月曜レビューで「なぜこの境界にしたか」と聞かれ、動くことしか言えなかった。",
  "出荷はできたが、障害時の再現手順を自分の言葉で説明できず、差分の意図が頭に残っていなかった。",
  "動いたことと説明できることは別で、後者の材料が足りなかった。",
].join("");

async function main() {
  console.log("=== self-run core loop ===");

  recordActivationOnce("mcp_touched", { source: "self-run" });
  console.log("✓ mcp_touched");

  const tutorial = await prisma.gate.findUnique({
    where: { id: TUTORIAL_GATE_ID },
    select: { status: true },
  });
  if (!tutorial) {
    throw new Error("tutorial gate missing — run npm run setup / seed:tutorial");
  }

  if (tutorial.status === "pending") {
    const acc = await acceptGateAnswer({
      gateId: TUTORIAL_GATE_ID,
      answer: SAMPLE_ANSWER,
      source: "mcp",
    });
    if (!acc.ok) throw new Error(`accept failed: ${acc.message}`);
    console.log("✓ sample answer accepted (sample_submitted + first_answer)");
  } else {
    recordActivationOnce("sample_submitted", { source: "self-run-already" });
    recordActivationOnce("first_answer", { source: "self-run-already" });
    console.log("✓ sample already submitted — recorded activation if missing");
  }

  // 採点を同期実行（after() を待たない）
  console.log("… grading sample (LLM) …");
  try {
    await gradeGate(TUTORIAL_GATE_ID);
    const g = await prisma.gate.findUnique({
      where: { id: TUTORIAL_GATE_ID },
      select: { status: true },
    });
    console.log(`✓ graded status=${g?.status}`);
    if (
      g &&
      ["passed", "failed", "self_graded_pass", "self_graded_fail", "grading_failed"].includes(
        g.status,
      )
    ) {
      recordActivationOnce("first_verdict", { status: g.status });
      console.log("✓ first_verdict");
    }
  } catch (e) {
    console.warn("grading failed:", e instanceof Error ? e.message : e);
    // 保留でも判定イベントを残せるよう grading_failed を確認
    const g = await prisma.gate.findUnique({
      where: { id: TUTORIAL_GATE_ID },
      select: { status: true },
    });
    if (g?.status === "grading_failed" || g?.status === "answered") {
      recordActivationOnce("first_verdict", { status: g.status });
      console.log(`✓ first_verdict (fallback status=${g.status})`);
    }
  }

  const req = await requestGateFromDiff({
    diff: [
      "diff --git a/src/lib/example.ts b/src/lib/example.ts",
      "--- a/src/lib/example.ts",
      "+++ b/src/lib/example.ts",
      "@@ -1,3 +1,6 @@",
      " export function add(a: number, b: number) {",
      "-  return a + b;",
      "+  // guard NaN",
      "+  if (Number.isNaN(a) || Number.isNaN(b)) return 0;",
      "+  return a + b;",
      " }",
    ].join("\n"),
    repo: "self-run",
    summary: "add NaN guard to add()",
  });
  if (!req.ok) {
    console.warn("request_gate failed:", req.message);
  } else {
    console.log(`✓ first_supply via request_gate gateId=${req.gateId}`);
  }

  recordActivationOnce("zukan_viewed", { source: "self-run" });
  console.log("✓ zukan_viewed");

  const report = buildFunnelReport();
  console.log("\n=== funnel ===");
  for (const s of report.steps) {
    console.log(
      `${s.step.padEnd(18)} count=${s.count} first=${s.firstAt ?? "-"}`,
    );
  }
  console.log(
    report.missing.length
      ? `欠測: ${report.missing.join(", ")}`
      : "欠測: なし",
  );
  console.log(
    `completed=${report.completed} minutes=${report.firstCompleteMinutes}`,
  );
  if (!report.completed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
