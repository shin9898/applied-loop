import { placeFrom, type SystemKind } from "@/lib/atlas-taxonomy";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasGroupedList } from "./atlas-list-groups";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

export type RequirementItem = {
  id: string;
  title: string;
  kind: "understood" | "next";
  system?: SystemKind;
};

/** /requirements — 次のしれん候補／理解済み */
export function AtlasRequirements({
  items,
  streakDays,
  wsToken = null,
}: {
  items: RequirementItem[];
  streakDays?: number;
  wsToken?: string | null;
}) {
  const next = items.filter((i) => i.kind === "next");
  const understood = items.filter((i) => i.kind === "understood");
  return (
    <AtlasChrome active="/requirements" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="requirements"
              context={`つぎのしれん ${next.length} / 理解確認ずみ ${understood.length}\n候補: ${next
                .slice(0, 5)
                .map((i) => `${i.id} ${i.title}`)
                .join("\n")}`}
              title="じゅもんでメテオフォールを進める"
              blurb="要件と理解の結びを、じゅもんで進めよ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        <div className="grid gap-3 md:grid-cols-2">
          <AtlasReveal as="section" className="dq-win p-3.5">
            <AtlasPageTitle title="つぎのしれん" sub={`${next.length} 件`} />
            <p className="mb-3 text-[12px] text-[#c9c3a0]">見出しのみ。詳細は要件リンク先で。</p>
            <AtlasGroupedList
              items={next}
              getKey={(i) => i.id}
              getPlace={() => placeFrom(null, "要件")}
              getSystem={(i) => i.system ?? "other"}
              empty={
                <p className="text-[14px] text-[#c9c3a0]">いま進む要件はないようじゃ。</p>
              }
              renderItem={(item, i) => (
                <div
                  className={`py-2 text-[14px] leading-snug ${
                    i ? "border-t-2 border-[#002070]" : ""
                  }`}
                >
                  <span className="mr-2 font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a]">
                    ！
                  </span>
                  {item.title}
                </div>
              )}
            />
          </AtlasReveal>
          <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
            <AtlasPageTitle title="理解確認ずみ" sub={`${understood.length} 件`} />
            <AtlasGroupedList
              items={understood}
              getKey={(i) => i.id}
              getPlace={() => placeFrom(null, "要件")}
              getSystem={(i) => i.system ?? "other"}
              empty={
                <p className="text-[14px] text-[#c9c3a0]">まだ記録がないぞ。</p>
              }
              renderItem={(item, i) => (
                <div
                  className={`py-2 text-[14px] leading-snug ${
                    i ? "border-t-2 border-[#002070]" : ""
                  }`}
                >
                  <span className="mr-2 font-[family-name:var(--font-pixel)] text-[8px] text-[#3ecf5a]">
                    CLEAR
                  </span>
                  {item.title}
                </div>
              )}
            />
          </AtlasReveal>
        </div>
      </AtlasShell>
    </AtlasChrome>
  );
}
