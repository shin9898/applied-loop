import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasDashboard } from "@/components/living-atlas/atlas-dashboard";
import { loadHomeProps } from "@/components/living-atlas/load-atlas-data";
import { loadSetupDiagnosis } from "@/lib/setup-diagnosis";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

/** `/` — ぼうけんのしょ WORLD MAP */
export default async function AtlasHomePage() {
  const [props, setupDiagnosis] = await Promise.all([
    loadHomeProps(),
    loadSetupDiagnosis(),
  ]);
  return (
    <AtlasChrome active="/" streakDays={props.streakDays}>
      <AtlasDashboard
        {...props}
        wsToken={getTerminalWsToken()}
        setupDiagnosis={setupDiagnosis}
      />
    </AtlasChrome>
  );
}
