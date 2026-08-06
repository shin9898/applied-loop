import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

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

/** /goals/[id] — 証跡の見方と「残し方」（アクションは MCP） */
export function AtlasGoalDetail({
  goal,
  evidenceCount,
  evidenceTarget,
  timeline,
  streakDays,
  wsToken = null,
}: AtlasGoalDetailProps) {
  const thin = evidenceCount < evidenceTarget;
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
        <AtlasReveal as="section" className="dq-win p-3.5">
          <div className="mb-3">
            <Link
              href="/goals"
              className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
            >
              ← もくひょうにもどる
            </Link>
          </div>
          <AtlasPageTitle
            title="もくひょう"
            sub={`${goal.period ?? "—"} · ${goal.status}`}
          />
          <h2 className="m-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
            {goal.title}
          </h2>
          {goal.kdi ? (
            <p className="mt-2 mb-0 text-[14px] leading-relaxed text-[#c9c3a0]">
              KDI: {goal.kdi}
            </p>
          ) : null}
          {goal.focusDomains && goal.focusDomains.length > 0 ? (
            <p className="mt-1 mb-0 text-[11px] text-[#9ec0ff]">
              focus: {goal.focusDomains.join(" · ")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] text-[#c9c3a0]">
              今週の証跡 {evidenceCount}/{evidenceTarget}
            </span>
            <span
              className={`font-[family-name:var(--font-pixel)] text-[9px] ${
                thin ? "text-[#f0d25a]" : "text-[#3ecf5a]"
              }`}
            >
              {thin ? "うすい" : "足りておる"}
            </span>
          </div>
          <div className="mt-2 h-2.5 border-2 border-[#223] bg-black">
            <i
              className={`block h-full ${thin ? "bg-[#f0d25a]" : "bg-[#3ecf5a]"}`}
              style={{
                width: `${Math.min(100, Math.round((evidenceCount / evidenceTarget) * 100))}%`,
              }}
            />
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
            聞け。証跡は紙の帳面ではなく、じゅもんの道で残すのじゃ。上でとなえるか、外の賢者に頼むか——扉は同じ。
          </p>
          <p className="mt-0 mb-3 border-l-[3px] border-[#9ec0ff] pl-2 text-[12px] leading-relaxed text-[#f7f3d9]">
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
              つまり{" "}
            </span>
            アプリに登録フォームはない。MCP ツールで書き込み、にっき／タイムラインは結果の表示。
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
          <h2 className="dq-win-title">最近の証跡</h2>
          {timeline.length === 0 ? (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              まだこのもくひょうに紐づく足跡はない。上の教えから始めよ。
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
