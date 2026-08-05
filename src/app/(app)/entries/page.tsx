import { AtlasEntries } from "@/components/living-atlas/atlas-entries";
import {
  loadEntries,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";

export const dynamic = "force-dynamic";

export default async function EntriesPage() {
  const [items, streakDays] = await Promise.all([
    loadEntries(),
    loadStreakDays(),
  ]);
  return (
    <AtlasEntries items={items} streakDays={streakDays} />
  );
}
