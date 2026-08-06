import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AtlasGatesList } from "@/components/living-atlas/atlas-gates-list";
import {
  loadGateList,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { recentGenFailures } from "@/lib/gate";
import { resolveGatesSupplyState } from "@/lib/gates-supply";
import { getTerminalWsToken } from "@/lib/terminal-token";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GatesPage() {
  const hookBody = join(homedir(), ".applied-loop", "hooks", "post-commit");
  const [items, streakDays, genFailures, everHadGate] = await Promise.all([
    loadGateList(),
    loadStreakDays(),
    recentGenFailures(),
    prisma.gate.count().then((n) => n > 0),
  ]);
  const supply = resolveGatesSupplyState({
    itemCount: items.length,
    everHadGate,
    gitHookInstalled: existsSync(hookBody),
    genFailures,
  });
  return (
    <AtlasGatesList
      items={items}
      streakDays={streakDays}
      wsToken={getTerminalWsToken()}
      supply={supply}
    />
  );
}
