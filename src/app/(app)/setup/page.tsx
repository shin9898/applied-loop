import { AtlasSetupPanel } from "@/components/living-atlas/atlas-onboarding";
import { AtlasReveal } from "@/components/living-atlas/atlas-reveal";
import { AtlasShell } from "@/components/living-atlas/atlas-shell";
import { loadSetupDiagnosis } from "@/lib/setup-diagnosis";
import { loadTutorialProgress } from "@/lib/tutorial-progress";
import { ensureTutorialSeed } from "@/lib/tutorial-seed";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ from?: string }>;
};

/** `/setup` — 進行つきチュートリアル＋診断 */
export default async function SetupPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  await ensureTutorialSeed();
  const { recordActivationOnce } = await import("@/lib/activation-funnel");
  recordActivationOnce("setup_opened");
  const diagnosis = await loadSetupDiagnosis({ gradingDryRun: true });
  // B5-3: 採点 CLI が戻っていれば保留しれんを自動再採点
  if (diagnosis.checks.some((c) => c.id === "grading_cli" && c.ok)) {
    const { requeueFailedGradingIfCliReady } = await import(
      "@/lib/requeue-failed-grading"
    );
    await requeueFailedGradingIfCliReady().catch((e) =>
      console.error("[setup] auto-regrade:", e),
    );
  }
  const progress = await loadTutorialProgress(diagnosis);
  if (diagnosis.gitHookInstalled) {
    recordActivationOnce("hook_installed");
  }
  if (diagnosis.tutorialSampleSubmitted) {
    recordActivationOnce("sample_submitted");
  }
  if (diagnosis.mcpRecent || progress.state.llmStepDone) {
    recordActivationOnce("mcp_touched");
  }
  return (
    <AtlasShell>
      <AtlasReveal as="section">
        <AtlasSetupPanel
          diagnosis={diagnosis}
          progress={progress}
          fromSampleGate={sp.from === "sample_gate"}
        />
      </AtlasReveal>
    </AtlasShell>
  );
}
