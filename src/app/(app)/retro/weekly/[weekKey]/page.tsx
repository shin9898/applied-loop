import { notFound } from "next/navigation";
import { AtlasWeeklyTextbook } from "@/components/living-atlas/atlas-weekly-textbook";
import {
  loadAdjacentWeeklyTextbookKeys,
  loadWeeklyTextbook,
} from "@/lib/weekly-textbook";

export const dynamic = "force-dynamic";

export default async function RetroWeeklyPage({
  params,
}: {
  params: Promise<{ weekKey: string }>;
}) {
  const { weekKey } = await params;
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) notFound();

  const textbook = await loadWeeklyTextbook(weekKey);
  if (!textbook) notFound();

  const { prev, next } = await loadAdjacentWeeklyTextbookKeys(weekKey);

  return <AtlasWeeklyTextbook textbook={textbook} prevWeekKey={prev} nextWeekKey={next} />;
}
