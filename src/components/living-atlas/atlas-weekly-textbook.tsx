"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AtlasPageTitle } from "./atlas-chrome";
import {
  MASTERY_STATES,
  normalizeOneLinerForDisplay,
} from "@/lib/daily-textbook-shared";
import { setWeeklyCheckMasteryAction } from "@/lib/actions";
import type { WeeklyTextbookView } from "@/lib/weekly-textbook";

export function AtlasWeeklyTextbook({
  textbook,
  prevWeekKey,
  nextWeekKey,
}: {
  textbook: WeeklyTextbookView;
  prevWeekKey?: string | null;
  nextWeekKey?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [localMastery, setLocalMastery] = useState<Record<string, string>>({});
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    textbook.chapters[0]?.id ?? null,
  );
  const activeChapter =
    textbook.chapters.find((c) => c.id === activeChapterId) ?? null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 pb-28">
      <AtlasPageTitle title="週のしょ" sub={textbook.weekKey} />
      <div className="atlas-journal">
        <div className="atlas-journal__page space-y-4">
          <div className="flex items-center justify-between text-[10px]">
            {prevWeekKey ? (
              <Link
                href={`/retro/weekly/${prevWeekKey}`}
                className="atlas-band-shelf__archive"
              >
                ← {prevWeekKey}
              </Link>
            ) : (
              <span className="atlas-journal__note opacity-40">
                これより前は無い
              </span>
            )}
            {nextWeekKey ? (
              <Link
                href={`/retro/weekly/${nextWeekKey}`}
                className="atlas-band-shelf__archive"
              >
                {nextWeekKey} →
              </Link>
            ) : (
              <span className="atlas-journal__note opacity-40">
                これより後は無い
              </span>
            )}
          </div>
          <p className="atlas-journal__lead">{textbook.lead}</p>

          {textbook.chapters.length === 0 ? (
            <p className="atlas-journal__note">
              この週は拾いきれなかった材料が無かった。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {textbook.chapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className={`dq-btn !px-2 !py-1.5 text-[7px] ${
                      ch.id === activeChapterId ? "" : "dq-btn-ghost"
                    }`}
                    aria-pressed={ch.id === activeChapterId}
                    onClick={() => setActiveChapterId(ch.id)}
                  >
                    第{ch.index}章
                  </button>
                ))}
              </div>

              {activeChapter ? (
                <div className="border-t-2 border-[#245a40]/40 pt-3 space-y-2">
                  <p className="atlas-journal__chapter-no">
                    第{activeChapter.index}章
                  </p>
                  <h3 className="atlas-journal__heading">
                    {activeChapter.title}
                  </h3>
                  <p className="atlas-journal__lead">
                    {normalizeOneLinerForDisplay(activeChapter.oneLiner)}
                  </p>
                  <p className="atlas-journal__note whitespace-pre-wrap">
                    {activeChapter.bodyPlain}
                  </p>
                </div>
              ) : null}

              {textbook.checks.length > 0 ? (
                <div className="space-y-3">
                  <p className="atlas-journal__note">
                    確認問い。Mastery で振り返りを記録する。
                  </p>
                  {textbook.checks.map((ck) => {
                    const mastery = localMastery[ck.id] ?? ck.mastery;
                    return (
                      <div
                        key={ck.id}
                        className="border-t-2 border-[#245a40]/40 pt-3"
                      >
                        <p className="atlas-journal__chapter-no">
                          問 {ck.index}
                        </p>
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
                                setLocalMastery((prev) => ({
                                  ...prev,
                                  [ck.id]: m,
                                }));
                                startTransition(async () => {
                                  await setWeeklyCheckMasteryAction(
                                    ck.id,
                                    m,
                                    textbook.weekKey,
                                  );
                                });
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}

          <div className="atlas-journal__divider" aria-hidden />
          <Link href="/retro" className="atlas-band-shelf__archive">
            にっきへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
