import Link from "next/link";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";

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
  };
  streakDays?: number;
};

/** /inbox/[id] — 受信箱の学び候補（読み取り。仕分けは MCP triage_inbox） */
export function AtlasInboxDetail({ capture, streakDays }: AtlasInboxDetailProps) {
  const date = capture.capturedAt.toISOString().slice(0, 10);
  return (
    <AtlasChrome active="/entries" streakDays={streakDays}>
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
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
          <h2 className="dq-win-title">どうする</h2>
          <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
            受け入れる／見送るはアプリ内ボタンではなく、MCP の{" "}
            <span className="text-[#f0d25a]">triage_inbox</span>（accept / skip）で行うのじゃ。
            確定すると うけばこの「くら」へ移る。
          </p>
          <p className="mt-3 mb-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#c9c3a0]">
            id: {capture.id}
          </p>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
