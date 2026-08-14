import Link from "next/link";
import {
  isUnknownPlace,
  placeFrom,
  type SystemKind,
} from "@/lib/atlas-taxonomy";
import { GATE_BACKLOG_CAP } from "@/lib/gate-limits";
import type { GatesSupplyState } from "@/lib/gates-supply";
import { AtlasShell } from "./atlas-shell";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasGroupedList } from "./atlas-list-groups";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasGateDeferActions } from "./atlas-gate-defer";

export type GateListItem = {
  id: string;
  /** 一覧用の短い見出し */
  title: string;
  question: string;
  /** pending=未提出 / grading=採点中 / grading_failed=保留 / passed=CLEAR / failed=miss / parked=あとまわし */
  status:
    | "pending"
    | "grading"
    | "grading_failed"
    | "passed"
    | "failed"
    | "parked";
  repo?: string | null;
  domain?: string | null;
  placeLabel?: string;
  system?: SystemKind;
  /** initial / retry / sr_review / module。sr_review = 再出題（ダンジョンの「ぬし」） */
  kind?: string | null;
  /** ISO。ダンジョンの階層順（古い順）と「n日前」表示に使う */
  createdAt?: string | null;
  gradedAt?: string | null;
};

function statusLabel(status: GateListItem["status"]): string {
  switch (status) {
    case "pending":
      return "未提出";
    case "grading":
      return "採点中";
    case "grading_failed":
      return "保留";
    case "passed":
      return "CLEAR";
    case "failed":
      return "miss";
    case "parked":
      return "あとまわし";
  }
}

/** /gates — しれん一覧（要約＋ばしょ×系統。未特定は霧帯） */
export function AtlasGatesList({
  items,
  parkedItems = [],
  pendingBacklogCount = 0,
  wsToken = null,
  supply = null,
}: {
  items: GateListItem[];
  parkedItems?: GateListItem[];
  /** status=pending の生件数（backlog cap と同じ定義） */
  pendingBacklogCount?: number;
  wsToken?: string | null;
  supply?: GatesSupplyState | null;
}) {
  const pending = items.filter(
    (i) =>
      i.status === "pending" ||
      i.status === "failed" ||
      i.status === "grading_failed",
  ).length;
  const unknown = items.filter((i) => {
    const p = placeFrom(i.repo, i.domain);
    return isUnknownPlace(p);
  }).length;
  const firstPending = items.find(
    (i) =>
      i.status === "pending" ||
      i.status === "failed" ||
      i.status === "grading_failed",
  );
  const overCap = pendingBacklogCount >= GATE_BACKLOG_CAP;

  const emptyNode =
    supply && supply.kind !== "has_items" ? (
      <div className="grid gap-2">
        <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
          {supply.title}
        </p>
        <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
          {supply.body}
        </p>
        {supply.href && supply.cta ? (
          <Link href={supply.href} className="dq-btn w-fit">
            {supply.cta}
          </Link>
        ) : null}
      </div>
    ) : (
      <p className="text-[14px] text-[#c9c3a0]">しれんはすべてCLEARのようじゃ。</p>
    );

  return (
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
        <AtlasPageTitle title="しれん（ぜんぶ一覧）" sub={`いま挑めるもの ${pending} 件`} />
        <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
          <Link href="/gates" className="text-[#9ec0ff]">
            ← ダンジョンのちずへもどる
          </Link>
          <br />
          一覧は見出しだけ。全文はたたかう画面か上のじゅもんで。状態は未提出／採点中／CLEAR・miss／保留。
          {unknown > 0
            ? ` 未特定（霧）が ${unknown} 件あるぞ。`
            : ""}
          {" "}
          溜まりすぎたら『あとまわし』か『閉じる』で pending を減らせ（材料はきょうのしょに残る）。
        </p>
        {overCap ? (
          <div className="mb-3 border-[3px] border-[#f0a030] bg-[#2a1800] p-3">
            <p className="m-0 text-[13px] leading-relaxed text-[#f7f3d9]">
              pending が {pendingBacklogCount} 件（上限 {GATE_BACKLOG_CAP}
              ）。即時しれん生成は止まっておるが、材料は消えておらぬ。
              あとまわし／閉じるで {GATE_BACKLOG_CAP} 未満にすると再び生成できる。夜は{" "}
              <Link href="/retro" className="text-[#9ec0ff]">
                きょうのしょ
              </Link>
              へ。
            </p>
          </div>
        ) : null}
        <AtlasGroupedList
          items={items}
          getKey={(i) => i.id}
          getPlace={(i) => placeFrom(i.repo, i.domain)}
          getSystem={(i) => i.system ?? "other"}
          unknownHint="repo や domain が空だと霧に入る。MCP enrich_gate_places で一括特定できるぞ。"
          empty={emptyNode}
          renderItem={(item, i) => {
            const mark =
              item.status === "pending" || item.status === "failed"
                ? "！"
                : item.status === "grading"
                  ? "…"
                  : item.status === "grading_failed"
                    ? "?"
                    : "CLEAR";
            const canFight =
              item.status === "pending" ||
              item.status === "failed" ||
              item.status === "grading_failed";
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
                  <Link
                    href={`/gates/${item.id}`}
                    className="m-0 block text-[15px] leading-snug text-inherit no-underline hover:text-[#f0d25a]"
                  >
                    {item.title}
                  </Link>
                  <p className="m-0 mt-0.5 text-[11px] text-[#c9c3a0]">
                    {statusLabel(item.status)}
                    {item.status === "grading_failed"
                      ? " · たたかうで再採点"
                      : item.status === "passed"
                        ? " · 結果・再出題予告を見られる"
                        : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {canFight ? (
                    <Link
                      href={`/gates/${item.id}`}
                      className="dq-btn !px-3 !py-2 text-[8px]"
                    >
                      {item.status === "grading_failed" ? "復帰" : "たたかう"}
                    </Link>
                  ) : (
                    <Link
                      href={`/gates/${item.id}`}
                      className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                    >
                      {item.status === "grading"
                        ? "確認"
                        : item.status === "passed"
                          ? "みる"
                          : statusLabel(item.status)}
                    </Link>
                  )}
                  {item.status === "pending" ? (
                    <AtlasGateDeferActions gateId={item.id} mode="active" />
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      </AtlasReveal>

      {parkedItems.length > 0 ? (
        <AtlasReveal as="section" className="dq-win p-3.5">
          <h2 className="dq-win-title mb-2">あとまわし（{parkedItems.length}）</h2>
          <p className="mb-3 text-[12px] text-[#c9c3a0]">
            pending から外してある。もどすと再び挑めるしれんになる。
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {parkedItems.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-[1fr_auto] items-start gap-3 border-t-2 border-[#002070] pt-2 first:border-t-0 first:pt-0"
              >
                <div>
                  <Link
                    href={`/gates/${item.id}`}
                    className="text-[14px] text-inherit no-underline hover:text-[#f0d25a]"
                  >
                    {item.title}
                  </Link>
                  <p className="m-0 mt-0.5 text-[11px] text-[#9a9470]">あとまわし</p>
                </div>
                <AtlasGateDeferActions gateId={item.id} mode="parked" />
              </li>
            ))}
          </ul>
        </AtlasReveal>
      ) : null}
    </AtlasShell>
  );
}
