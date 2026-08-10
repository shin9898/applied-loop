import type { SystemKind } from "@/lib/atlas-taxonomy";
import type { QuadrantFlows } from "@/lib/quadrant";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasZukanDex } from "./atlas-zukan-dex";
import { AtlasZukanQuadrant } from "./atlas-zukan-quadrant";

export type ZukanItem = {
  id: string;
  title: string;
  /** 表示用ばしょラベル */
  placeLabel?: string;
  repo?: string | null;
  domain?: string | null;
  system?: SystemKind;
  gateId?: string | null;
  status: "clear" | "open" | "fog";
  summary?: string;
};

/** /zukan — ずかん（本に収めた学びカード） */
export function AtlasZukan({
  items,
  streakDays,
  wsToken = null,
  quadrant = null,
}: {
  items: ZukanItem[];
  streakDays?: number;
  wsToken?: string | null;
  /** 当面残置。ずかん本UI定着後に要否を判断 */
  quadrant?: QuadrantFlows | null;
}) {
  const open = items.filter((i) => i.status !== "clear").length;
  const fog = items.filter((i) => i.status === "fog").length;
  return (
    <AtlasChrome active="/zukan" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="general"
              context={`ずかん 未CLEAR ${open} / 全 ${items.length} / 霧 ${fog}。find_related_learnings や enrich_gate_places が使える。`}
              title="じゅもんでずかんを掘る"
              blurb="霧を晴らし、似たつまずきを掘るなら、じゅもんを。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        {quadrant ? (
          <AtlasReveal as="section">
            <AtlasZukanQuadrant flows={quadrant} />
          </AtlasReveal>
        ) : null}
        <section>
          <AtlasZukanDex items={items} openCount={open} />
        </section>
      </AtlasShell>
    </AtlasChrome>
  );
}
