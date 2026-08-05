import { AtlasGoals } from "@/components/living-atlas/atlas-goals";
import {
  loadGoals,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const [goals, streakDays] = await Promise.all([
    loadGoals(),
    loadStreakDays(),
  ]);
  return (
    <AtlasGoals goals={goals} streakDays={streakDays} />
  );
}
