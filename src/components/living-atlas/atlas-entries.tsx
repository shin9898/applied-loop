import Link from "next/link";
import type { SystemKind } from "@/lib/atlas-taxonomy";
import { systemLabel } from "@/lib/atlas-taxonomy";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";

export type EntryItem = {
  id: string;
  title: string;
  source?: string;
  usedCount?: number;
  /** entry=登録済み学び / capture=受信箱の未仕分け */
  kind: "entry" | "capture";
  pending?: boolean;
  placeLabel?: string;
  system?: SystemKind;
  at?: Date;
  dayKey?: string;
  dayLabel?: string;
};

const DAY_ORDER = ["inbox", "きょう", "きのう", "今週"];

function groupByDay(items: EntryItem[]): { key: string; label: string; items: EntryItem[] }[] {
  const map = new Map<string, { label: string; items: EntryItem[] }>();
  for (const item of items) {
    const key = item.dayKey ?? "other";
    const label = item.dayLabel ?? key;
    const cur = map.get(key);
    if (cur) cur.items.push(item);
    else map.set(key, { label, items: [item] });
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, items: v.items }))
    .sort((a, b) => {
      const ai = DAY_ORDER.indexOf(a.label);
      const bi = DAY_ORDER.indexOf(b.label);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return b.key.localeCompare(a.key);
    });
}

/** /entries — にっき（日付主軸） */
export function AtlasEntries({
  items,
  streakDays,
}: {
  items: EntryItem[];
  streakDays?: number;
}) {
  const pending = items.filter((i) => i.pending).length;
  const groups = groupByDay(items);

  return (
    <AtlasChrome active="/entries" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="にっき"
            sub={pending ? `未仕分け ${pending} 件` : "仕分けはひと段落のようじゃ"}
          />
          <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
            日付で区切る。本文はひらく先で。仕分けの実行は MCP じゃ。
          </p>
          {groups.length === 0 ? (
            <p className="text-[14px] text-[#c9c3a0]">まだ記録がないぞ。</p>
          ) : (
            <div className="grid gap-4">
              {groups.map((g) => (
                <section key={g.key}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                    <h3 className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
                      {g.label}
                    </h3>
                    <span className="text-[11px] text-[#c9c3a0]">{g.items.length}</span>
                  </div>
                  <ul className="m-0 list-none border-t-2 border-[#002070] p-0">
                    {g.items.map((item, i) => (
                      <li
                        key={item.id}
                        className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2.5 ${
                          i ? "border-t-2 border-[#002070]" : ""
                        } ${item.pending ? "bg-[#001060]" : ""}`}
                      >
                        <span
                          className={`font-[family-name:var(--font-pixel)] text-[8px] ${
                            item.pending ? "text-[#f0d25a]" : "text-[#3ecf5a]"
                          }`}
                        >
                          {item.pending ? "新" : "記"}
                        </span>
                        <div>
                          <p className="m-0 text-[15px] leading-snug">{item.title}</p>
                          <p className="mt-0.5 text-[11px] text-[#c9c3a0]">
                            {[
                              item.source,
                              item.system && item.system !== "other"
                                ? systemLabel(item.system)
                                : null,
                              typeof item.usedCount === "number"
                                ? `使用 ${item.usedCount}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Link
                          href={
                            item.kind === "capture"
                              ? `/inbox/${item.id}`
                              : `/entries/${item.id}`
                          }
                          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
                        >
                          ひらく
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
