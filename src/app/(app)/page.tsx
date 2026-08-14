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
  if (setupDiagnosis.checks.some((c) => c.id === "grading_cli" && c.ok)) {
    const { requeueFailedGradingIfCliReady } = await import(
      "@/lib/requeue-failed-grading"
    );
    await requeueFailedGradingIfCliReady().catch((e) =>
      console.error("[home] auto-regrade:", e),
    );
  }
  return (
    <AtlasDashboard
      {...props}
      wsToken={getTerminalWsToken()}
      setupDiagnosis={setupDiagnosis}
    />
  );
}
