import { AtlasZukan } from "@/components/living-atlas/atlas-zukan";
import {
  loadZukanItems,
} from "@/components/living-atlas/load-atlas-data";
import { computeQuadrantFlows } from "@/lib/quadrant";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function ZukanPage() {
  const { recordActivationOnce } = await import("@/lib/activation-funnel");
  recordActivationOnce("zukan_viewed");
  const [items, quadrant] = await Promise.all([
    loadZukanItems(),
    computeQuadrantFlows().catch(() => null),
  ]);
  return (
    <AtlasZukan
      items={items}
      quadrant={quadrant}
      wsToken={getTerminalWsToken()}
    />
  );
}
