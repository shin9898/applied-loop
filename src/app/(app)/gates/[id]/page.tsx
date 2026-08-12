import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasGateBattleClient } from "@/components/living-atlas/atlas-gate-battle-client";
import { AtlasAssist, AtlasAssistUnavailable } from "@/components/living-atlas/atlas-assist";
import { AtlasReveal } from "@/components/living-atlas/atlas-reveal";
import { AtlasShell } from "@/components/living-atlas/atlas-shell";
import {
  battleHref,
  buildDungeons,
  dungeonHref,
  findDungeon,
  isSystemKind,
  nextFloorAfter,
} from "@/components/living-atlas/atlas-dungeons";
import {
  loadGateById,
  loadGateListLight,
  loadStreakDays,
} from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * バトル画面。`?d=<系統>` 付きで来たときだけ、ダンジョンの連続撃破導線
 * （つぎのまものへ）を足す。バトルの中身そのものは変えない。
 */
export default async function GateBattlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const { id } = await Promise.resolve(params);
  const sp = (await Promise.resolve(searchParams)) ?? {};
  const rawDungeon = sp.d;
  const dungeonKey = typeof rawDungeon === "string" ? rawDungeon : undefined;
  const [gate, streakDays] = await Promise.all([
    loadGateById(id),
    loadStreakDays(),
  ]);
  if (!gate) notFound();
  const wsToken = getTerminalWsToken();

  let nextGate: { href: string; label: string } | null = null;
  if (dungeonKey && isSystemKind(dungeonKey)) {
    const { items } = await loadGateListLight();
    const dungeon = findDungeon(buildDungeons(items), dungeonKey);
    if (dungeon) {
      const next = nextFloorAfter(dungeon, id);
      nextGate = next
        ? {
            href: battleHref(next.gate.id, dungeonKey),
            label: `つぎのまものへ（${next.floorLabel}）`,
          }
        : {
            href: dungeonHref(dungeonKey),
            label: `${dungeon.name}へもどる`,
          };
    }
  }

  return (
    <AtlasChrome active="/gates/[id]" streakDays={streakDays}>
      <AtlasShell>
        <AtlasGateBattleClient gate={gate} nextGate={nextGate} />
        <AtlasReveal as="section" delayIndex={1}>
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              gateId={gate.id}
              intent="gates"
              context={[
                `gateId: ${gate.id}`,
                gate.contextSummary ? `context: ${gate.contextSummary}` : "",
                `question: ${gate.question}`,
              ]
                .filter(Boolean)
                .join("\n")}
              title="じゅもんでこのしれんに答える"
              blurb="このしれんのためのじゅもんじゃ。ホームの全体じゅもんとは別の扉。"
              plain="このゲート専用で Claude/Codex が開く。対話のあと answer_gate。バトルの『こたえる』からも提出可。合否は get_gate_result。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
