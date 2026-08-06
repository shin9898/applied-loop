import Link from "next/link";
import { createCheckIn, completeExperiment } from "@/lib/actions";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";

export type AtlasExperimentDetailProps = {
  experiment: {
    id: string;
    action: string;
    successMetric: string;
    status: string;
    endDateKey: string;
    remainingDays: number;
    outcome: string | null;
    entryId: string;
    entryTitle: string;
    checkedToday: boolean;
    checkIns: { id: string; dateKey: string; note: string | null }[];
  };
  streakDays?: number;
};

/**
 * /experiments/[id] — DQ シェル。
 * チェックイン／完了はまだ Server Action（MCP 未整備）。バトルのこたえると同種の例外。
 */
export function AtlasExperimentDetail({
  experiment,
  streakDays,
}: AtlasExperimentDetailProps) {
  const field =
    "w-full border-[3px] border-[#f7f3d9] bg-[#001a8c] px-3 py-2.5 text-[13px] text-[#f7f3d9] placeholder:text-[#9a9470] focus:outline-none focus:border-[#f0d25a]";

  return (
    <AtlasChrome active="/entries" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <div className="mb-3">
            <Link
              href={`/entries/${experiment.entryId}`}
              className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
            >
              ← {experiment.entryTitle}
            </Link>
          </div>
          <AtlasPageTitle
            title="じっけん"
            sub={`${experiment.status} · 残り ${experiment.remainingDays} 日 · ${experiment.endDateKey} まで`}
          />
          <h2 className="m-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
            {experiment.action}
          </h2>
          <p className="mt-2 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            成功指標: {experiment.successMetric}
          </p>
          <p className="mt-2 mb-0 border-l-[3px] border-[#9ec0ff] pl-2 text-[11px] leading-relaxed text-[#9ec0ff]">
            つまり チェックインと完了はいま画面から送る。将来は MCP に寄せる予定じゃ。
          </p>
        </AtlasReveal>

        {experiment.status === "active" && (
          <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
            <h2 className="dq-win-title">きょうのチェックイン</h2>
            {experiment.checkedToday ? (
              <p className="m-0 text-[14px] text-[#3ecf5a]">
                今日はチェックイン済みじゃ。
              </p>
            ) : (
              <form action={createCheckIn} className="space-y-3">
                <input type="hidden" name="experimentId" value={experiment.id} />
                <input
                  name="note"
                  placeholder="一言メモ（任意）"
                  className={field}
                />
                <button type="submit" className="dq-btn !px-3 !py-2 text-[8px]">
                  チェックイン
                </button>
              </form>
            )}
          </AtlasReveal>
        )}

        {experiment.status === "active" && (
          <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
            <h2 className="dq-win-title">じっけんをおえる</h2>
            <form action={completeExperiment} className="space-y-3">
              <input type="hidden" name="experimentId" value={experiment.id} />
              <textarea
                name="outcome"
                rows={3}
                placeholder="結果: 成功指標に対してどうだったか・学び"
                className={field}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="status"
                  value="completed"
                  className="dq-btn !px-3 !py-2 text-[8px]"
                >
                  かんりょう
                </button>
                <button
                  type="submit"
                  name="status"
                  value="abandoned"
                  className="dq-btn !px-3 !py-2 text-[8px] !bg-[#6a1018] !text-[#f7f3d9]"
                >
                  ちゅうし
                </button>
              </div>
            </form>
          </AtlasReveal>
        )}

        {experiment.outcome ? (
          <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
            <h2 className="dq-win-title">けっか</h2>
            <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-[#f7f3d9]">
              {experiment.outcome}
            </p>
          </AtlasReveal>
        ) : null}

        <AtlasReveal as="section" delayIndex={3} className="dq-win p-3.5">
          <h2 className="dq-win-title">
            チェックインれきし（{experiment.checkIns.length} 日）
          </h2>
          {experiment.checkIns.length === 0 ? (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              まだチェックインはないようじゃ。
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {experiment.checkIns.map((c, i) => (
                <li
                  key={c.id}
                  className={`flex gap-3 py-2.5 text-[13px] ${
                    i ? "border-t-2 border-[#002070]" : "pt-0"
                  }`}
                >
                  <span className="shrink-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
                    {c.dateKey}
                  </span>
                  <span className="text-[#f7f3d9]">{c.note ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
