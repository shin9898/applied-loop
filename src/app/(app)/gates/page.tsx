import { AtlasGatesList } from "@/components/living-atlas/atlas-gates-list";
import {
  loadGateList,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";

export const dynamic = "force-dynamic";

export default async function GatesPage() {
  const [items, streakDays] = await Promise.all([
    loadGateList(),
    loadStreakDays(),
  ]);
  return (
    <AtlasGatesList items={items} streakDays={streakDays} />
  );
}
