"use client";

import { useMemo, useState, useTransition } from "react";
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
  buildJumonContext,
  MASTERY_STATES,
  type MasteryState,
  type TextbookView,
} from "@/lib/daily-textbook";
import {
  regenerateDailyTextbookAction,
  setTextbookMasteryAction,
} from "@/lib/actions";

type Depth = "plain" | "deep";
type Mode = "read" | "check";

const DEPTH_KEY = "atlas-textbook-depth";

const DIAGRAM_BAD: Record<string, string> = {
  silent_gap: "材料は溜まっているのに、即時しれんだけ止まって沈黙したように見える",
  drift: "複数の種類の足跡が混ざり、何を覚えたかぼやける",
  prefix: "処方が頭にないままツールをいじり、同じ轍を踏む",
  generic: "足跡を眺めず次へ進み、説明できないまま翌日を迎える",
};

const DIAGRAM_OK: Record<string, string> = {
  silent_gap: "材料は残し、夜の教科書で章に圧縮して確認する",
  drift: "repo ごとに章を分け、ひとことで説明する",
  prefix: "一次情報を開き、処方の『なぜ』を1行で残す",
  generic: "章を読んで確認し、Mastery で翌日の導線を決める",
};

const MASTERY_LABEL: Record<MasteryState, string> = {
  clear: "CLEAR",
  partial: "まだ半分",
  stuck: "つまずき",
  parked: "あとまわし",
};

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
                label="きょうのしょを生成"
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
      <main className="mx-auto max-w-3xl px-4 py-6 pb-40">
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
          <div className="mt-3">
            <GenerateButton
              dateKey={textbook.dateKey}
              pending={pending}
              startTransition={startTransition}
              label="再生成"
            />
          </div>
        </section>

        {mode === "read" ? (
          <div className="space-y-4">
            {textbook.chapters.map((ch) => {
              const active = activeChapter?.id === ch.id;
              const body =
                depth === "deep" && ch.bodyDeep ? ch.bodyDeep : ch.bodyPlain;
              return (
                <article
                  key={ch.id}
                  id={`chapter-${ch.index}`}
                  className={`dq-win p-4 ${active ? "ring-2 ring-[#f0d25a]" : ""}`}
                  onClick={() => setActiveChapterId(ch.id)}
                  onFocus={() => setActiveChapterId(ch.id)}
                >
                  <p className="m-0 text-[10px] tracking-wide text-[#f0d25a]">
                    第{ch.index}章
                  </p>
                  <h3 className="mt-1 mb-2 text-[18px] text-[#f7f3d9]">{ch.title}</h3>
                  <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
                    {ch.oneLiner}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="border-[2px] border-[#e84848]/60 bg-[#2a0008] p-2.5">
                      <p className="m-0 text-[10px] text-[#e84848]">BAD</p>
                      <p className="mt-1 mb-0 text-[13px] text-[#c9c3a0]">
                        {DIAGRAM_BAD[ch.diagramKind] ?? DIAGRAM_BAD.generic}
                      </p>
                    </div>
                    <div className="border-[2px] border-[#3ecf5a]/60 bg-[#002a10] p-2.5">
                      <p className="m-0 text-[10px] text-[#3ecf5a]">OK</p>
                      <p className="mt-1 mb-0 text-[13px] text-[#c9c3a0]">
                        {DIAGRAM_OK[ch.diagramKind] ?? DIAGRAM_OK.generic}
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
                  {wsToken && active ? (
                    <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                      <AtlasAssist
                        wsToken={wsToken}
                        intent={"general" satisfies AtlasAssistIntent}
                        context={jumonContext}
                        title="じゅもん（AIと対話して深掘り）"
                        blurb="この章だけを賢者に渡して問え。"
                        plain="注入は開いている1章＋ひとこと＋一次情報のみ。日次全量や diff 本文は載せぬ（ADR-0020）。"
                        defaultCmd="codex"
                      />
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

        {mode === "read" && wsToken && activeChapter ? (
          <div className="fixed right-0 bottom-0 left-0 z-20 border-t-4 border-white bg-[#001a8c] px-3 py-2 shadow-[0_-6px_0_#000]">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
              <div>
                <p className="m-0 font-[family-name:var(--font-press-start,monospace)] text-[9px] text-[#f0d25a]">
                  じゅもん（AIと対話）
                </p>
                <p className="m-0 text-[12px] text-[#c9c3a0]">
                  章{activeChapter.index} を開いた状態で深掘りできる
                </p>
              </div>
              <a
                href={`#chapter-${activeChapter.index}`}
                className="dq-btn !px-3 !py-2 text-[8px]"
              >
                じゅもんをとなえる（AIを開く）
              </a>
            </div>
          </div>
        ) : null}
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
