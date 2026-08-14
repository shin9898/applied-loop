import { AtlasRequirements } from "@/components/living-atlas/atlas-requirements";
import {
  loadRequirements,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function RequirementsPage() {
  const items = await loadRequirements();
  return (
    <AtlasRequirements
      items={items}
      wsToken={getTerminalWsToken()}
    />
  );
}
