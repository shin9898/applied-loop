import type { SessionDigest } from "@/lib/session-digest-shared";

/** にっき日次詳細ページ冒頭の「とびら」。教科書 生成済み/未生成 どちらの分岐でも使う */
export function AtlasSessionDigestDoor({ digest }: { digest: SessionDigest }) {
  if (digest.sessionCount === 0) {
    return (
      <p className="atlas-journal__meta atlas-session-digest-door">
        まだ外部セッションの記録が無い。
      </p>
    );
  }

  const captureTotal = digest.byRepo.reduce((n, r) => n + r.captureCount, 0);
  const gateTotal = digest.byRepo.reduce((n, r) => n + r.gateAnsweredCount, 0);

  const summaryParts: string[] = [];
  if (captureTotal > 0) summaryParts.push(`学び +${captureTotal}`);
  if (gateTotal > 0) summaryParts.push(`しれん回答 +${gateTotal}`);

  return (
    <div className="atlas-session-digest-door">
      <p className="atlas-journal__meta">
        本日の外部セッション: {digest.sessionCount}件・{digest.repoCount} repo
        {summaryParts.length > 0 ? ` → ${summaryParts.join("・")}` : ""}
      </p>
      <details className="atlas-session-digest-door__details mt-1">
        <summary className="cursor-pointer text-[12px] text-[#9ec0ff]">
          くわしく見る
        </summary>
        <ul className="atlas-session-digest-door__list mt-1 list-none p-0">
          {digest.byRepo.map((r) => (
            <li key={r.repo} className="mb-2">
              <p className="m-0 text-[13px] leading-relaxed">
                {r.repo}: {r.sessionCount}セッション
                {r.captureCount > 0 ? `・学び+${r.captureCount}` : ""}
                {r.gateAnsweredCount > 0
                  ? `・しれん回答+${r.gateAnsweredCount}`
                  : ""}
              </p>
              {r.captureSamples.length > 0 ? (
                <ul className="atlas-session-digest-door__samples mt-0.5 list-none pl-3 text-[12px] text-[#c9c3a0]">
                  {r.captureSamples.map((title, i) => (
                    <li key={i}>「{title}」</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
