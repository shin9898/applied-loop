import Link from "next/link";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";

export type AtlasEntryDetailProps = {
  entry: {
    id: string;
    title: string;
    kind: string;
    source: string | null;
    note: string | null;
    domain: string | null;
    createdAt: Date;
    applicationCount: number;
    applications: {
      id: string;
      appliedTo: string;
      note: string;
      createdAt: Date;
    }[];
    experiments: {
      id: string;
      action: string;
      status: string;
      startDate: Date;
      endDate: Date;
    }[];
  };
};

const EXPERIMENT_STATUS_LABEL: Record<string, string> = {
  active: "実験中",
  completed: "完了",
  abandoned: "中止",
};

/** /entries/[id] — 登録済み学び（読み取り。適用の記録は MCP） */
export function AtlasEntryDetail({ entry }: AtlasEntryDetailProps) {
  const date = entry.createdAt.toISOString().slice(0, 10);
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
        <AtlasPageTitle title="きろく" sub={`${date} · ${entry.kind}`} />
        <h2 className="m-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
          {entry.title}
        </h2>
        <p className="mt-2 text-[13px] text-[#c9c3a0]">
          {[entry.source, entry.domain, `適用 ${entry.applicationCount}回`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {entry.note ? (
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-[#f7f3d9]">
            {entry.note}
          </p>
        ) : (
          <p className="mt-4 text-[14px] text-[#c9c3a0]">本文ノートはないようじゃ。</p>
        )}
        <p className="mt-4 text-[13px] leading-relaxed text-[#c9c3a0]">
          適用の追記・実験の開始はアプリ内フォームではなく MCP（record_application 等）で行うのじゃ。
        </p>
      </AtlasReveal>

      <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
        <h2 className="dq-win-title">適用のあしあと</h2>
        {entry.applications.length === 0 ? (
          <p className="m-0 text-[14px] text-[#c9c3a0]">まだ適用記録はないようじゃ。</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {entry.applications.map((a, i) => (
              <li
                key={a.id}
                className={`py-3 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
              >
                <p className="m-0 text-[15px] text-[#f7f3d9]">{a.appliedTo}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#c9c3a0]">{a.note}</p>
                <p className="mt-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#c9c3a0]">
                  {a.createdAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AtlasReveal>

      {entry.experiments.length > 0 ? (
        <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
          <h2 className="dq-win-title">ためしていること</h2>
          <ul className="m-0 list-none p-0">
            {entry.experiments.map((exp, i) => (
              <li
                key={exp.id}
                className={`py-3 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
              >
                <Link
                  href={`/experiments/${exp.id}`}
                  className="text-[15px] text-[#f7f3d9] no-underline hover:underline"
                >
                  {exp.action}
                </Link>
                <p className="mt-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
                  {EXPERIMENT_STATUS_LABEL[exp.status] ?? exp.status}
                  {" · "}
                  {exp.startDate.toISOString().slice(0, 10)} 〜{" "}
                  {exp.endDate.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </AtlasReveal>
      ) : null}
    </AtlasShell>
  );
}
