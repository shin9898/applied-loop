import Link from "next/link";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasInboxTriage } from "./atlas-inbox-triage";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";
import type { InboxOverlapCandidate } from "./ukebako-view";

export type AtlasInboxDetailProps = {
  capture: {
    id: string;
    title: string;
    note: string | null;
    status: string;
    sourceTool: string;
    sourceContext: string | null;
    capturedAt: Date;
    importanceScore: number | null;
    triageReason: string | null;
    overlapCandidates: InboxOverlapCandidate[];
  };
  wsToken: string | null;
};

const OVERLAP_RELATION_LABEL: Record<string, string> = {
  duplicate: "おなじ ごかい",
  refinement: "せいちみつか",
  unrelated: "むかんけい",
};

/** /inbox/[id] — 受信箱の学び候補（読み取り＋単独完結じゅもんでの仕分け） */
export function AtlasInboxDetail({ capture, wsToken }: AtlasInboxDetailProps) {
  const date = capture.capturedAt.toISOString().slice(0, 10);
  return (
    <AtlasShell>
      <AtlasReveal as="section" className="dq-win p-3.5">
        <div className="mb-3">
          <Link
            href="/entries"
            className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
          >
            ← うけばこにもどる
          </Link>
        </div>
        <AtlasPageTitle title="受信箱" sub={`${date} · ${capture.status}`} />
        <div className="mb-2 inline-block border-[3px] border-[#f0d25a] bg-[#003018] px-2 py-1 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          新 · 未仕分け
        </div>
        <h2 className="m-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
          {capture.title}
        </h2>
        <p className="mt-2 text-[13px] text-[#c9c3a0]">
          {[
            capture.sourceTool,
            typeof capture.importanceScore === "number"
              ? `重要度 ${capture.importanceScore}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {capture.note ? (
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-[#f7f3d9]">
            {capture.note}
          </p>
        ) : null}
        {capture.triageReason ? (
          <p className="mt-3 text-[13px] leading-relaxed text-[#c9c3a0]">
            仕分けヒント: {capture.triageReason}
          </p>
        ) : null}
        {capture.sourceContext ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[#c9c3a0]">
            文脈: {capture.sourceContext}
          </p>
        ) : null}
        {capture.overlapCandidates.length > 0 ? (
          <div className="mt-4 border-4 border-white bg-[#001a8c] px-3 py-3 shadow-[4px_4px_0_#000]">
            <p className="m-0 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
              にた ごかいが みつかった
            </p>
            <ul className="m-0 mt-2 list-none p-0">
              {capture.overlapCandidates.map((c) => (
                <li key={c.id} className="mt-2 first:mt-0">
                  <p className="m-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#f7f3d9]">
                    「{c.concept}」
                    <span className="ml-1 text-[11px] text-[#9ec0ff]">
                      ({OVERLAP_RELATION_LABEL[c.relation] ?? c.relation})
                    </span>
                  </p>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                    わけ: {c.reason}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              じゅもんで「既存に紐付ける」か「新規作成する」かを選べ。ここは読み取り専用。
            </p>
          </div>
        ) : null}
      </AtlasReveal>

      <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
        <h2 className="dq-win-title">どうする</h2>
        <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
          受け入れる／見送るを えらび、じゅもんで確定させよ。確定すると うけばこの「くら」へ移る。
        </p>
        <div className="mt-3">
          <AtlasInboxTriage
            wsToken={wsToken}
            captureId={capture.id}
            captureTitle={capture.title}
            overlapCandidates={capture.overlapCandidates}
          />
        </div>
        <p className="mt-3 mb-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#c9c3a0]">
          id: {capture.id}
        </p>
      </AtlasReveal>
    </AtlasShell>
  );
}
