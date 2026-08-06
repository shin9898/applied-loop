import { AtlasHarness } from "@/components/living-atlas/atlas-harness";
import {
  loadHarnessRepos,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function HarnessPage() {
  const [repos, streakDays] = await Promise.all([
    loadHarnessRepos(),
    loadStreakDays(),
  ]);
  return (
    <AtlasHarness
      repos={repos}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
    />
  );
}
