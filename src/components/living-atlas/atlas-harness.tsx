import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

export type HarnessRepo = {
  id: string;
  name: string;
  health: "ok" | "warn" | "bad";
  note: string;
  /** 何を持ってその判定か */
  criteria?: string;
  /** より良くするための一手 */
  uplift?: string;
  prescriptionHref?: string;
  nextAction?: { label: string; href: string };
};

/** /harness — どうぐ（処方・ハーネス） */
export function AtlasHarness({
  repos,
  streakDays,
  wsToken = null,
}: {
  repos: HarnessRepo[];
  streakDays?: number;
  wsToken?: string | null;
}) {
  const weak = repos.filter((r) => r.health !== "ok");
  const focus = weak[0] ?? repos[0];
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
                  : "観測なし。suggest_cache_prefix_fix の前に計測を溜めよ。"
              }
              title="じゅもんで処方を進める"
              blurb="どうぐの見立てを、じゅもんで実行の段まで進めよ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="どうぐ"
            sub={weak.length ? `弱っておる repo が ${weak.length} 件` : "いまのところ元気じゃ"}
          />
          <p className="mb-3 text-[13px] leading-relaxed text-[#c9c3a0]">
            危・注だけでなく、安でも「なぜ安か／どう上げるか」を見立てで確認せよ。深い実行は MCP。
          </p>
          {repos.length === 0 ? (
            <p className="text-[14px] text-[#c9c3a0]">
              観測がまだないぞ。しれんを解くか、ハーネス計測が溜まるのを待て。
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {repos.map((repo, i) => (
                <li
                  key={repo.id}
                  className={`py-3 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
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
                      <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] leading-relaxed">
                        {repo.name}
                      </p>
                      <p className="mt-1 text-[13px] text-[#c9c3a0]">{repo.note}</p>
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
              ))}
            </ul>
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
