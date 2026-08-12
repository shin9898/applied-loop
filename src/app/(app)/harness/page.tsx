import { AtlasHarness } from "@/components/living-atlas/atlas-harness";
import {
  loadHarnessRepos,
  loadMaterialCaptureHealth,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function HarnessPage() {
  const [repos, streakDays, captureHealth] = await Promise.all([
    loadHarnessRepos(),
    loadStreakDays(),
    loadMaterialCaptureHealth(),
  ]);
  return (
    <AtlasHarness
      repos={repos}
      streakDays={streakDays}
      captureHealth={captureHealth}
      wsToken={getTerminalWsToken()}
    />
  );
}
