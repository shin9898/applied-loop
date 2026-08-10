"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
  MASTERY_STATES,
  type MasteryState,
  type TextbookView,
} from "@/lib/daily-textbook-shared";
import {
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
  const [pending, startTransition] = useTransition();
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
          <AtlasPageTitle title="きょうのしょ" sub="日次教科書" />
          <section className="dq-win p-4">
            <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
              この日の教科書はまだない。材料（実装の足跡）が溜まっていれば生成できる。
            </p>
            <p className="mt-2 mb-0 text-[13px] text-[#9ec0ff]">{dateKey}</p>
            {typeof materialCountToday === "number" ? (
              <p className="mt-2 mb-0 text-[13px] text-[#c9c3a0]">
                材料: {materialCountToday} 件
                {materialCountToday === 0
                  ? "（commit 等を受け取ると増える）"
                  : ""}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <GenerateButton
                dateKey={dateKey}
                pending={pending}
                startTransition={startTransition}
                label="手元で生成（LLMなし）"
              />
              <Link href="/retro" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
                一覧へ
              </Link>
              <Link href="/gates" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
                しれんへ
              </Link>
            </div>
          </section>
        </main>
      </AtlasChrome>
    );
  }

  return (
    <AtlasChrome active="/retro" streakDays={streakDays}>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <AtlasPageTitle title="きょうのしょ" sub={textbook.dateKey} />
          <div className="flex flex-wrap items-center gap-2">
            <ModeToggle mode={mode} onChange={setMode} />
            <span className="text-[11px] text-[#9a9470]">深さ</span>
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

        <section className="dq-win mb-4 p-4">
          <h2 className="dq-win-title mb-2">{textbook.title}</h2>
          <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
            {textbook.lead}
          </p>
          <p className="mt-2 mb-0 text-[12px] text-[#9ec0ff]">
            材料 {textbook.materialCount} · 章 {textbook.chapterCount}
            {textbook.peakHour != null ? ` · ピーク ${textbook.peakHour}時台` : ""}
            {textbook.droppedMaterialIds.length > 0
              ? ` · 圧縮で畳んだ材料 ${textbook.droppedMaterialIds.length}`
              : ""}
          </p>
          <div className="mt-3 space-y-2">
            <p className="m-0 text-[12px] leading-relaxed text-[#9a9470]">
              「手元で再圧縮」は LLM を呼ばない。DB の材料から規則で章を作り直す。
              深掘りは各章末の導線から。最下部のじゅもんへ飛ぶ。
            </p>
            <GenerateButton
              dateKey={textbook.dateKey}
              pending={pending}
              startTransition={startTransition}
              label="手元で再圧縮（LLMなし）"
            />
          </div>
        </section>

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
                  className={`dq-win p-4 ${active ? "ring-2 ring-[#f0d25a]" : ""}`}
                >
                  <p className="m-0 text-[10px] tracking-wide text-[#f0d25a]">
                    第{ch.index}章
                  </p>
                  <h3 className="mt-1 mb-2 text-[18px] text-[#f7f3d9]">
                    {ch.title}
                  </h3>
                  <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
                    {ch.oneLiner}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="border-[2px] border-[#e84848]/60 bg-[#2a0008] p-2.5">
                      <p className="m-0 text-[10px] text-[#e84848]">BAD</p>
                      <p className="mt-1 mb-0 text-[13px] text-[#c9c3a0]">
                        {ch.diagramBad}
                      </p>
                    </div>
                    <div className="border-[2px] border-[#3ecf5a]/60 bg-[#002a10] p-2.5">
                      <p className="m-0 text-[10px] text-[#3ecf5a]">OK</p>
                      <p className="mt-1 mb-0 text-[13px] text-[#c9c3a0]">
                        {ch.diagramOk}
                      </p>
                    </div>
                  </div>
                  <pre className="mt-3 mb-0 whitespace-pre-wrap font-[inherit] text-[13px] leading-relaxed text-[#c9c3a0]">
                    {body}
                  </pre>
                  {ch.evidence.length > 0 ? (
                    <ul className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0">
                      {ch.evidence.map((e, i) => (
                        <li key={`${e.label}-${i}`}>
                          {e.url ? (
                            <a
                              href={e.url}
                              className="inline-block border-2 border-white px-2 py-1 text-[11px] text-[#9ec0ff]"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {e.kind.toUpperCase()} · {e.label}
                            </a>
                          ) : (
                            <span className="inline-block border-2 border-[#665] px-2 py-1 text-[11px] text-[#c9c3a0]">
                              {e.kind.toUpperCase()} · {e.label}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {wsToken ? (
                    <div className="mt-4 border-t-2 border-[#002070] pt-3">
                      <button
                        type="button"
                        className="dq-btn !px-3 !py-2 text-[8px]"
                        onClick={() => openJumonForChapter(ch.id)}
                      >
                        この章を深掘り（じゅもんへ）
                      </button>
                      <p className="mt-1.5 mb-0 text-[11px] text-[#9a9470]">
                        最下部へ移動し、この章だけを賢者に渡す。
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {textbook.chapters.length === 0 ? (
              <section className="dq-win p-4">
                <p className="m-0 text-[14px] text-[#c9c3a0]">
                  章が立たなかった。材料ゼロか、生成前じゃ。
                </p>
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
                  plain="注入は選んだ1章＋ひとこと＋一次情報のみ。日次全量や diff 本文は載せぬ（ADR-0020）。章を変えたらじゅもんを閉じてもう一度となえよ。"
                  defaultCmd="codex"
                />
              </section>
            ) : null}
          </div>
        ) : (
          <section className="dq-win space-y-4 p-4">
            <p className="m-0 text-[13px] text-[#c9c3a0]">
              確認モード。じゅもんは閉じている。Mastery で翌日の導線を決める。
            </p>
            {textbook.checks.map((ck) => {
              const mastery = localMastery[ck.id] ?? ck.mastery;
              return (
                <div key={ck.id} className="border-t-2 border-[#002070] pt-3">
                  <p className="m-0 text-[10px] text-[#f0d25a]">問 {ck.index}</p>
                  <p className="mt-1 mb-2 text-[15px] text-[#f7f3d9]">{ck.question}</p>
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
              <p className="m-0 text-[14px] text-[#c9c3a0]">確認問いがまだない。</p>
            ) : null}
          </section>
        )}
      </main>
    </AtlasChrome>
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
