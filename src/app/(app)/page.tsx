import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasDashboard } from "@/components/living-atlas/atlas-dashboard";
import { loadHomeProps } from "@/components/living-atlas/load-atlas-data";

export const dynamic = "force-dynamic";

/** `/` — ぼうけんのしょ WORLD MAP */
export default async function AtlasHomePage() {
  const props = await loadHomeProps();
  return (
    <AtlasChrome active="/" streakDays={props.streakDays}>
      <AtlasDashboard {...props} />
    </AtlasChrome>
  );
}
