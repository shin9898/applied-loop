import { AtlasZukan } from "@/components/living-atlas/atlas-zukan";
import {
  loadStreakDays,
  loadZukanItems,
} from "@/components/living-atlas/load-atlas-data";
import { computeQuadrantFlows } from "@/lib/quadrant";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function ZukanPage() {
  const [items, streakDays, quadrant] = await Promise.all([
    loadZukanItems(),
    loadStreakDays(),
    computeQuadrantFlows().catch(() => null),
  ]);
  return (
    <AtlasZukan
      items={items}
      streakDays={streakDays}
      quadrant={quadrant}
      wsToken={getTerminalWsToken()}
    />
  );
}
