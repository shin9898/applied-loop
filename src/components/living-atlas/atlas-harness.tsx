import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";

export type HarnessRepo = {
  id: string;
  name: string;
  health: "ok" | "warn" | "bad";
  note: string;
  prescriptionHref?: string;
  nextAction?: { label: string; href: string };
};

/** /harness — どうぐ（処方・ハーネス） */
export function AtlasHarness({
  repos,
  streakDays,
}: {
  repos: HarnessRepo[];
  streakDays?: number;
}) {
  const weak = repos.filter((r) => r.health !== "ok");
  return (
    <AtlasChrome active="/harness" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <AtlasPageTitle
            title="どうぐ"
            sub={weak.length ? `弱っておる repo が ${weak.length} 件` : "いまのところ元気じゃ"}
          />
          <p className="mb-3 text-[13px] leading-relaxed text-[#c9c3a0]">
            弱り具合を見て、右のネクストを1つやれ。処方の深い実行は MCP 側じゃ。
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
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 ${
                    i ? "border-t-2 border-[#002070]" : "pt-0"
                  }`}
                >
                  <span
                    className={`font-[family-name:var(--font-pixel)] text-[8px] ${
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
                  </div>
                  {repo.nextAction ? (
                    <Link
                      href={repo.nextAction.href}
                      className="dq-btn !px-3 !py-2 text-[8px]"
                    >
                      {repo.nextAction.label}
                    </Link>
                  ) : repo.prescriptionHref ? (
                    <Link
                      href={repo.prescriptionHref}
                      className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
                    >
                      処方
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
