import { AtlasChrome } from "@/components/living-atlas/atlas-chrome";
import { AtlasGateBattleClient } from "@/components/living-atlas/atlas-gate-battle-client";
import { AtlasAssist, AtlasAssistUnavailable } from "@/components/living-atlas/atlas-assist";
import { AtlasReveal } from "@/components/living-atlas/atlas-reveal";
import { AtlasShell } from "@/components/living-atlas/atlas-shell";
import { loadGateById, loadStreakDays } from "@/components/living-atlas/load-atlas-data";
import { getTerminalWsToken } from "@/lib/terminal-token";
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
  const wsToken = getTerminalWsToken();
  return (
    <AtlasChrome active="/gates/[id]" streakDays={streakDays}>
      <AtlasShell>
        <AtlasGateBattleClient gate={gate} />
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
