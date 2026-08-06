import Link from "next/link";
import {
  isUnknownPlace,
  placeFrom,
  type SystemKind,
} from "@/lib/atlas-taxonomy";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasGroupedList } from "./atlas-list-groups";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

export type GateListItem = {
  id: string;
  /** 一覧用の短い見出し */
  title: string;
  question: string;
  status: "pending" | "grading" | "passed" | "failed";
  repo?: string | null;
  domain?: string | null;
  placeLabel?: string;
  system?: SystemKind;
};

/** /gates — しれん一覧（要約＋ばしょ×系統。未特定は霧帯） */
export function AtlasGatesList({
  items,
  streakDays,
  wsToken = null,
}: {
  items: GateListItem[];
  streakDays?: number;
  wsToken?: string | null;
}) {
  const pending = items.filter((i) => i.status === "pending" || i.status === "failed").length;
  const unknown = items.filter((i) => {
    const p = placeFrom(i.repo, i.domain);
    return isUnknownPlace(p);
  }).length;
  const firstPending = items.find(
    (i) => i.status === "pending" || i.status === "failed",
  );

  return (
    <AtlasChrome active="/gates" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="gates"
              context={`挑めるしれん ${pending} 件。霧 ${unknown} 件。\n${
                firstPending
                  ? `先頭候補: ${firstPending.id} ${firstPending.title}`
                  : "未クリアなし"
              }`}
              title="じゅもんでしれんを片付ける"
              blurb="並んだしれんを、じゅもんでまとめて切り開け。ひと問に沈むなら『たたかう』じゃ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle title="しれん" sub={`いま挑めるもの ${pending} 件`} />
          <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
            一覧は見出しだけ。全文はたたかう画面か上のじゅもんで。
            {unknown > 0
              ? ` 未特定（霧）が ${unknown} 件あるぞ。`
              : ""}
          </p>
          <AtlasGroupedList
            items={items}
            getKey={(i) => i.id}
            getPlace={(i) => placeFrom(i.repo, i.domain)}
            getSystem={(i) => i.system ?? "other"}
            unknownHint="repo や domain が空だと霧に入る。MCP enrich_gate_places で一括特定できるぞ。"
            empty={
              <p className="text-[14px] text-[#c9c3a0]">しれんはすべてCLEARのようじゃ。</p>
            }
            renderItem={(item, i) => {
              const mark =
                item.status === "pending" || item.status === "failed"
                  ? "！"
                  : item.status === "grading"
                    ? "…"
                    : "CLEAR";
              const canFight = item.status === "pending" || item.status === "failed";
              const fog = isUnknownPlace(placeFrom(item.repo, item.domain));
              return (
                <div
                  className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2.5 ${
                    i ? "border-t-2 border-[#002070]" : ""
                  }`}
                >
                  <span
                    className={`font-[family-name:var(--font-pixel)] text-[8px] ${
                      fog
                        ? "text-[#9ec0ff]"
                        : canFight
                          ? "animate-[dq-bob_0.9s_steps(2)_infinite] text-[#f0d25a]"
                          : "text-[#3ecf5a]"
                    }`}
                  >
                    {fog && canFight ? "霧" : mark}
                  </span>
                  <div>
                    <p className="m-0 text-[15px] leading-snug">{item.title}</p>
                  </div>
                  {canFight ? (
                    <Link href={`/gates/${item.id}`} className="dq-btn !px-3 !py-2 text-[8px]">
                      たたかう
                    </Link>
                  ) : (
                    <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0]">
                      {item.status}
                    </span>
                  )}
                </div>
              );
            }}
          />
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
