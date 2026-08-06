import { AtlasRequirements } from "@/components/living-atlas/atlas-requirements";
import {
  loadRequirements,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function RequirementsPage() {
  const [items, streakDays] = await Promise.all([
    loadRequirements(),
    loadStreakDays(),
  ]);
  return (
    <AtlasRequirements
      items={items}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
    />
  );
}
