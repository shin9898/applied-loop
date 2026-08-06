import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasSetupPanel } from "@/components/living-atlas/atlas-onboarding";
import { AtlasReveal } from "@/components/living-atlas/atlas-reveal";
import { AtlasShell } from "@/components/living-atlas/atlas-shell";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { loadSetupDiagnosis } from "@/lib/setup-diagnosis";

export const dynamic = "force-dynamic";

/** `/setup` — セットアップ診断と道案内（ホームは1行バナーのみ） */
export default async function SetupPage() {
  const [diagnosis, streakDays] = await Promise.all([
    loadSetupDiagnosis(),
    loadStreakDays(),
  ]);
  return (
    <AtlasChrome active="/setup" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          <AtlasSetupPanel diagnosis={diagnosis} />
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
