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

/* ——— ドットのスプライト ———
   すべて整数グリッドの <rect> で組み、shape-rendering=crispEdges で
   拡大しても輪郭がにじまないようにする（ADR-0018: ドット表現） */

export function PixelSlime({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 12"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="7" y="0" width="2" height="1" />
        <rect x="6" y="1" width="4" height="1" />
        <rect x="5" y="2" width="6" height="1" />
        <rect x="4" y="3" width="8" height="1" />
        <rect x="3" y="4" width="10" height="1" />
        <rect x="2" y="5" width="12" height="2" />
        <rect x="1" y="7" width="14" height="2" />
        <rect x="0" y="9" width="16" height="3" />
      </g>
      <g fill="#000c4a">
        <rect x="5" y="6" width="1" height="2" />
        <rect x="10" y="6" width="1" height="2" />
        <rect x="6" y="9" width="4" height="1" />
      </g>
    </svg>
  );
}

function PixelCross({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="0" y="0" width="2" height="2" />
        <rect x="2" y="2" width="2" height="2" />
        <rect x="4" y="4" width="2" height="2" />
        <rect x="6" y="6" width="2" height="2" />
        <rect x="6" y="0" width="2" height="2" />
        <rect x="4" y="2" width="2" height="2" />
        <rect x="2" y="4" width="2" height="2" />
        <rect x="0" y="6" width="2" height="2" />
      </g>
    </svg>
  );
}

function PixelSword({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="5" y="0" width="2" height="7" />
        <rect x="4" y="2" width="1" height="5" />
        <rect x="2" y="7" width="8" height="2" />
        <rect x="5" y="9" width="2" height="2" />
        <rect x="4" y="11" width="4" height="1" />
      </g>
    </svg>
  );
}

function PixelScroll({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="1" y="1" width="10" height="2" />
        <rect x="1" y="9" width="10" height="2" />
        <rect x="1" y="3" width="1" height="6" />
        <rect x="10" y="3" width="1" height="6" />
        <rect x="3" y="4" width="6" height="1" />
        <rect x="3" y="6" width="5" height="1" />
      </g>
    </svg>
  );
}

function PixelStar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="3" y="0" width="2" height="8" />
        <rect x="0" y="3" width="8" height="2" />
        <rect x="1" y="1" width="1" height="1" />
        <rect x="6" y="1" width="1" height="1" />
        <rect x="1" y="6" width="1" height="1" />
        <rect x="6" y="6" width="1" height="1" />
      </g>
    </svg>
  );
}

function PixelFlame({ frame, className }: { frame: "a" | "b"; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 8 10"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      {frame === "a" ? (
        <>
          <g fill="currentColor">
            <rect x="3" y="0" width="2" height="2" />
            <rect x="2" y="2" width="4" height="2" />
            <rect x="1" y="4" width="6" height="3" />
            <rect x="2" y="7" width="4" height="2" />
          </g>
          <rect x="3" y="4" width="2" height="3" fill="#f7f3d9" />
        </>
      ) : (
        <>
          <g fill="currentColor">
            <rect x="4" y="0" width="2" height="1" />
            <rect x="3" y="1" width="3" height="3" />
            <rect x="1" y="4" width="6" height="3" />
            <rect x="2" y="7" width="4" height="2" />
          </g>
          <rect x="3" y="5" width="2" height="2" fill="#f7f3d9" />
        </>
      )}
    </svg>
  );
}

/** 掲示板の見出し看板（一覧・詳細で共通） */
export function GrandQuestBanner() {
  return (
    <div className="atlas-gq-banner">
      <PixelSlime className="atlas-gq-ico atlas-gq-ico--slime" />
      <h2 className="atlas-gq-board__title">GRAND QUEST</h2>
      <PixelSlime className="atlas-gq-ico atlas-gq-ico--slime atlas-gq-ico--flip" />
    </div>
  );
}

/** 板の四隅の釘 */
export function GrandQuestNails() {
  return (
    <>
      <span className="atlas-gq-nail atlas-gq-nail--tl" aria-hidden />
      <span className="atlas-gq-nail atlas-gq-nail--tr" aria-hidden />
      <span className="atlas-gq-nail atlas-gq-nail--bl" aria-hidden />
      <span className="atlas-gq-nail atlas-gq-nail--br" aria-hidden />
    </>
  );
}

/** CLEAR の押印（回転させずドットの段差枠で出す） */
export function ClearStamp() {
  return (
    <span className="atlas-gq-stamp">
      <PixelStar className="atlas-gq-ico atlas-gq-ico--star" />
      CLEAR
    </span>
  );
}

/** 討伐スロット: 証跡 1 件 = スライム 1 体。既存の evidenceCount/target をそのまま使う */
export function HuntSlots({
  count,
  target,
  label = "討伐進捗（証跡）",
}: {
  count: number;
  target: number;
  label?: string;
}) {
  const total = Math.max(1, target);
  const pct = Math.min(100, Math.round((count / total) * 100));
  return (
    <div className="atlas-gq-hunt">
      <div className="atlas-gq-hunt__row">
        <span>{label}</span>
        <b>
          {count}/{total}
        </b>
      </div>
      <div
        className="atlas-gq-hunt__slots"
        style={{
          gridTemplateColumns: `repeat(${Math.min(total, 6)}, 1fr)`,
        }}
        role="img"
        aria-label={`証跡 ${count}/${total}（${pct}%）`}
      >
        {Array.from({ length: total }, (_, i) => i < count).map((on, i) => (
          <span
            key={i}
            className={`atlas-gq-hunt__slot ${on ? "is-on" : ""}`}
            aria-hidden
          >
            <PixelSlime className="atlas-gq-ico atlas-gq-ico--slime-sm" />
            {on ? (
              <PixelCross className="atlas-gq-ico atlas-gq-hunt__cross" />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/** クリア条件（KDI）のチェック欄 */
export function QuestConditions({
  conditions,
  cleared,
}: {
  conditions: string[];
  cleared: boolean;
}) {
  if (conditions.length === 0) {
    return (
      <p className="atlas-gq-cond__empty">
        クリア条件（KDI）は未設定。じゅもんで掲げよ。
      </p>
    );
  }
  return (
    <ul className="atlas-gq-cond">
      {conditions.map((c) => (
        <li key={c}>
          <span
            className={`atlas-gq-cond__box ${cleared ? "is-on" : ""}`}
            aria-hidden
          />
          <span>{c}</span>
        </li>
      ))}
    </ul>
  );
}

/** /goals — グランドクエスト一覧（けいじばんにピン留めした羊皮紙の札） */
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
          <div className="atlas-gq-stage">
            <div className="atlas-gq-board">
              <GrandQuestNails />
              <div className="atlas-gq-rail" aria-hidden />

              <div className="atlas-gq-board__inner">
                <header className="atlas-gq-board__head">
                  <GrandQuestBanner />
                  <p className="atlas-gq-board__blurb">
                    <b>掲示された使命をえらべ。</b>
                    クリア条件を見て、証跡をきざめ。
                    <br />
                    毎日の手はホームのデイリークエストへ。
                  </p>
                </header>

                {goals.length === 0 ? (
                  <p className="atlas-gq-board__empty">
                    まだグランドクエストがない。MCP の register_goals で掲げよ。
                  </p>
                ) : (
                  <ul className="atlas-gq-list">
                    {goals.map((g, i) => (
                      <li
                        key={g.id}
                        className={`atlas-gq-slip ${
                          ["", "atlas-gq-slip--b", "atlas-gq-slip--c"][i % 3]
                        } ${
                          g.evidenceCount >= (g.evidenceTarget ?? 3)
                            ? "atlas-gq-slip--clear"
                            : ""
                        }`}
                      >
                        <GrandQuestSlip goal={g} />
                      </li>
                    ))}
                  </ul>
                )}

                <div className="atlas-gq-cmd">
                  <span className="atlas-gq-cmd__label">コマンド</span>
                  <span className="atlas-gq-cmd__item">
                    もくひょうをかかげる（MCP register_goals）
                  </span>
                  <span className="atlas-gq-cmd__item">
                    証跡をきざむ（じゅもん）
                  </span>
                  <Link href="/entries" className="atlas-gq-cmd__item">
                    にっきへもどる
                  </Link>
                </div>
              </div>

              <div className="atlas-gq-rail" aria-hidden />
            </div>

            <div className="atlas-gq-posts" aria-hidden>
              <span />
              <span />
            </div>
            <div className="atlas-gq-ground" aria-hidden />

            <span className="atlas-gq-torch atlas-gq-torch--l" aria-hidden>
              <span className="atlas-gq-torch__fire">
                <PixelFlame frame="a" className="atlas-gq-ico atlas-gq-flame--a" />
                <PixelFlame frame="b" className="atlas-gq-ico atlas-gq-flame--b" />
              </span>
              <span className="atlas-gq-torch__stick" />
            </span>
            <span className="atlas-gq-torch atlas-gq-torch--r" aria-hidden>
              <span className="atlas-gq-torch__fire">
                <PixelFlame frame="a" className="atlas-gq-ico atlas-gq-flame--a" />
                <PixelFlame frame="b" className="atlas-gq-ico atlas-gq-flame--b" />
              </span>
              <span className="atlas-gq-torch__stick" />
            </span>
          </div>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}

/** 板にピン留めされた 1 枚の羊皮紙 */
function GrandQuestSlip({ goal: g }: { goal: GoalItem }) {
  const target = g.evidenceTarget ?? 3;
  const isThin = g.thin ?? g.evidenceCount < target;
  const cleared = g.evidenceCount >= target;
  const conditions = kdiConditions(g.kdi);

  return (
    <>
      <span className="atlas-gq-slip__pin" aria-hidden />
      {isThin && !cleared ? (
        <span className="atlas-gq-slip__state">証跡うすい</span>
      ) : null}
      <div className="atlas-gq-slip__hang">
        <article className="atlas-gq-slip__paper">
          <div className="atlas-gq-slip__meta">
            <span className="atlas-gq-slip__code">{g.code}</span>
            <span>{g.period ?? "—"}</span>
          </div>

          <h3 className="atlas-gq-slip__title">{g.title}</h3>
          <div className="atlas-gq-slip__hr" aria-hidden />

          <QuestConditions conditions={conditions} cleared={cleared} />

          <HuntSlots count={g.evidenceCount} target={target} />

          {g.focusDomains && g.focusDomains.length > 0 ? (
            <p className="atlas-gq-slip__next">
              戦場: {g.focusDomains.join(" · ")}
            </p>
          ) : null}

          {g.nextAction ? (
            <p className="atlas-gq-slip__next">{g.nextAction.reason}</p>
          ) : null}

          <div className="atlas-gq-slip__foot">
            {g.nextAction ? (
              <Link href={g.nextAction.href} className="atlas-gq-btn">
                <PixelSword className="atlas-gq-ico atlas-gq-ico--sword" />
                {g.nextAction.label}
              </Link>
            ) : null}
            <Link
              href={`/goals/${g.id}`}
              className="atlas-gq-btn atlas-gq-btn--ghost"
            >
              <PixelScroll className="atlas-gq-ico atlas-gq-ico--scroll" />
              くわしく
            </Link>
            {cleared ? <ClearStamp /> : null}
          </div>
        </article>
      </div>
    </>
  );
}
