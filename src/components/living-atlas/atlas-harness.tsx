import Link from "next/link";
import type { WeeklyTokenBreakdown } from "@/lib/harness-stats";
import { TokenStackChart } from "@/components/harness-charts";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

export type HarnessRepo = {
  id: string;
  name: string;
  health: "ok" | "warn" | "bad";
  note: string;
  /** 監視本線 or 計測だけで見えた */
  tier: "watched" | "discovered";
  /** LLM セッション計測があるか（cache 週次レート等） */
  measured: boolean;
  /** 今日の DevEvent (commit) 件数。監視本線向け */
  commitCountToday?: number;
  /** 何を持ってその判定か */
  criteria?: string;
  /** より良くするための一手 */
  uplift?: string;
  prescriptionHref?: string;
  nextAction?: { label: string; href: string };
};

function RepoRow({
  repo,
  showTopBorder,
}: {
  repo: HarnessRepo;
  showTopBorder: boolean;
}) {
  return (
    <li
      className={`py-3 ${showTopBorder ? "border-t-2 border-[#002070]" : "pt-0"}`}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
        <span
          className={`mt-0.5 font-[family-name:var(--font-pixel)] text-[8px] ${
            repo.health === "bad"
              ? "text-[#e84848]"
              : repo.health === "warn"
                ? "text-[#f0d25a]"
                : "text-[#3ecf5a]"
          }`}
        >
          {repo.health === "bad" ? "危" : repo.health === "warn" ? "注" : "安"}
        </span>
        <div>
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 font-[family-name:var(--font-pixel)] text-[10px] leading-relaxed">
            <span>{repo.name}</span>
            {repo.tier === "discovered" ? (
              <span className="text-[8px] text-[#9ec0ff]">未監視</span>
            ) : !repo.measured ? (
              <span className="text-[8px] text-[#c9c3a0]">計測なし</span>
            ) : null}
          </p>
          <p className="mt-1 text-[13px] text-[#c9c3a0]">{repo.note}</p>
          {repo.measured ? (
            <div className="mt-2 h-2.5 border-2 border-[#223] bg-black">
              <i
                className={`block h-full ${
                  repo.health === "ok"
                    ? "w-[85%] bg-[#3ecf5a]"
                    : repo.health === "warn"
                      ? "w-[45%] bg-[#f0d25a]"
                      : "w-[22%] bg-[#e84848]"
                }`}
              />
            </div>
          ) : (
            <div className="mt-2 h-2.5 border-2 border-dashed border-[#445] bg-black/40" />
          )}
          {repo.criteria ? (
            <p className="mt-2 mb-0 text-[12px] leading-relaxed text-[#9ec0ff]">
              {repo.criteria}
            </p>
          ) : null}
          {repo.uplift ? (
            <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              より良く: {repo.uplift}
            </p>
          ) : null}
        </div>
        {repo.nextAction ? (
          <Link
            href={repo.nextAction.href}
            className="dq-btn shrink-0 !px-3 !py-2 text-[8px]"
          >
            {repo.nextAction.label}
          </Link>
        ) : repo.prescriptionHref ? (
          <Link
            href={repo.prescriptionHref}
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
          >
            見立て
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function RepoSection({
  title,
  sub,
  blurb,
  repos,
  empty,
}: {
  title: string;
  sub: string;
  blurb: string;
  repos: HarnessRepo[];
  empty: string;
}) {
  return (
    <AtlasReveal as="section" className="dq-win p-3.5">
      <AtlasPageTitle title={title} sub={sub} />
      <p className="mb-3 text-[13px] leading-relaxed text-[#c9c3a0]">{blurb}</p>
      {repos.length === 0 ? (
        <p className="text-[14px] text-[#c9c3a0]">{empty}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {repos.map((repo, i) => (
            <RepoRow key={repo.id} repo={repo} showTopBorder={i > 0} />
          ))}
        </ul>
      )}
    </AtlasReveal>
  );
}

/** /harness — どうぐ（処方・ハーネス） */
export function AtlasHarness({
  repos,
  streakDays,
  wsToken = null,
  weeklyTokens = [],
}: {
  repos: HarnessRepo[];
  streakDays?: number;
  wsToken?: string | null;
  /** B12-4: 観測グラフ（先に見せ、canon は下のリンク） */
  weeklyTokens?: WeeklyTokenBreakdown[];
}) {
  const watched = repos.filter((r) => r.tier === "watched");
  const discovered = repos.filter((r) => r.tier === "discovered");
  const weak = watched.filter((r) => r.health !== "ok" && r.measured);
  const focus = weak[0] ?? watched[0] ?? discovered[0];
  const hasTokenSignal = weeklyTokens.some(
    (w) =>
      w.cacheRead + w.cacheCreate + w.tokensIn + w.tokensOut + w.thinking > 0,
  );
  return (
    <AtlasChrome active="/harness" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="harness"
              context={
                focus
                  ? `注目 repo: ${focus.name}\nhealth: ${focus.health}\n${focus.criteria ?? ""}\n${focus.uplift ?? ""}`
                  : "観測なし。suggest_cache_prefix_form の前に計測を溜めよ。"
              }
              title="じゅもんで処方を進める"
              blurb="どうぐの見立てを、じゅもんで実行の段まで進めよ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle title="観測（週次トークン）" sub="先に数字を見る" />
          <p className="mb-3 text-[13px] leading-relaxed text-[#c9c3a0]">
            ハーネス理解ループの入口。積み上げを見てから、下の repo
            見立て・canon へ進め（P3 B12-4）。ここでの％・棒は commit
            量ではなく、LLM セッション計測じゃ。
          </p>
          {hasTokenSignal ? (
            <TokenStackChart weeks={weeklyTokens} />
          ) : (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              まだ週次トークンが無い。ハーネス計測が溜まるとここに棒が出る。
            </p>
          )}
          <p className="mt-3 mb-0">
            <Link
              href="/harness/concepts/prompt-cache"
              className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
            >
              canon: プロンプトキャッシュの型 →
            </Link>
          </p>
        </AtlasReveal>
        <RepoSection
          title="どうぐ · 監視本線"
          sub={
            weak.length
              ? `弱っておる計測が ${weak.length} 件`
              : watched.length
                ? `監視 ${watched.length} 件`
                : "監視リポジトリなし"
          }
          blurb="git hook で監視しているリポジトリは、LLM セッション計測が無くても必ず出す。危・注だけでなく、安でも「なぜ安か／どう上げるか」を見立てで確認せよ。"
          repos={watched}
          empty="監視リポジトリがまだないぞ。設定から供給対象を追加せよ。"
        />
        <RepoSection
          title="どうぐ · 計測だけで見えた"
          sub={
            discovered.length
              ? `${discovered.length} 件（未監視）`
              : "いまはなし"
          }
          blurb="監視リスト外だが HarnessRun 計測がある repo。作業はしているが鉤が付いていないときなどに出る。"
          repos={discovered}
          empty="監視外の計測はいま無い。"
        />
      </AtlasShell>
    </AtlasChrome>
  );
}
