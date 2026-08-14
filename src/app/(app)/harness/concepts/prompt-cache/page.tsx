import { AtlasConceptPromptCache } from "@/components/living-atlas/atlas-concept-prompt-cache";
import { ensurePromptCacheModuleGates } from "@/lib/harness-canon";

export const dynamic = "force-dynamic";

export default async function PromptCacheConceptPage() {
  const seeded = await ensurePromptCacheModuleGates().catch(() => ({
    created: 0,
    gateIds: [] as string[],
  }));

  return (
    <AtlasConceptPromptCache
      seededCreated={seeded.created}
    />
  );
}
