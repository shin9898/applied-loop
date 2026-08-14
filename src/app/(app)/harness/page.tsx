import { AtlasHarness } from "@/components/living-atlas/atlas-harness";
import {
  loadHarnessRepos,
  loadMaterialCaptureHealth,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function HarnessPage() {
  const [repos, captureHealth] = await Promise.all([
    loadHarnessRepos(),
    loadMaterialCaptureHealth(),
  ]);
  return (
    <AtlasHarness
      repos={repos}
      captureHealth={captureHealth}
      wsToken={getTerminalWsToken()}
    />
  );
}
