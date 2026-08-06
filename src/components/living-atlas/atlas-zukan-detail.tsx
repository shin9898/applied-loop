import Link from "next/link";
import { placeFrom, systemLabel, type SystemKind } from "@/lib/atlas-taxonomy";
import {
  parseRootCause,
  rootCauseLabel,
  rootCauseOneLiner,
} from "@/lib/grade-payload";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";

export type AtlasZukanDetailProps = {
  item: {
    id: string;
    concept: string;
    status: "clear" | "open" | "fog";
    rootCause: string | null;
    system: SystemKind;
    repo: string | null;
    domain: string | null;
    gateId: string | null;
    gateQuestion: string | null;
    createdAt: Date;
  };
  streakDays?: number;
};

/** /zukan/[id] — つまずき（誤解）詳細 */
export function AtlasZukanDetail({ item, streakDays }: AtlasZukanDetailProps) {
  const place = placeFrom(item.repo, item.domain);
  const statusLabel =
    item.status === "clear" ? "CLEAR" : item.status === "fog" ? "ふたたびもや" : "未クリア";
  const cause = parseRootCause(item.rootCause);
  const causeLabel = rootCauseLabel(cause);
  const causeLine = rootCauseOneLiner(cause);

  return (
    <AtlasChrome active="/zukan" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <div className="mb-3">
            <Link
              href="/zukan"
              className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
            >
              ← ずかんにもどる
            </Link>
          </div>
          <AtlasPageTitle title="ずかん詳細" sub={statusLabel} />
          <p className="m-0 text-[12px] text-[#9ec0ff]">
            {[place.label, systemLabel(item.system), causeLabel]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h2 className="mt-3 mb-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
            {item.concept}
          </h2>
          {causeLine ? (
            <p className="mt-2 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
              {causeLine}
            </p>
          ) : null}
          {item.gateQuestion ? (
            <div className="mt-3 border-l-[3px] border-[#9ec0ff] pl-2.5">
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
                ◆ 関連しれん
              </p>
              <p className="mt-1 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                {item.gateQuestion}
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {item.gateId && item.status !== "clear" ? (
              <Link href={`/gates/${item.gateId}`} className="dq-btn !px-3 !py-2 text-[8px]">
                たたかう
              </Link>
            ) : null}
            <Link href="/zukan" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
              一覧へ
            </Link>
          </div>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
