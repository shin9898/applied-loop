import { AtlasHarness } from "@/components/living-atlas/atlas-harness";
import {
  loadHarnessRepos,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { weeklyTokenBreakdowns } from "@/lib/harness-stats";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function HarnessPage() {
  const [repos, streakDays, weeklyTokens] = await Promise.all([
    loadHarnessRepos(),
    loadStreakDays(),
    weeklyTokenBreakdowns(new Date(), 8).catch(() => []),
  ]);
  return (
    <AtlasHarness
      repos={repos}
      streakDays={streakDays}
      weeklyTokens={weeklyTokens}
      wsToken={getTerminalWsToken()}
    />
  );
}
