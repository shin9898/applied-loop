"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AtlasAssist,
  type AtlasAssistIntent,
} from "@/components/living-atlas/atlas-assist";
import {
  AtlasChrome,
  AtlasPageTitle,
} from "@/components/living-atlas/atlas-chrome";
import {
  bodyForDisplay,
  buildJumonContext,
  chapterDidSummary,
  MASTERY_STATES,
  type MasteryState,
  type TextbookView,
} from "@/lib/daily-textbook-shared";
import {
  polishTextbookChapterAction,
  regenerateDailyTextbookAction,
  setTextbookMasteryAction,
} from "@/lib/actions";

type Depth = "plain" | "deep";
type Mode = "read" | "check";

const DEPTH_KEY = "atlas-textbook-depth";

const MASTERY_LABEL: Record<MasteryState, string> = {
  clear: "CLEAR",
  partial: "まだ半分",
  stuck: "つまずき",
  parked: "あとまわし",
};

function scrollToJumon() {
  document
    .getElementById("atlas-jumon")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function AtlasDailyTextbook({
  dateKey,
  textbook,
  streakDays,
  wsToken,
  materialCountToday,
}: {
  dateKey: string;
  textbook: TextbookView | null;
  streakDays?: number;
  wsToken: string | null;
  /** 未生成時の材料件数 */
  materialCountToday?: number;
}) {
  const [mode, setMode] = useState<Mode>("read");
  const [depth, setDepth] = useState<Depth>(() => {
    if (typeof window === "undefined") return "plain";
    return localStorage.getItem(DEPTH_KEY) === "deep" ? "deep" : "plain";
  });
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    textbook?.chapters[0]?.id ?? null,
  );
  /** 章導線から最下部じゅもんへスクロールする予約 */
  const [pendingJumonScroll, setPendingJumonScroll] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishingId, setPolishingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [localMastery, setLocalMastery] = useState<Record<string, MasteryState>>(
    () => {
      const init: Record<string, MasteryState> = {};
      for (const c of textbook?.checks ?? []) {
        if (c.mastery) init[c.id] = c.mastery;
      }
      return init;
    },
  );

  const activeChapter = useMemo(() => {
    if (!textbook?.chapters.length) return null;
    return (
      textbook.chapters.find((c) => c.id === activeChapterId) ??
      textbook.chapters[0]
    );
  }, [textbook, activeChapterId]);

  const jumonContext = useMemo(() => {
    if (!textbook || !activeChapter) return "";
    return buildJumonContext({
      dateKey: textbook.dateKey,
      depth,
      chapter: activeChapter,
    });
  }, [textbook, activeChapter, depth]);

  useEffect(() => {
    if (!pendingJumonScroll) return;
    scrollToJumon();
    setPendingJumonScroll(false);
  }, [pendingJumonScroll, activeChapterId]);

  function openJumonForChapter(chapterId: string) {
    setActiveChapterId(chapterId);
    setPendingJumonScroll(true);
  }

  function setDepthPersist(next: Depth) {
    setDepth(next);
    try {
      localStorage.setItem(DEPTH_KEY, next);
    } catch {
      /* ignore */
    }
  }

  if (!textbook) {
    return (
      <AtlasChrome active="/retro" streakDays={streakDays}>
        <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
          <AtlasPageTitle title="にっき" sub="日次のぼうけんにっき" />
          <div className="atlas-journal">
            <div className="atlas-journal__page">
              <p className="atlas-journal__lead">
                この日のページはまだない。材料（実装の足跡）が溜まっていれば生成できる。
              </p>
              <p className="atlas-journal__meta">{dateKey}</p>
              {typeof materialCountToday === "number" ? (
                <p className="atlas-journal__meta">
                  材料: {materialCountToday} 件
                  {materialCountToday === 0
                    ? "（commit 等を受け取ると増える）"
                    : ""}
                </p>
              ) : null}
              <div className="atlas-journal__actions">
                <GenerateButton
                  dateKey={dateKey}
                  pending={pending}
                  startTransition={startTransition}
                  label="手元で生成（LLMなし）"
                />
                <Link
                  href="/retro"
                  className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                >
                  ほんだなへ
                </Link>
                <Link
                  href="/gates"
                  className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                >
                  しれんへ
                </Link>
              </div>
            </div>
          </div>
        </main>
      </AtlasChrome>
    );
  }

  return (
    <AtlasChrome active="/retro" streakDays={streakDays}>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <AtlasPageTitle title="にっき" sub={textbook.dateKey} />
          <div className="flex flex-wrap items-center gap-2">
            <ModeToggle mode={mode} onChange={setMode} />
            <span className="text-[11px] text-[#9ed0b0]">深さ</span>
            <button
              type="button"
              className={`dq-btn !px-2 !py-1.5 text-[7px] ${depth === "plain" ? "" : "dq-btn-ghost"}`}
              aria-pressed={depth === "plain"}
              onClick={() => setDepthPersist("plain")}
            >
              初学者
            </button>
            <button
              type="button"
              className={`dq-btn !px-2 !py-1.5 text-[7px] ${depth === "deep" ? "" : "dq-btn-ghost"}`}
              aria-pressed={depth === "deep"}
              onClick={() => setDepthPersist("deep")}
            >
              実務
            </button>
          </div>
        </div>

        <div className="atlas-journal mb-4">
          <header className="atlas-journal__masthead">
            <div>
              <p className="atlas-journal__eyebrow">きょうのしょ</p>
              <h2 className="atlas-journal__heading">{textbook.title}</h2>
            </div>
            <Link
              href="/retro"
              className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
            >
              ほんだなへ
            </Link>
          </header>
          <div className="atlas-journal__page">
            <p className="atlas-journal__lead">{textbook.lead}</p>
            <p className="atlas-journal__meta">
              材料 {textbook.materialCount} · 章 {textbook.chapterCount}
              {textbook.peakHour != null
                ? ` · ピーク ${textbook.peakHour}時台`
                : ""}
              {textbook.droppedMaterialIds.length > 0
                ? ` · 圧縮で畳んだ材料 ${textbook.droppedMaterialIds.length}`
                : ""}
            </p>
            {textbook.chapters.length > 0 ? (
              <div className="atlas-journal__toc">
                <p className="atlas-journal__toc-label">
                  きょうの{textbook.chapters.length}章
                </p>
                <ul className="atlas-journal__toc-list">
                  {textbook.chapters.map((ch) => (
                    <li key={ch.id} className="atlas-journal__toc-item">
                      <a href={`#chapter-${ch.index}`}>
                        <span className="atlas-journal__toc-no">
                          第{ch.index}章
                        </span>
                        <span>{ch.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="atlas-journal__note">
              新規も再圧縮も同じ規則で「なぜ／型／結果／別案」を埋める（LLMなし）。
              各章の「LLMで磨く」は任意。深掘りは章末導線から最下部のじゅもんへ。
            </p>
            <div className="atlas-journal__actions">
              <GenerateButton
                dateKey={textbook.dateKey}
                pending={pending}
                startTransition={startTransition}
                label="手元で再圧縮（LLMなし）"
              />
            </div>
          </div>
        </div>

        {mode === "read" ? (
          <div className="space-y-4">
            {textbook.chapters.map((ch) => {
              const active = activeChapter?.id === ch.id;
              const body = bodyForDisplay(
                depth === "deep" && ch.bodyDeep ? ch.bodyDeep : ch.bodyPlain,
              );
              return (
                <article
                  key={ch.id}
                  id={`chapter-${ch.index}`}
                  className={`atlas-journal atlas-journal--chapter ${
                    active ? "is-active" : ""
                  }`}
                >
                  <div className="atlas-journal__page">
                  <p className="atlas-journal__chapter-no">
                    第{ch.index}章
                  </p>
                  {/* 章の先頭 = タイトル＋やったこと要約。ここだけで何の話か分かる */}
                  <div className="atlas-journal__summary">
                    <h3 className="atlas-journal__chapter-title">
                      {ch.title}
                    </h3>
                    <p className="atlas-journal__summary-did">
                      {chapterDidSummary({
                        oneLiner: ch.oneLiner,
                        action: ch.action,
                      })}
                    </p>
                    <div className="atlas-journal__facts">
                      <span className="atlas-journal__fact">
                        材料{" "}
                        <span className="atlas-journal__fact-v">
                          {ch.materialIds.length}
                        </span>
                      </span>
                      <span className="atlas-journal__fact">
                        一次情報{" "}
                        <span className="atlas-journal__fact-v">
                          {ch.evidence.length}
                        </span>
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
                  <pre className="atlas-journal__body">
                    {body}
                  </pre>
                  <div className="mt-3 space-y-2">
                    <LessonBlock label="いま進めていた改修" text={ch.work} />
                    <LessonBlock
                      label="ナレッジが溜まったタイミング"
                      text={ch.timing}
                    />
                    <LessonBlock label="とった対応" text={ch.action} />
                    <LessonBlock label="その理由" text={ch.why} />
                    <LessonBlock label="ベストプラクティス" text={ch.practice} />
                    <LessonBlock label="従うとどうなる" text={ch.consequence} />
                    <LessonBlock label="やりがちな別案" text={ch.alternative} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="atlas-journal__callout atlas-journal__callout--bad">
                      <p className="atlas-journal__callout-label">BAD</p>
                      <p className="atlas-journal__callout-body">
                        {ch.diagramBad}
                      </p>
                    </div>
                    <div className="atlas-journal__callout atlas-journal__callout--ok">
                      <p className="atlas-journal__callout-label">OK</p>
                      <p className="atlas-journal__callout-body">
                        {ch.diagramOk}
                      </p>
                    </div>
                  </div>
                  {ch.evidence.length > 0 ? (
                    <ul className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0">
                      {ch.evidence.map((e, i) => (
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
                  <div className="atlas-journal__footer-actions">
                    <div className="flex flex-wrap gap-2">
                      {wsToken ? (
                        <button
                          type="button"
                          className="dq-btn !px-3 !py-2 text-[8px]"
                          onClick={() => openJumonForChapter(ch.id)}
                        >
                          この章を深掘り（じゅもんへ）
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                        disabled={pending || polishingId === ch.id}
                        onClick={() => {
                          setPolishError(null);
                          setPolishingId(ch.id);
                          startTransition(async () => {
                            try {
                              const res = await polishTextbookChapterAction(
                                ch.id,
                                textbook.dateKey,
                              );
                              if (!res.ok) {
                                setPolishError(
                                  res.error ?? "研磨に失敗した。規則文のまま。",
                                );
                              } else {
                                router.refresh();
                              }
                            } catch (e) {
                              setPolishError(
                                e instanceof Error
                                  ? e.message
                                  : "研磨に失敗した。規則文のまま。",
                              );
                            } finally {
                              setPolishingId(null);
                            }
                          });
                        }}
                      >
                        {polishingId === ch.id
                          ? "研磨中…"
                          : "この章をLLMで磨く"}
                      </button>
                    </div>
                  </div>
                  </div>
                </article>
              );
            })}
            {polishError ? (
              <p className="m-0 text-[12px] text-[#e84848]">{polishError}</p>
            ) : null}
            {textbook.chapters.length === 0 ? (
              <section className="atlas-journal">
                <div className="atlas-journal__page">
                  <p className="atlas-journal__lead">
                    章が立たなかった。材料ゼロか、生成前じゃ。
                  </p>
                </div>
              </section>
            ) : null}

            {wsToken && activeChapter ? (
              <section id="atlas-jumon" className="scroll-mt-4 space-y-3">
                <div className="dq-win p-3.5">
                  <h2 className="dq-win-title mb-1">じゅもん</h2>
                  <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                    各章末の「この章を深掘り」から来る場所。読み終わった章を対象にして、ここで賢者を呼ぶ。
                  </p>
                  <p className="mt-2 mb-0 text-[12px] text-[#9ec0ff]">
                    いまの対象: 第{activeChapter.index}章「{activeChapter.title}」
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="self-center text-[11px] text-[#9a9470]">
                      章の切替
                    </span>
                    {textbook.chapters.map((ch) => {
                      const on = activeChapter.id === ch.id;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          className={`dq-btn !px-2 !py-1.5 text-[7px] ${
                            on ? "" : "dq-btn-ghost"
                          }`}
                          aria-pressed={on}
                          onClick={() => setActiveChapterId(ch.id)}
                        >
                          第{ch.index}章
                        </button>
                      );
                    })}
                  </div>
                </div>
                <AtlasAssist
                  key={activeChapter.id}
                  wsToken={wsToken}
                  intent={"general" satisfies AtlasAssistIntent}
                  context={jumonContext}
                  title={`じゅもん · 第${activeChapter.index}章`}
                  blurb={`「${activeChapter.title}」だけを賢者に渡して問え。`}
                  plain="注入は選んだ1章＋なぜ／型の短縮＋一次情報のみ。日次全量や diff 本文は載せぬ。章を変えたらじゅもんを閉じてもう一度となえよ。"
                  defaultCmd="codex"
                />
              </section>
            ) : null}
          </div>
        ) : (
          <section className="atlas-journal">
            <div className="atlas-journal__page space-y-4">
            <p className="atlas-journal__note">
              確認モード。じゅもんは閉じている。Mastery で翌日の導線を決める。
            </p>
            {textbook.checks.map((ck) => {
              const mastery = localMastery[ck.id] ?? ck.mastery;
              return (
                <div key={ck.id} className="border-t-2 border-[#245a40]/40 pt-3">
                  <p className="atlas-journal__chapter-no">問 {ck.index}</p>
                  <p className="atlas-journal__lead">{ck.question}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {MASTERY_STATES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={pending}
                        className={`dq-btn !px-2 !py-1.5 text-[7px] ${
                          mastery === m ? "" : "dq-btn-ghost"
                        }`}
                        onClick={() => {
                          setLocalMastery((prev) => ({ ...prev, [ck.id]: m }));
                          startTransition(async () => {
                            await setTextbookMasteryAction(
                              ck.id,
                              m,
                              textbook.dateKey,
                            );
                          });
                        }}
                      >
                        {MASTERY_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {textbook.checks.length === 0 ? (
              <p className="atlas-journal__lead">確認問いがまだない。</p>
            ) : null}
            </div>
          </section>
        )}
      </main>
    </AtlasChrome>
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

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="flex overflow-hidden border-[3px] border-white">
      {(
        [
          ["read", "読む"],
          ["check", "確認する"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`px-3 py-1.5 font-[family-name:var(--font-press-start,monospace)] text-[8px] ${
            mode === id
              ? "bg-[#f0d25a] text-[#1a1000]"
              : "bg-[#000c4a] text-[#f7f3d9]"
          }`}
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function GenerateButton({
  dateKey,
  pending,
  startTransition,
  label,
}: {
  dateKey: string;
  pending: boolean;
  startTransition: (fn: () => void) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      className="dq-btn !px-3 !py-2 text-[8px]"
      onClick={() => {
        startTransition(async () => {
          await regenerateDailyTextbookAction(dateKey);
        });
      }}
    >
      {pending ? "生成中…" : label}
    </button>
  );
}
