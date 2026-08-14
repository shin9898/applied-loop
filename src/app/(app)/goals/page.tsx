import { AtlasGoals } from "@/components/living-atlas/atlas-goals";
import {
  loadGoals,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const goals = await loadGoals();
  return (
    <AtlasGoals
      goals={goals}
      wsToken={getTerminalWsToken()}
    />
  );
}
