"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasTextbookChapterCard } from "./atlas-textbook-chapter-card";
import {
  bodyForDisplay,
  chapterDidSummary,
  MASTERY_STATES,
} from "@/lib/daily-textbook-shared";
import {
  promoteTextbookCheckToGateAction,
  setWeeklyCheckMasteryAction,
} from "@/lib/actions";
import type { WeeklyTextbookView } from "@/lib/weekly-textbook";
import { weeklyChapterLessons } from "@/lib/weekly-textbook-shared";

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
  const router = useRouter();
  const [localMastery, setLocalMastery] = useState<Record<string, string>>({});
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [promotingCheckId, setPromotingCheckId] = useState<string | null>(null);

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
              <div className="space-y-4">
                {textbook.chapters.map((ch) => {
                  const lessons = weeklyChapterLessons(ch.bodyDeep);
                  return (
                    <AtlasTextbookChapterCard
                      key={ch.id}
                      index={ch.index}
                      title={ch.title}
                      didSummary={chapterDidSummary({
                        oneLiner: ch.oneLiner,
                        action: lessons.action,
                      })}
                      materialCount={ch.materialIds.length}
                      evidenceCount={ch.evidence.length}
                      body={bodyForDisplay(ch.bodyPlain)}
                      lessons={lessons}
                      diagramBad={lessons.diagramBad}
                      diagramOk={lessons.diagramOk}
                      evidence={ch.evidence}
                    />
                  );
                })}
              </div>

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
                          {mastery === "partial" || mastery === "stuck" ? (
                            <button
                              type="button"
                              disabled={pending || promotingCheckId === ck.id}
                              className="dq-btn !px-2 !py-1.5 text-[7px]"
                              onClick={() => {
                                setPromotionError(null);
                                setPromotingCheckId(ck.id);
                                startTransition(async () => {
                                  try {
                                    const result = await promoteTextbookCheckToGateAction(
                                      "weekly",
                                      ck.id,
                                    );
                                    if (!result.ok) {
                                      setPromotionError(
                                        result.code === "not_actionable"
                                          ? "「partial」または「stuck」の問いだけを、明示してしれんへ送れる。"
                                          : "この問いは更新されたか、由来を確かめられない。しょを読み直してから試して。",
                                      );
                                      return;
                                    }
                                    router.push(`/gates/${result.gateId}`);
                                  } catch {
                                    setPromotionError("しれんの準備に失敗した。あとで改めて試して。");
                                  } finally {
                                    setPromotingCheckId(null);
                                  }
                                });
                              }}
                            >
                              {promotingCheckId === ck.id ? "しれんを準備中…" : "Gateで確かめる"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {promotionError ? (
                <p className="m-0 text-[12px] text-[#e84848]">{promotionError}</p>
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
