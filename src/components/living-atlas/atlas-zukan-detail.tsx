import Link from "next/link";
import { placeFrom, systemLabel, type SystemKind } from "@/lib/atlas-taxonomy";
import {
  parseRootCause,
  rootCauseLabel,
  rootCauseOneLiner,
} from "@/lib/grade-payload";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";

export type AtlasZukanDetailProps = {
  item: {
    id: string;
    concept: string;
    status: "clear" | "open" | "fog";
    rootCause: string | null;
    system: SystemKind;
    repo: string | null;
    domain: string | null;
    gateId: string | null;
    gateQuestion: string | null;
    createdAt: Date;
  };
};

/** /zukan/[id] — ずかんの1枚カード詳細（図鑑ケースUI） */
export function AtlasZukanDetail({ item }: AtlasZukanDetailProps) {
  const place = placeFrom(item.repo, item.domain);
  const statusLabel =
    item.status === "clear"
      ? "CLEAR"
      : item.status === "fog"
        ? "ふたたびもや"
        : "未クリア";
  const cause = parseRootCause(item.rootCause);
  const causeLabel = rootCauseLabel(cause);
  const causeLine = rootCauseOneLiner(cause);

  return (
    <AtlasShell>
      <AtlasReveal as="section">
        <div className="mb-3">
          <Link
            href="/zukan"
            className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
          >
            ← ずかんにもどる
          </Link>
        </div>
        <AtlasPageTitle title="ずかん" sub={statusLabel} />

        <article
          className={`atlas-dex-sheet atlas-dex-sheet--${item.status}`}
        >
          <header className="atlas-dex-sheet__masthead">
            <AtlasSurfaceIcon surface="zukan" size={28} color="#f0d25a" />
            <div>
              <p className="atlas-dex-sheet__eyebrow">ぼうけんのずかん</p>
              <p className="atlas-dex-sheet__status">{statusLabel}</p>
            </div>
          </header>

          <div className="atlas-dex-sheet__page">
            <p className="atlas-dex-sheet__meta">
              {[place.label, systemLabel(item.system), causeLabel]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <h2 className="atlas-dex-sheet__title">{item.concept}</h2>
            {causeLine ? (
              <p className="atlas-dex-sheet__body">{causeLine}</p>
            ) : null}
            {item.gateQuestion ? (
              <div className="atlas-dex-sheet__gate">
                <p className="atlas-dex-sheet__gate-label">◆ 関連しれん</p>
                <p className="atlas-dex-sheet__gate-q">{item.gateQuestion}</p>
              </div>
            ) : null}
            <div className="atlas-dex-sheet__actions">
              {item.gateId && item.status !== "clear" ? (
                <Link
                  href={`/gates/${item.gateId}`}
                  className="dq-btn !px-3 !py-2 text-[8px]"
                >
                  たたかう
                </Link>
              ) : null}
              <Link
                href="/zukan"
                className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
              >
                一覧へ
              </Link>
            </div>
          </div>
        </article>
      </AtlasReveal>
    </AtlasShell>
  );
}
