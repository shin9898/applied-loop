import Link from "next/link";
import {
  isUnknownPlace,
  placeFrom,
  type SystemKind,
} from "@/lib/atlas-taxonomy";
import type { QuadrantFlows } from "@/lib/quadrant";
import { QuadrantMap } from "@/components/quadrant-map";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasGroupedList } from "./atlas-list-groups";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasZukanSampleSprite } from "./atlas-zukan-sample";

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

/** /zukan — ずかん（つまずき一覧） */
export function AtlasZukan({
  items,
  streakDays,
  wsToken = null,
  quadrant = null,
}: {
  items: ZukanItem[];
  streakDays?: number;
  wsToken?: string | null;
  /** P3: 4象限（ホーム CTA は増やさない） */
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
          <AtlasReveal as="section" className="dq-win p-3.5">
            <AtlasPageTitle
              title="ちしきの4つのくに"
              sub={`${quadrant.weekKey} の流れ`}
            />
            <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
              未知の未知〜知の知。今週どこが動いたかを見る地図じゃ（ちずの CTA
              は触らない）。
            </p>
            <QuadrantMap flows={quadrant} />
          </AtlasReveal>
        ) : null}
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="ずかん"
            sub={`未CLEAR ${open} ／ 全 ${items.length}`}
          />
          <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
            ばしょ × 系統で棚分け。未特定は霧帯へ。くわしい中身はたたかう／詳細／じゅもんへ。
          </p>
          <AtlasGroupedList
            items={items}
            getKey={(i) => i.id}
            getPlace={(i) => placeFrom(i.repo, i.domain)}
            getSystem={(i) => i.system ?? "other"}
            unknownHint="つまずきに紐づくしれんのばしょ（repo / domain）が空だと霧に入るぞ。"
            empty={
              <div className="grid gap-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 border-[3px] border-white bg-[#001a8c] p-1 shadow-[4px_4px_0_#000]">
                    <AtlasZukanSampleSprite scale={3} />
                  </div>
                  <div className="grid gap-2">
                    <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
                      ずかんはまだ空じゃ
                    </p>
                    <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                      まだつまずきなし。miss すると、左のような像がここに増える。
                      しれんにこたえて CLEAR や miss になると貯まるぞ。まずは1問提出せよ。
                    </p>
                  </div>
                </div>
                <Link href="/gates" className="dq-btn w-fit">
                  しれんへ
                </Link>
              </div>
            }
            renderItem={(item, i) => {
              const detailHref = `/zukan/${item.id}`;
              const fightHref =
                item.status !== "clear" && item.gateId
                  ? `/gates/${item.gateId}`
                  : detailHref;
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
                        : item.status === "clear"
                          ? "text-[#3ecf5a]"
                          : item.status === "open"
                            ? "text-[#f0d25a]"
                            : "text-[#c9c3a0]"
                    }`}
                  >
                    {fog && item.status !== "clear"
                      ? "霧"
                      : item.status === "clear"
                        ? "CLEAR"
                        : item.status === "open"
                          ? "！"
                          : "霧"}
                  </span>
                  <div>
                    <Link
                      href={detailHref}
                      className="m-0 text-[15px] leading-snug text-[#f7f3d9] no-underline hover:underline"
                    >
                      {item.title}
                    </Link>
                    {item.summary ? (
                      <p className="mt-0.5 text-[11px] text-[#c9c3a0]">{item.summary}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Link
                      href={detailHref}
                      className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline"
                    >
                      みる
                    </Link>
                    {item.status !== "clear" && item.gateId ? (
                      <Link
                        href={fightHref}
                        className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
                      >
                        たたかう
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            }}
          />
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
