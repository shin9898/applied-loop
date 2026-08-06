import { AtlasConceptPromptCache } from "@/components/living-atlas/atlas-concept-prompt-cache";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { ensurePromptCacheModuleGates } from "@/lib/harness-canon";

export const dynamic = "force-dynamic";

export default async function PromptCacheConceptPage() {
  const [seeded, streakDays] = await Promise.all([
    ensurePromptCacheModuleGates().catch(() => ({
      created: 0,
      gateIds: [] as string[],
    })),
    loadStreakDays(),
  ]);

  return (
    <AtlasConceptPromptCache
      seededCreated={seeded.created}
      streakDays={streakDays}
    />
  );
}
