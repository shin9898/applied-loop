import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasSetupPanel } from "@/components/living-atlas/atlas-onboarding";
import { AtlasReveal } from "@/components/living-atlas/atlas-reveal";
import { AtlasShell } from "@/components/living-atlas/atlas-shell";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
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
  const [diagnosis, streakDays] = await Promise.all([
    loadSetupDiagnosis(),
    loadStreakDays(),
  ]);
  const progress = await loadTutorialProgress(diagnosis);
  return (
    <AtlasChrome active="/setup" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          <AtlasSetupPanel
            diagnosis={diagnosis}
            progress={progress}
            fromSampleGate={sp.from === "sample_gate"}
          />
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
