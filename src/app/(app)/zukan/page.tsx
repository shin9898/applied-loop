import { AtlasZukan } from "@/components/living-atlas/atlas-zukan";
import {
  loadStreakDays,
  loadZukanItems,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

export default async function ZukanPage() {
  const [items, streakDays] = await Promise.all([
    loadZukanItems(),
    loadStreakDays(),
  ]);
  return (
    <AtlasZukan
      items={items}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
    />
  );
}
