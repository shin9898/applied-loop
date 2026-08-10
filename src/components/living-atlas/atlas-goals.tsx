import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { kdiConditions } from "@/lib/kdi-conditions";

export type GoalNextAction = {
  label: string;
  href: string;
  reason: string;
};

export type GoalItem = {
  id: string;
  code: string;
  title: string;
  period?: string | null;
  kdi?: string | null;
  focusDomains?: string[];
  evidenceCount: number;
  evidenceTarget?: number;
  thin?: boolean;
  nextAction?: GoalNextAction;
};

export { kdiConditions };

const LINE_SLOTS = 6;

function CrossedSwords({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 48"
      width="48"
      height="36"
      aria-hidden
    >
      <g
        fill="none"
        stroke="#3a2a18"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 40 L40 8" />
        <path d="M36 6 L44 14" />
        <path d="M8 36 L16 44" />
        <path d="M52 40 L24 8" />
        <path d="M28 6 L20 14" />
        <path d="M56 36 L48 44" />
      </g>
      <g fill="#c9a227" stroke="#3a2a18" strokeWidth="1.4">
        <rect x="6" y="34" width="10" height="4" rx="1" transform="rotate(-45 11 36)" />
        <rect x="48" y="34" width="10" height="4" rx="1" transform="rotate(45 53 36)" />
      </g>
      <circle cx="32" cy="24" r="3.2" fill="#8a6a2a" stroke="#3a2a18" strokeWidth="1.2" />
    </svg>
  );
}

/** /goals — グランドクエスト一覧（羊皮紙クエスト掲示） */
export function AtlasGoals({
  goals,
  streakDays,
  wsToken = null,
}: {
  goals: GoalItem[];
  streakDays?: number;
  wsToken?: string | null;
}) {
  const thin = goals.filter(
    (g) => g.thin || (g.evidenceTarget != null && g.evidenceCount < g.evidenceTarget),
  );
  return (
    <AtlasChrome active="/goals" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="goal-evidence"
              context={
                thin.length
                  ? `証跡うすい: ${thin
                      .slice(0, 5)
                      .map((g) => `${g.id} ${g.title} (${g.evidenceCount}/${g.evidenceTarget ?? 3})`)
                      .join("\n")}`
                  : `グランドクエスト ${goals.length} 件。証跡はおおむね充足。`
              }
              title="じゅもんで証跡を残す"
              blurb="グランドクエストの証跡は、じゅもんの道で残せ。一覧は見取りじゃ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        <AtlasReveal as="section">
          <AtlasPageTitle
            title="もくひょう"
            sub={
              thin.length
                ? `進行中のグランドクエスト · 証跡うすい ${thin.length} 件`
                : "進行中のグランドクエスト"
            }
          />
          <div className="atlas-gq-board">
            <header className="atlas-gq-board__head">
              <h2 className="atlas-gq-board__title">Grand Quest</h2>
              <p className="atlas-gq-board__rule" aria-hidden />
              <p className="atlas-gq-board__blurb">
                掲示された使命を選べ。クリア条件を見て、証跡を刻め。
                日々の手はホームのデイリークエストへ。
              </p>
            </header>

            {goals.length === 0 ? (
              <p className="atlas-gq-board__empty">
                まだグランドクエストがない。MCP の register_goals で掲げよ。
              </p>
            ) : (
              <ul className="atlas-gq-list">
                {goals.map((g) => (
                  <li key={g.id}>
                    <GrandQuestCard goal={g} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}

function GrandQuestCard({ goal: g }: { goal: GoalItem }) {
  const target = g.evidenceTarget ?? 3;
  const pct = Math.min(100, Math.round((g.evidenceCount / target) * 100));
  const isThin = g.thin ?? g.evidenceCount < target;
  const conditions = kdiConditions(g.kdi);
  const cleared = g.evidenceCount >= target;
  const lines = [...conditions];
  while (lines.length < LINE_SLOTS) lines.push("");

  return (
    <article
      className={`atlas-gq-card ${isThin ? "atlas-gq-card--thin" : ""} ${
        cleared ? "atlas-gq-card--clear" : ""
      }`}
    >
      <div className="atlas-gq-card__paper">
        <header className="atlas-gq-card__head">
          <CrossedSwords className="atlas-gq-card__swords" />
          <div className="atlas-gq-card__head-text">
            <p className="atlas-gq-card__kind">Grand Quest</p>
            <p className="atlas-gq-card__code">
              {g.code}
              {g.period ? ` · ${g.period}` : ""}
            </p>
          </div>
          <div
            className={`atlas-gq-card__clear ${cleared ? "is-on" : ""}`}
            aria-label={cleared ? "CLEAR" : "未CLEAR"}
          >
            <span>CLEAR</span>
            <i>{cleared ? "済" : ""}</i>
          </div>
        </header>

        <h3 className="atlas-gq-card__title">{g.title}</h3>

        <section className="atlas-gq-card__conditions" aria-label="クリア条件">
          <ul className="atlas-gq-card__cond-list">
            {lines.map((c, i) => (
              <li key={`${g.id}-line-${i}`} className={c ? "" : "is-blank"}>
                <span className="atlas-gq-card__check" aria-hidden>
                  {c ? (cleared ? "☑" : "☐") : "□"}
                </span>
                <span className="atlas-gq-card__line">
                  {c || "\u00a0"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="atlas-gq-card__progress" aria-label="討伐進捗">
          <div className="atlas-gq-card__progress-row">
            <span>討伐進捗（証跡）</span>
            <span>
              {g.evidenceCount}/{target}
            </span>
          </div>
          <div className="atlas-gq-card__bar">
            <i
              className={isThin ? "is-thin" : "is-ok"}
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>

        {g.focusDomains && g.focusDomains.length > 0 ? (
          <p className="atlas-gq-card__focus">
            戦場: {g.focusDomains.join(" · ")}
          </p>
        ) : null}

        <footer className="atlas-gq-card__foot">
          {g.nextAction ? (
            <div className="atlas-gq-card__next">
              <p>{g.nextAction.reason}</p>
              <div className="atlas-gq-card__actions">
                <Link href={g.nextAction.href} className="atlas-gq-card__btn">
                  {g.nextAction.label}
                </Link>
                <Link href={`/goals/${g.id}`} className="atlas-gq-card__detail">
                  クエスト詳細
                </Link>
              </div>
            </div>
          ) : (
            <Link href={`/goals/${g.id}`} className="atlas-gq-card__btn">
              クエスト詳細
            </Link>
          )}
        </footer>
      </div>
    </article>
  );
}
