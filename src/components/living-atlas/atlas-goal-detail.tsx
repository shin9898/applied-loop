import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import {
  ClearStamp,
  GrandQuestBanner,
  GrandQuestNails,
  HuntSlots,
  QuestAssay,
  QuestConditions,
} from "./atlas-goals";
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
          {/* 一覧と同じ「板にピン留めした羊皮紙」で統一。詳細は札が 1 枚だけ */}
          <div className="atlas-gq-stage">
            <div className="atlas-gq-board atlas-gq-board--detail">
              <GrandQuestNails />
              <div className="atlas-gq-rail" aria-hidden />

              <div className="atlas-gq-board__inner">
                <header className="atlas-gq-board__head">
                  <GrandQuestBanner />
                </header>

                <ul className="atlas-gq-list atlas-gq-list--single">
                  <li
                    className={`atlas-gq-slip atlas-gq-slip--b ${
                      cleared ? "atlas-gq-slip--clear" : ""
                    }`}
                  >
                    <span className="atlas-gq-slip__pin" aria-hidden />
                    {thin ? (
                      <span className="atlas-gq-slip__state">証跡うすい</span>
                    ) : null}
                    <div className="atlas-gq-slip__hang">
                      <article className="atlas-gq-slip__paper">
                        <div className="atlas-gq-slip__meta">
                          <span className="atlas-gq-slip__code">
                            {goal.period ?? "—"}
                          </span>
                          <span>{goal.status}</span>
                        </div>

                        <h3 className="atlas-gq-slip__title">{goal.title}</h3>
                        <div className="atlas-gq-slip__hr" aria-hidden />

                        <QuestAssay
                          target={evidenceTarget}
                          conditionCount={conditions.length}
                        />

                        <QuestConditions
                          conditions={conditions}
                          cleared={cleared}
                        />

                        <HuntSlots
                          count={evidenceCount}
                          target={evidenceTarget}
                          label={`討伐進捗（今週の証跡・${thin ? "うすい" : "足りておる"}）`}
                        />

                        {goal.focusDomains && goal.focusDomains.length > 0 ? (
                          <p className="atlas-gq-slip__next">
                            戦場: {goal.focusDomains.join(" · ")}
                          </p>
                        ) : null}

                        <div className="atlas-gq-slip__foot">
                          <Link href="/goals" className="atlas-gq-btn atlas-gq-btn--ghost">
                            けいじばんへ
                          </Link>
                          {cleared ? <ClearStamp /> : null}
                        </div>
                      </article>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="atlas-gq-rail" aria-hidden />
            </div>
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
