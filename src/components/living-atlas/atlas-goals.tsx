import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";

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

/** /goals — もくひょう（KDI＋ネクストで Core へ） */
export function AtlasGoals({
  goals,
  streakDays,
}: {
  goals: GoalItem[];
  streakDays?: number;
}) {
  const thin = goals.filter(
    (g) => g.thin || (g.evidenceTarget != null && g.evidenceCount < g.evidenceTarget),
  );
  return (
    <AtlasChrome active="/goals" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="もくひょう"
            sub={
              thin.length
                ? `証跡がうすいものが ${thin.length} 件`
                : "証跡はそろっておるようじゃ"
            }
          />
          <p className="mb-3 text-[12px] leading-relaxed text-[#c9c3a0]">
            H2 の KDI を見て、ネクストからしれん／にっき／ずかんへ進め。
          </p>
          <ul className="m-0 list-none p-0">
            {goals.map((g, i) => {
              const target = g.evidenceTarget ?? 3;
              const pct = Math.min(100, Math.round((g.evidenceCount / target) * 100));
              const isThin = g.thin ?? g.evidenceCount < target;
              return (
                <li
                  key={g.id}
                  className={`py-3 ${i ? "border-t-2 border-[#002070]" : "pt-0"} ${
                    isThin ? "outline outline-2 outline-[#f0d25a] outline-offset-2" : ""
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                      {g.code}
                      {g.period ? ` · ${g.period}` : ""}
                    </span>
                    <span className="text-[12px] text-[#c9c3a0]">
                      証跡 {g.evidenceCount}/{target}
                    </span>
                  </div>
                  <p className="m-0 text-[15px] leading-snug">{g.title}</p>
                  {g.kdi ? (
                    <p className="mt-1.5 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                      KDI: {g.kdi}
                    </p>
                  ) : null}
                  {g.focusDomains && g.focusDomains.length > 0 ? (
                    <p className="mt-1 mb-0 text-[11px] text-[#9ec0ff]">
                      focus: {g.focusDomains.join(" · ")}
                    </p>
                  ) : null}
                  <div className="mt-2 h-2.5 border-2 border-[#223] bg-black">
                    <i
                      className={`block h-full ${isThin ? "bg-[#f0d25a]" : "bg-[#3ecf5a]"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {g.nextAction ? (
                    <div className="mt-2.5 grid gap-1.5 border-l-[3px] border-[#f0d25a] pl-2.5">
                      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                        {g.nextAction.reason}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Link href={g.nextAction.href} className="dq-btn !px-3 !py-2 text-[8px]">
                          {g.nextAction.label}
                        </Link>
                        <Link
                          href={`/goals/${g.id}`}
                          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0] no-underline"
                        >
                          詳細
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
