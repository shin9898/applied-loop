import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasGateBattleClient } from "@/components/living-atlas/atlas-gate-battle-client";
import { loadGateById, loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function GateBattlePage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);
  const [gate, streakDays] = await Promise.all([
    loadGateById(id),
    loadStreakDays(),
  ]);
  if (!gate) notFound();
  return (
    <AtlasChrome active="/gates/[id]" streakDays={streakDays}>
      <AtlasGateBattleClient gate={gate} />
    </AtlasChrome>
  );
}
