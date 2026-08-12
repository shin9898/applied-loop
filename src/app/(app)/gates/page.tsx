import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AtlasGatesList } from "@/components/living-atlas/atlas-gates-list";
import { AtlasDungeonSelect } from "@/components/living-atlas/atlas-dungeon-select";
import { AtlasDungeonRun } from "@/components/living-atlas/atlas-dungeon-run";
import {
  buildDungeons,
  findDungeon,
  isSystemKind,
} from "@/components/living-atlas/atlas-dungeons";
import {
  loadGateList,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { isUnknownPlace, placeFrom } from "@/lib/atlas-taxonomy";
import { recentGenFailures } from "@/lib/gate";
import { resolveGatesSupplyState } from "@/lib/gates-supply";
import { getTerminalWsToken } from "@/lib/terminal-token";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * しれん。既定は「ダンジョンのちず」（系統ごとの入口）。
 *   ?d=<系統>   … その迷宮の中（縦の道のりで連続撃破）
 *   ?view=list  … 旧来のフラット一覧（ばしょ×系統。あとまわし／閉じるの一括処理向け）
 */
export default async function GatesPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const sp = (await Promise.resolve(searchParams)) ?? {};
  const rawView = sp.view;
  const rawDungeon = sp.d;
  const view = typeof rawView === "string" ? rawView : undefined;
  const dungeonKey = typeof rawDungeon === "string" ? rawDungeon : undefined;

  const hookBody = join(homedir(), ".applied-loop", "hooks", "post-commit");
  // G4: しれん一覧でも再出題スケジューラを回す
  const { scheduleDueGates } = await import("@/lib/gate");
  await scheduleDueGates().catch((e) =>
    console.error("[gates] scheduleDueGates failed:", e),
  );
  const [gateList, streakDays, genFailures, everHadGate] = await Promise.all([
    loadGateList(),
    loadStreakDays(),
    recentGenFailures(),
    prisma.gate.count().then((n) => n > 0),
  ]);
  const supply = resolveGatesSupplyState({
    itemCount: gateList.items.length,
    everHadGate,
    gitHookInstalled: existsSync(hookBody),
    genFailures,
  });
  const wsToken = getTerminalWsToken();

  if (view === "list") {
    return (
      <AtlasGatesList
        items={gateList.items}
        parkedItems={gateList.parkedItems}
        pendingBacklogCount={gateList.pendingBacklogCount}
        streakDays={streakDays}
        wsToken={wsToken}
        supply={supply}
      />
    );
  }

  const dungeons = buildDungeons(gateList.items);

  if (dungeonKey && isSystemKind(dungeonKey)) {
    const dungeon = findDungeon(dungeons, dungeonKey);
    if (dungeon) {
      return (
        <AtlasDungeonRun
          dungeon={dungeon}
          streakDays={streakDays}
          wsToken={wsToken}
        />
      );
    }
  }

  const fogCount = gateList.items.filter((i) =>
    isUnknownPlace(placeFrom(i.repo, i.domain)),
  ).length;

  return (
    <AtlasDungeonSelect
      dungeons={dungeons}
      fogCount={fogCount}
      pendingBacklogCount={gateList.pendingBacklogCount}
      parkedItems={gateList.parkedItems}
      streakDays={streakDays}
      wsToken={wsToken}
      supply={supply}
    />
  );
}
