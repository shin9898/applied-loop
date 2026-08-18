"use client";

import type { ReactNode } from "react";

/**
 * 日次(EvidenceLink: kind が commit|doc|file|other のリテラル union)と
 * 週のしょ(WeeklyTextbookView: kind が string に緩む JSON パース結果)は
 * evidence の kind の厳密度が異なる。表示は kind.toUpperCase() のみなので
 * ここでは string で受け、両者ともキャスト無しで渡せるようにする。
 */
type ChapterEvidence = {
  kind: string;
  label: string;
  url?: string;
  ref?: string;
};

/**
 * にっき（日次）／週のしょ 共通の章カード。
 * 「章の先頭 = タイトル＋やったこと要約」だけで何の話か分かり、
 * 7スロット構造の本文は `<details>` に畳む（読むのは要約 → 必要なら開く）。
 * 章末アクション（じゅもん・LLM研磨など）は呼び出し側が footer で差し込む
 * （日次にはあるが週のしょには無いため、カード自体は関知しない）。
 */
export function AtlasTextbookChapterCard({
  index,
  title,
  didSummary,
  materialCount,
  evidenceCount,
  body,
  lessons,
  diagramBad,
  diagramOk,
  evidence,
  active = false,
  footer,
}: {
  index: number;
  title: string;
  didSummary: string;
  materialCount: number;
  evidenceCount: number;
  /** bodyForDisplay 済みの本文（マーカー・スロット見出しは除去済み） */
  body: string;
  lessons: {
    work: string;
    timing: string;
    action: string;
    why: string;
    practice: string;
    consequence: string;
    alternative: string;
  };
  diagramBad: string;
  diagramOk: string;
  evidence: ChapterEvidence[];
  active?: boolean;
  footer?: ReactNode;
}) {
  return (
    <article
      id={`chapter-${index}`}
      className={`atlas-journal atlas-journal--chapter ${active ? "is-active" : ""}`}
    >
      <div className="atlas-journal__page">
        <p className="atlas-journal__chapter-no">第{index}章</p>
        {/* 章の先頭 = タイトル＋やったこと要約。ここだけで何の話か分かる */}
        <div className="atlas-journal__summary">
          <h3 className="atlas-journal__chapter-title">{title}</h3>
          <p className="atlas-journal__summary-did">{didSummary}</p>
          <div className="atlas-journal__facts">
            <span className="atlas-journal__fact">
              材料{" "}
              <span className="atlas-journal__fact-v">{materialCount}</span>
            </span>
            <span className="atlas-journal__fact">
              一次情報{" "}
              <span className="atlas-journal__fact-v">{evidenceCount}</span>
            </span>
          </div>
        </div>

        {/* 構造化スロットは折りたたみ。読むのは要約 → 必要なら開く */}
        <details className="atlas-journal__deep">
          <summary className="atlas-journal__deep-summary">
            くわしく読む（なぜ・型・別案）
            <span className="atlas-journal__deep-hint">
              7スロット + BAD/OK
            </span>
          </summary>
          <div className="atlas-journal__deep-body">
            <pre className="atlas-journal__body">{body}</pre>
            <div className="mt-3 space-y-2">
              <LessonBlock label="いま進めていた改修" text={lessons.work} />
              <LessonBlock
                label="ナレッジが溜まったタイミング"
                text={lessons.timing}
              />
              <LessonBlock label="とった対応" text={lessons.action} />
              <LessonBlock label="その理由" text={lessons.why} />
              <LessonBlock label="ベストプラクティス" text={lessons.practice} />
              <LessonBlock
                label="従うとどうなる"
                text={lessons.consequence}
              />
              <LessonBlock label="やりがちな別案" text={lessons.alternative} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="atlas-journal__callout atlas-journal__callout--bad">
                <p className="atlas-journal__callout-label">BAD</p>
                <p className="atlas-journal__callout-body">{diagramBad}</p>
              </div>
              <div className="atlas-journal__callout atlas-journal__callout--ok">
                <p className="atlas-journal__callout-label">OK</p>
                <p className="atlas-journal__callout-body">{diagramOk}</p>
              </div>
            </div>
            {evidence.length > 0 ? (
              <ul className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0">
                {evidence.map((e, i) => (
                  <li key={`${e.label}-${i}`}>
                    {e.url ? (
                      <a
                        href={e.url}
                        className="atlas-journal__chip"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {e.kind.toUpperCase()} · {e.label}
                      </a>
                    ) : (
                      <span className="atlas-journal__chip is-muted">
                        {e.kind.toUpperCase()} · {e.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
        {footer ? (
          <div className="atlas-journal__footer-actions">{footer}</div>
        ) : null}
      </div>
    </article>
  );
}

function LessonBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="atlas-journal__lesson">
      <p className="atlas-journal__lesson-label">{label}</p>
      <p className="atlas-journal__lesson-body">{text}</p>
    </div>
  );
}
