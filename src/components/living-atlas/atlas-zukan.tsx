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
}: {
  items: ZukanItem[];
  streakDays?: number;
}) {
  const open = items.filter((i) => i.status !== "clear").length;
  return (
    <AtlasChrome active="/zukan" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="ずかん"
            sub={`未CLEAR ${open} ／ 全 ${items.length}`}
          />
          <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
            ばしょ × 系統で棚分け。未特定は霧帯へ。くわしい中身はたたかう／詳細へ。
          </p>
          <AtlasGroupedList
            items={items}
            getKey={(i) => i.id}
            getPlace={(i) => placeFrom(i.repo, i.domain)}
            getSystem={(i) => i.system ?? "other"}
            unknownHint="つまずきに紐づくゲートの repo / domain が空だと霧に入るぞ。"
            empty={
              <p className="text-[14px] text-[#c9c3a0]">まだ記録がないようじゃ。</p>
            }
            renderItem={(item, i) => {
              const fightHref =
                item.status !== "clear" && item.gateId
                  ? `/gates/${item.gateId}`
                  : "/zukan";
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
                    <p className="m-0 text-[15px] leading-snug">{item.title}</p>
                    {item.summary ? (
                      <p className="mt-0.5 text-[11px] text-[#c9c3a0]">{item.summary}</p>
                    ) : null}
                  </div>
                  <Link
                    href={fightHref}
                    className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
                  >
                    {item.status === "clear" ? "みる" : "たたかう"}
                  </Link>
                </div>
              );
            }}
          />
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
