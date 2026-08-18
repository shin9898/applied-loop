"use client";

import { useEffect, useMemo, useState } from "react";
import type { GateDebrief } from "@/lib/grade-payload";
import type { MicroCheckResult } from "@/lib/micro-check";
import {
  buildAnswerSeedFromMicro,
  loadMicroProgress,
  saveMicroProgress,
  type MicroClearedItem,
} from "@/lib/micro-progress";

export type MicroDrillProps = {
  gateId: string;
  debrief: GateDebrief;
  onCheck: (input: {
    aspect: string;
    paraphrase: string;
  }) => Promise<MicroCheckResult>;
  /** 通した文を束ねた下書きつきで完了 */
  onComplete: (seedDraft: string) => void;
  onSkipToAnswer: (seedDraft: string) => void;
};

/**
 * 不合格後: 弱い観点を1つずつ言い直すドリル。
 * 出題は評価ラベルではなく prompt、答え合わせは肯定の modelAnswer。
 */
export function AtlasMicroDrill({
  gateId,
  debrief,
  onCheck,
  onComplete,
  onSkipToAnswer,
}: MicroDrillProps) {
  const aspects = useMemo(
    () => debrief.weakAspects ?? [],
    [debrief.weakAspects],
  );

  const restored = useMemo(() => loadMicroProgress(gateId), [gateId]);

  const [index, setIndex] = useState(() =>
    Math.min(restored?.index ?? 0, Math.max(aspects.length - 1, 0)),
  );
  const [clearedItems, setClearedItems] = useState<MicroClearedItem[]>(
    () => restored?.cleared ?? [],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** 合格 FB を読ませてから次へ。自動遷移しない */
  const [passedPending, setPassedPending] = useState(false);
  const [allowSelf, setAllowSelf] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [gapNote, setGapNote] = useState("");
  const [confirmSkip, setConfirmSkip] = useState(false);

  const current = aspects[index];
  const total = aspects.length;

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setWaitSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    saveMicroProgress({
      gateId,
      index,
      cleared: clearedItems,
      microDone: false,
    });
  }, [gateId, index, clearedItems]);

  if (!current || total === 0) {
    return (
      <div className="mt-3 border-[3px] border-[#f0d25a] bg-[#000c4a] p-3">
        <p className="m-0 text-[14px] text-[#c9c3a0]">
          弱い観点の記録が無い。本回答へ進んでよいぞ。
        </p>
        <button
          type="button"
          className="dq-btn mt-3"
          onClick={() => onComplete("")}
        >
          本回答の準備へ
        </button>
      </div>
    );
  }

  function persistAndFinish(items: MicroClearedItem[], toRecall: boolean) {
    const seed = buildAnswerSeedFromMicro(items);
    saveMicroProgress({
      gateId,
      index: aspects.length,
      cleared: items,
      microDone: true,
    });
    if (toRecall) onComplete(seed);
    else onSkipToAnswer(seed);
  }

  function advance(item: MicroClearedItem) {
    const nextItems = [...clearedItems.filter((c) => c.aspect !== item.aspect), item];
    setClearedItems(nextItems);
    const next = index + 1;
    setText("");
    setFeedback(null);
    setPassedPending(false);
    setAllowSelf(false);
    setShowAnswer(false);
    setGapNote("");
    if (next >= total) {
      persistAndFinish(nextItems, true);
      return;
    }
    setIndex(next);
  }

  async function submitCheck() {
    if (busy || passedPending) return;
    setBusy(true);
    // 表示は busy 中のみなので、開始時にだけリセットすれば足りる
    setWaitSec(0);
    setFeedback(null);
    setPassedPending(false);
    try {
      const paraphrase = text.trim();
      const result = await onCheck({
        aspect: current.aspect,
        paraphrase,
      });
      setFeedback(result.feedback);
      setAllowSelf(result.allowSelfAdvance);
      if (result.ok) {
        // FB を読めるよう、本人が押すまで次の観点へ進まない
        setPassedPending(true);
      } else if (result.allowSelfAdvance) {
        setShowAnswer(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function selfAdvance() {
    if (gapNote.trim().length < 8) {
      setFeedback("足りなかった点を、自分の言葉で1行書いてから次へ進むのじゃ。");
      return;
    }
    advance({
      aspect: current.aspect,
      paraphrase: text.trim() || current.modelAnswer,
      gapNote: gapNote.trim(),
    });
  }

  const waitHint =
    waitSec >= 8
      ? "まだ判定中じゃ（10〜20秒かかることがある）。固まってはおらぬ。"
      : waitSec >= 3
        ? "判定の旅の途中じゃ…"
        : "みている…";

  return (
    <div className="mt-3 border-[3px] border-[#f0d25a] bg-[#000c4a] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          ◆ ミニチェック {index + 1} / {total}
        </div>
        <div className="text-[11px] text-[#c9c3a0]">
          通した {clearedItems.length} 観点
        </div>
      </div>

      <p className="m-0 mb-2 text-[12px] leading-relaxed text-[#c9c3a0]">
        正しい仕組みの全文と減点コメントは隠してある。下の問いに、見ずに答えよ。
        通した文は本回答の下書きに残るぞ。
      </p>

      <div className="mb-2 border-l-[3px] border-[#f0d25a] pl-2">
        <pre className="m-0 whitespace-pre-wrap font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#f7f3d9]">
          {current.prompt}
        </pre>
        <p className="mt-1.5 mb-0 text-[11px] text-[#c9c3a0]">
          （この論点は前回 {current.score === 0 ? "欠落" : "部分的"} だった）
        </p>
      </div>

      <textarea
        className="min-h-[72px] w-full resize-y border-[3px] border-white bg-[#000c4a] p-2.5 font-[family-name:var(--font-jp)] text-[15px] text-[#f7f3d9] disabled:opacity-60"
        placeholder="パターンと原因を、自分の言葉で1〜3文…"
        value={text}
        disabled={busy || passedPending}
        onChange={(e) => setText(e.target.value)}
      />

      {busy ? (
        <div className="mt-2 border-[3px] border-[#002070] bg-[#001060] px-2.5 py-2 text-[13px] text-[#c9c3a0]">
          <span className="font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
            ◆ 判定中 {waitSec}s
          </span>
          <p className="mt-1 mb-0">{waitHint}</p>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="dq-btn"
          disabled={busy || passedPending || !text.trim()}
          onClick={() => void submitCheck()}
        >
          {busy ? "判定中…" : "言い直した"}
        </button>
        <button
          type="button"
          className="dq-btn dq-btn-ghost"
          disabled={busy || passedPending}
          onClick={() => setShowAnswer(true)}
        >
          答え合わせを見る
        </button>
        <button
          type="button"
          className="dq-btn dq-btn-ghost"
          disabled={busy}
          onClick={() => setConfirmSkip(true)}
        >
          飛ばして本回答へ
        </button>
      </div>

      {confirmSkip ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#000814cc] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="atlas-skip-confirm-title"
        >
          <div className="dq-win w-full max-w-md p-4 shadow-[8px_8px_0_#000]">
            <p
              id="atlas-skip-confirm-title"
              className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]"
            >
              ◆ たしかにござるか
            </p>
            <p className="mt-3 mb-0 text-[14px] leading-relaxed text-[#f7f3d9]">
              ミニチェックを飛ばして本回答へ進む？ 通した文だけ下書きに残るぞ。
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="dq-btn dq-btn-ghost"
                onClick={() => setConfirmSkip(false)}
              >
                もどる
              </button>
              <button
                type="button"
                className="dq-btn"
                onClick={() => {
                  setConfirmSkip(false);
                  persistAndFinish(clearedItems, false);
                }}
              >
                飛ばして進む
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`mt-3 border-[3px] p-2.5 ${
            passedPending
              ? "border-[#3ecf5a] bg-[#001a20]"
              : "border-[#002070] bg-[#001060]"
          }`}
        >
          <div
            className={`mb-1 font-[family-name:var(--font-pixel)] text-[9px] ${
              passedPending ? "text-[#3ecf5a]" : "text-[#f0d25a]"
            }`}
          >
            {passedPending ? "◆ 通った — フィードバック" : "◆ フィードバック"}
          </div>
          <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-[#f7f3d9]">
            {feedback}
          </p>
          {passedPending ? (
            <button
              type="button"
              className="dq-btn mt-3"
              onClick={() =>
                advance({ aspect: current.aspect, paraphrase: text.trim() })
              }
            >
              {index + 1 >= total ? "FBを読んだ → 本回答へ" : "FBを読んだ → 次の観点へ"}
            </button>
          ) : null}
        </div>
      ) : null}

      {showAnswer ? (
        <div className="mt-3 border-[3px] border-[#002070] bg-[#001060] p-2.5">
          <div className="mb-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#3ecf5a]">
            ◆ こう言えるとよい
          </div>
          <p className="m-0 text-[13px] leading-relaxed text-[#f7f3d9]">
            {current.modelAnswer}
          </p>
          {(allowSelf || showAnswer) && (
            <div className="mt-2 grid gap-2">
              <label className="text-[12px] text-[#c9c3a0]">
                さっき書けていなかったこと（1行）
                <input
                  className="mt-1 w-full border-[3px] border-white bg-[#000c4a] px-2 py-1.5 font-[family-name:var(--font-jp)] text-[14px] text-[#f7f3d9]"
                  value={gapNote}
                  onChange={(e) => setGapNote(e.target.value)}
                  placeholder="例: 全repo一律0%→共通の先頭が壊れている、が抜けてた"
                />
              </label>
              <button type="button" className="dq-btn" onClick={selfAdvance}>
                差分を書いて次の観点へ
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** デブリーフを畳んだあと、2文で思い出してから本回答へ */
export function AtlasRecallDrill({
  seedHint,
  onReady,
  onSkip,
}: {
  /** ミニで通した下書きがあるとき案内 */
  seedHint?: string | null;
  onReady: (recall: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mt-3 border-[3px] border-[#3ecf5a] bg-[#000c4a] p-3">
      <div className="mb-2 font-[family-name:var(--font-pixel)] text-[10px] text-[#3ecf5a]">
        ◆ 閉じて思い出す
      </div>
      <p className="m-0 mb-2 text-[13px] leading-relaxed text-[#c9c3a0]">
        デブリーフは畳んだ。正しい仕組みを、見ずに2文だけ書け。ミニで通した文は本回答下書きに残してあるぞ。
      </p>
      {seedHint ? (
        <p className="mb-2 text-[11px] leading-relaxed text-[#c9c3a0]">
          （下書きに {seedHint.length} 文字ぶんの種あり）
        </p>
      ) : null}
      <textarea
        className="min-h-[64px] w-full resize-y border-[3px] border-white bg-[#000c4a] p-2.5 font-[family-name:var(--font-jp)] text-[15px] text-[#f7f3d9]"
        placeholder="正しい仕組みを2文で…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="dq-btn"
          disabled={text.trim().length < 16}
          onClick={() => onReady(text.trim())}
        >
          思い出した → 本回答へ
        </button>
        <button type="button" className="dq-btn dq-btn-ghost" onClick={onSkip}>
          スキップして本回答へ
        </button>
      </div>
    </div>
  );
}
