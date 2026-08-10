import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { kdiConditions } from "@/lib/kdi-conditions";

export type GoalEvidenceItem = {
  id: string;
  kind: string;
  title: string;
  href?: string | null;
  at: string;
};

export type AtlasGoalDetailProps = {
  goal: {
    id: string;
    title: string;
    period?: string | null;
    kdi?: string | null;
    status: string;
    focusDomains?: string[];
  };
  evidenceCount: number;
  evidenceTarget: number;
  timeline: GoalEvidenceItem[];
  streakDays?: number;
  wsToken?: string | null;
};

/** /goals/[id] — グランドクエスト詳細 */
export function AtlasGoalDetail({
  goal,
  evidenceCount,
  evidenceTarget,
  timeline,
  streakDays,
  wsToken = null,
}: AtlasGoalDetailProps) {
  const thin = evidenceCount < evidenceTarget;
  const cleared = evidenceCount >= evidenceTarget;
  const conditions = kdiConditions(goal.kdi);
  const assistContext = [
    `goalId: ${goal.id}`,
    `title: ${goal.title}`,
    goal.kdi ? `KDI: ${goal.kdi}` : "",
    `今週証跡: ${evidenceCount}/${evidenceTarget}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <AtlasChrome active="/goals" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          <div className="mb-3">
            <Link
              href="/goals"
              className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
            >
              ← グランドクエスト一覧
            </Link>
          </div>
          <AtlasPageTitle title="もくひょう" sub="大きな使命の詳細" />
          <div className="atlas-gq-board atlas-gq-board--detail">
            <header className="atlas-gq-board__head">
              <h2 className="atlas-gq-board__title">Grand Quest</h2>
              <p className="atlas-gq-board__rule" aria-hidden />
              <p className="atlas-gq-detail__meta">
                {goal.period ?? "—"} · {goal.status}
              </p>
            </header>
            <h3 className="atlas-gq-detail__title">{goal.title}</h3>

            <section className="atlas-gq-card__conditions" aria-label="クリア条件">
              {conditions.length > 0 ? (
                <ul className="atlas-gq-card__cond-list">
                  {conditions.map((c) => (
                    <li key={c}>
                      <span className="atlas-gq-card__check" aria-hidden>
                        {cleared ? "☑" : "☐"}
                      </span>
                      <span className="atlas-gq-card__line">{c}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="atlas-gq-card__cond-empty">
                  クリア条件（KDI）未設定。じゅもんで掲げよ。
                </p>
              )}
            </section>

            {goal.focusDomains && goal.focusDomains.length > 0 ? (
              <p className="atlas-gq-card__focus">
                戦場: {goal.focusDomains.join(" · ")}
              </p>
            ) : null}

            <section className="atlas-gq-card__progress" aria-label="討伐進捗">
              <div className="atlas-gq-card__progress-row">
                <span>討伐進捗（今週の証跡）</span>
                <span>
                  {evidenceCount}/{evidenceTarget} · {thin ? "うすい" : "足りておる"}
                </span>
              </div>
              <div className="atlas-gq-card__bar">
                <i
                  className={thin ? "is-thin" : "is-ok"}
                  style={{
                    width: `${Math.min(100, Math.round((evidenceCount / evidenceTarget) * 100))}%`,
                  }}
                />
              </div>
            </section>
          </div>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={1}>
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="goal-evidence"
              context={assistContext}
              title="じゅもんで証跡を残す"
              blurb="『じゅもんをとなえる』で学びを拾い、使った足跡を残せ。にっきは結果を眺める棚じゃ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
          <h2 className="dq-win-title">証跡の残し方</h2>
          <p className="mt-0 mb-2 text-[13px] leading-relaxed text-[#c9c3a0]">
            クリア条件を満たす足跡は、じゅもんの道で残すのじゃ。
          </p>
          <p className="mt-0 mb-3 border-l-[3px] border-[#9ec0ff] pl-2 text-[12px] leading-relaxed text-[#f7f3d9]">
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
              つまり{" "}
            </span>
            アプリに登録フォームはない。MCP ツールで書き込み、タイムラインは結果の表示。
          </p>
          <ol className="m-0 list-none space-y-3 p-0">
            <li className="border-l-[3px] border-[#f0d25a] pl-2.5">
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                1. 学びの種を拾え
              </p>
              <p className="mt-1 mb-0 text-[13px] leading-relaxed text-[#f7f3d9]">
                <code className="text-[#9ec0ff]">capture_learning_candidate</code>{" "}
                → 受信箱。仕分けは{" "}
                <code className="text-[#9ec0ff]">triage_inbox</code>。
              </p>
            </li>
            <li className="border-l-[3px] border-[#f0d25a] pl-2.5">
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                2. 使ったら足跡を刻め
              </p>
              <p className="mt-1 mb-0 text-[13px] leading-relaxed text-[#f7f3d9]">
                <code className="text-[#9ec0ff]">record_application</code>
                （appliedTo に repo／案件）。紐付け提案は{" "}
                <code className="text-[#9ec0ff]">approve_goal_link</code>。
              </p>
            </li>
            <li className="border-l-[3px] border-[#f0d25a] pl-2.5">
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                3. 理解の証もまた足跡
              </p>
              <p className="mt-1 mb-0 text-[13px] leading-relaxed text-[#f7f3d9]">
                しれん CLEAR や誤解解消も証跡に入る。焦点ドメインなら先にたたかえ。
              </p>
            </li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/entries" className="dq-btn !px-3 !py-2 text-[8px]">
              にっき（棚）を見る
            </Link>
            <Link href="/gates" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
              しれんへ
            </Link>
          </div>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={3} className="dq-win p-3.5">
          <h2 className="dq-win-title">討伐記録（最近の証跡）</h2>
          {timeline.length === 0 ? (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              まだこのクエストに紐づく足跡はない。上の教えから始めよ。
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {timeline.map((t, i) => (
                <li
                  key={t.id}
                  className={`py-2.5 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
                >
                  <p className="m-0 text-[11px] text-[#c9c3a0]">
                    {t.at} · {t.kind}
                  </p>
                  {t.href ? (
                    <Link
                      href={t.href}
                      className="mt-0.5 block text-[14px] text-[#f7f3d9] no-underline hover:underline"
                    >
                      {t.title}
                    </Link>
                  ) : (
                    <p className="mt-0.5 mb-0 text-[14px] text-[#f7f3d9]">{t.title}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
