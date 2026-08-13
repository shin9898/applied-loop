import Link from "next/link";
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
        この日の外部セッション: {digest.sessionCount}件・{digest.repoCount} repo
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

const STRIP_MAX_CARDS = 4;

/** ホーム（ちず）のマップ直下・「いまの一手」CTAの下に置く横並びカード */
export function AtlasSessionDigestStrip({
  digest,
  activeRepo,
}: {
  digest: SessionDigest;
  activeRepo?: string | null;
}) {
  if (digest.sessionCount === 0) return null;

  const shown = digest.byRepo.slice(0, STRIP_MAX_CARDS);
  const overflow = digest.byRepo.length - shown.length;

  return (
    <div className="mt-3 border-t-2 border-[#002070] pt-3">
      <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
        ◆ きょうのきろく
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((r) => (
          <Link
            key={r.repo}
            href={`/retro/${digest.dateKey}`}
            className={`dq-btn dq-btn-ghost !px-2.5 !py-1.5 text-left text-[11px] no-underline ${
              activeRepo === r.repo ? "outline outline-2 outline-[#f0d25a]" : ""
            }`}
          >
            <span className="block">{r.repo}</span>
            <span className="block text-[10px] text-[#c9c3a0]">
              {r.sessionCount}セッション
              {r.captureCount > 0 ? `・学び+${r.captureCount}` : ""}
            </span>
          </Link>
        ))}
        {overflow > 0 ? (
          <span className="self-center text-[11px] text-[#c9c3a0]">
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  );
}
