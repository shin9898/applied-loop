import Link from "next/link";
import type { CachePrefixPrescription } from "@/lib/cache-prefix-prescription";
import { AtlasShell } from "./atlas-shell";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";

function severityLabel(sev: CachePrefixPrescription["severity"]): string {
  if (sev === "act") return "要対応";
  if (sev === "watch") return "様子見";
  return "良好";
}

function severityTone(sev: CachePrefixPrescription["severity"]): string {
  if (sev === "act") return "text-[#e84848]";
  if (sev === "watch") return "text-[#f0d25a]";
  return "text-[#3ecf5a]";
}

/** /harness/prescriptions/[repo] — キャッシュ先頭の処方（DQ） */
export function AtlasPrescription({
  prescription,
  wsToken = null,
}: {
  prescription: CachePrefixPrescription;
  wsToken?: string | null;
}) {
  const label = severityLabel(prescription.severity);
  const tone = severityTone(prescription.severity);
  const obs = prescription.observed;
  const thisPct = obs ? (obs.thisWeekRate * 100).toFixed(1) : null;
  const lastPct = obs ? (obs.lastWeekRate * 100).toFixed(1) : null;
  const declinePct = obs
    ? Math.abs(Math.round(obs.declineRatio * 100))
    : null;
  const declining = obs ? obs.declineRatio > 0.05 : false;

  return (
    <AtlasShell>
      <AtlasReveal as="section">
        <div className="mb-3">
          <Link
            href="/harness"
            className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
          >
            ← どうぐにもどる
          </Link>
        </div>
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent="harness"
            context={`repo: ${prescription.repo}\nseverity: ${prescription.severity}\n${prescription.summary}`}
            title="じゅもんでこの処方を進める"
            blurb="この処方を、じゅもんで確かめ、足跡に残せ。"
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
      </AtlasReveal>
      <AtlasReveal as="section" className="dq-win p-3.5">
        <div className="mb-3">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] text-[#c9c3a0]">
            見立ての詳細
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="dq-win-title mb-0">しょほう</h1>
          <p className={`m-0 font-[family-name:var(--font-pixel)] text-[10px] ${tone}`}>
            {label}
          </p>
        </div>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] leading-relaxed text-[#9ec0ff]">
          {prescription.repo}
        </p>
        <p className="mt-2 mb-0 text-[15px] leading-relaxed text-[#f7f3d9]">
          {prescription.summary}
        </p>
        <p className="mt-2 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
          提案のみじゃ。プロジェクトルールへの強制書き込みはせん（ADR-0017）。
        </p>
        <div className="mt-3 border-l-[3px] border-[#9ec0ff] pl-2.5">
          <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
            ◆ 判定の閾値
          </p>
          <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
            危: 前週比悪化≥15%（一覧の危は≥25% or cache&lt;15%）／注: ≥5%／良好: それ未満。
            良好でも「維持」であり上限ではない。チェックリストで 80% 超を狙えるぞ。
          </p>
        </div>
      </AtlasReveal>

      {obs ? (
        <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
          <h2 className="dq-win-title">かんそく</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="m-0 text-[11px] text-[#c9c3a0]">今週</p>
              <p className="m-0 mt-1 font-[family-name:var(--font-pixel)] text-[14px] text-[#f7f3d9]">
                {thisPct}%
              </p>
            </div>
            <div>
              <p className="m-0 text-[11px] text-[#c9c3a0]">先週</p>
              <p className="m-0 mt-1 font-[family-name:var(--font-pixel)] text-[14px] text-[#f7f3d9]">
                {lastPct}%
              </p>
            </div>
            <div>
              <p className="m-0 text-[11px] text-[#c9c3a0]">前週比</p>
              <p
                className={`m-0 mt-1 font-[family-name:var(--font-pixel)] text-[14px] ${
                  declining ? "text-[#e84848]" : "text-[#f7f3d9]"
                }`}
              >
                {obs.declineRatio >= 0 ? "↓" : "↑"} {declinePct}%
              </p>
            </div>
          </div>
          <div className="mt-3 h-2.5 border-2 border-[#223] bg-black">
            <i
              className={`block h-full ${
                prescription.severity === "ok"
                  ? "bg-[#3ecf5a]"
                  : prescription.severity === "watch"
                    ? "bg-[#f0d25a]"
                    : "bg-[#e84848]"
              }`}
              style={{
                width: `${Math.min(100, Math.round(obs.thisWeekRate * 100))}%`,
              }}
            />
          </div>
        </AtlasReveal>
      ) : (
        <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
          <h2 className="dq-win-title">かんそく</h2>
          <p className="m-0 text-[14px] text-[#c9c3a0]">
            まだ十分な観測がないぞ。チェックリストから始めよ。
          </p>
        </AtlasReveal>
      )}

      <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
        <h2 className="dq-win-title">チェックリスト</h2>
        <ul className="m-0 list-none p-0">
          {prescription.checklist.map((c, i) => (
            <li
              key={c}
              className={`grid grid-cols-[auto_1fr] gap-3 py-2.5 ${
                i ? "border-t-2 border-[#002070]" : "pt-0"
              }`}
            >
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0]">
                □
              </span>
              <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">{c}</p>
            </li>
          ))}
        </ul>
      </AtlasReveal>

      <AtlasReveal as="section" delayIndex={3} className="dq-win p-3.5">
        <h2 className="dq-win-title">候補パッチ</h2>
        <p className="mb-3 mt-0 text-[12px] text-[#c9c3a0]">提案のみ。強制はせん。</p>
        <ul className="m-0 list-none p-0">
          {prescription.candidatePatches.map((c, i) => (
            <li
              key={c.target}
              className={`py-3 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
            >
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                {c.target}
              </p>
              <p className="mt-1.5 mb-0 text-[14px] leading-relaxed text-[#f7f3d9]">
                {c.suggestion}
              </p>
            </li>
          ))}
        </ul>
      </AtlasReveal>

      <AtlasReveal as="section" delayIndex={4} className="dq-win p-3.5">
        <h2 className="dq-win-title">つぎの一手</h2>
        <ul className="m-0 list-none p-0">
          {prescription.nextSteps.map((s, i) => (
            <li
              key={s}
              className={`py-2.5 ${i ? "border-t-2 border-[#002070]" : "pt-0"}`}
            >
              {s.startsWith("原理:") ? (
                <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">
                  原理:{" "}
                  <Link
                    href="/harness/concepts/prompt-cache"
                    className="text-[#9ec0ff] no-underline hover:underline"
                  >
                    プロンプトキャッシュ
                  </Link>
                </p>
              ) : (
                <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">{s}</p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 border-l-[3px] border-[#f0d25a] pl-2.5">
          <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
            適用後は MCP の record_application で appliedTo に{" "}
            <code className="text-[#9ec0ff]">{prescription.repo}</code> を含めよ。
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/harness" className="dq-btn !px-3 !py-2 text-[8px]">
              どうぐへ
            </Link>
            <Link
              href="/harness/concepts/prompt-cache"
              className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0] no-underline"
            >
              原理を読む
            </Link>
          </div>
        </div>
      </AtlasReveal>
    </AtlasShell>
  );
}
