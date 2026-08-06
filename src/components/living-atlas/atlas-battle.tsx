"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_ENEMY, paintEnemyFrame } from "./atlas-enemies";
import {
  rootCauseLabel,
  type GateDebrief,
} from "@/lib/grade-payload";
import { rootCauseNextSteps } from "@/lib/root-cause-next";
import type { MicroCheckResult } from "@/lib/micro-check";
import Link from "next/link";
import {
  buildAnswerSeedFromMicro,
  clearMicroProgress,
  loadMicroProgress,
} from "@/lib/micro-progress";
import { AtlasMicroDrill, AtlasRecallDrill } from "./atlas-micro-drill";

export type BattleVerdict = "pass" | "retry" | "pending" | "empty" | "busy";

export type PollResult = {
  verdict: BattleVerdict;
  debrief?: GateDebrief | null;
};

export type BattleResource = {
  kind: string;
  label: string;
  href?: string | null;
};

export type AtlasBattleProps = {
  question: string;
  gateId: string;
  domain?: string | null;
  /** このコミット／状況の 2–3 行要約 (ADR-0011) */
  contextSummary?: string | null;
  resources?: BattleResource[];
  tags?: string[];
  /** Override display name; sprite stays the single default enemy for now */
  enemyName?: string;
  initialHp?: number;
  /** 再訪時: すでに採点済みなら結果＋デブリーフを初期表示 */
  initialVerdict?: Extract<BattleVerdict, "pass" | "retry"> | null;
  initialDebrief?: GateDebrief | null;
  onFlee?: () => void;
  onGoGates?: () => void;
  onCastSpell?: (
    answer: string,
    mode: "submit" | "resubmit",
  ) => Promise<BattleVerdict> | BattleVerdict;
  onPollVerdict?: () => Promise<PollResult | BattleVerdict>;
  onCheckMicro?: (input: {
    aspect: string;
    paraphrase: string;
  }) => Promise<MicroCheckResult>;
  hintText?: string;
  zukanHref?: string;
  /** 根因「学びを拾う／ずかん」の深リンク */
  relatedEntryId?: string | null;
  relatedInboxId?: string | null;
  relatedMisconceptionId?: string | null;
  onGoZukan?: () => void;
};

type Phase =
  | "idle"
  | "answer"
  | "casting"
  | "waiting"
  | "result"
  | "micro"
  | "recall";

function normalizePoll(raw: PollResult | BattleVerdict): PollResult {
  if (typeof raw === "string") return { verdict: raw, debrief: null };
  return raw;
}

function DebriefPanel({
  verdict,
  debrief,
  relatedEntryId = null,
  relatedInboxId = null,
  relatedMisconceptionId = null,
}: {
  verdict: Extract<BattleVerdict, "pass" | "retry">;
  debrief: GateDebrief | null;
  relatedEntryId?: string | null;
  relatedInboxId?: string | null;
  relatedMisconceptionId?: string | null;
}) {
  if (verdict === "pass") {
    const leftover = debrief?.weakAspects ?? [];
    return (
      <div className="mt-3 grid gap-2.5">
        {debrief?.feedback ? (
          <div className="border-[3px] border-[#3ecf5a] bg-[#000c4a] p-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[10px] text-[#3ecf5a]">
              ◆ CLEAR メモ
            </div>
            <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">
              {debrief.feedback}
            </p>
          </div>
        ) : null}
        {leftover.length > 0 ? (
          <div className="border-[3px] border-[#f0d25a] bg-[#000c4a] p-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
              ◆ あとひと押し（CLEARでも薄い論点）
            </div>
            <p className="m-0 mb-2 text-[12px] leading-relaxed text-[#c9c3a0]">
              合格じゃが、ここはまだ部分点。次の復習・ずかんの種にするのじゃ。
            </p>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {leftover.map((a) => (
                <li
                  key={a.aspect}
                  className="border-l-[3px] border-[#f0d25a] pl-2 text-[13px] leading-snug text-[#f7f3d9]"
                >
                  {a.modelAnswer}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const cause = rootCauseLabel(debrief?.rootCause ?? null);
  const next = rootCauseNextSteps(debrief?.rootCause ?? null, {
    entryId: relatedEntryId,
    inboxId: relatedInboxId,
    misconceptionId: relatedMisconceptionId,
  });
  const hasBody =
    debrief?.gap ||
    debrief?.correctModel ||
    debrief?.misconception ||
    (debrief?.weakAspects?.length ?? 0) > 0;

  return (
    <div className="mt-3 grid gap-2.5">
      <div className="border-[3px] border-[#f0d25a] bg-[#000c4a] p-3">
        <div className="mb-2 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          ◆ まなびのデブリーフ
          {cause ? (
            <span className="ml-2 text-[#c9c3a0]">系統: {cause}</span>
          ) : null}
        </div>
        {!hasBody ? (
          <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
            ずれの記録はあるが、正しい仕組みの説明がまだ薄いぞ。再採点するとデブリーフが厚くなる。
          </p>
        ) : null}

        {debrief?.gap ? (
          <section className="mb-2.5">
            <h3 className="m-0 mb-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#e84848]">
              ① どこがずれたか
            </h3>
            <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">
              {debrief.gap}
            </p>
          </section>
        ) : null}

        {debrief?.correctModel ? (
          <section className="mb-2.5">
            <h3 className="m-0 mb-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#3ecf5a]">
              ② 実際の仕組みはこう
            </h3>
            <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">
              {debrief.correctModel}
            </p>
          </section>
        ) : null}

        {debrief?.misconception ? (
          <section className="mb-2.5">
            <h3 className="m-0 mb-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#c9c3a0]">
              誤解として記録
            </h3>
            <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
              {debrief.misconception}
            </p>
          </section>
        ) : null}

        {debrief?.weakAspects && debrief.weakAspects.length > 0 ? (
          <section>
            <h3 className="m-0 mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
              ③ つぎに押さえる観点
            </h3>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {debrief.weakAspects.map((a) => (
                <li
                  key={a.aspect}
                  className="border-l-[3px] border-[#f0d25a] pl-2 text-[13px] leading-snug"
                >
                  <span className="text-[#f7f3d9]">{a.modelAnswer}</span>
                  <span className="ml-2 text-[#c9c3a0]">
                    ({a.score === 0 ? "欠落" : "部分的"})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {next ? (
          <section className="mt-3 border-t-2 border-[#002070] pt-2.5">
            <h3 className="m-0 mb-1 font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
              ④ 根因に応じた次の一手（{next.label}）
            </h3>
            <p className="m-0 mb-2 text-[13px] leading-relaxed text-[#c9c3a0]">
              {next.focus}
            </p>
            <div className="flex flex-wrap gap-2">
              {next.actions.map((a) => (
                <Link key={a.href} href={a.href} className="dq-btn !px-3 !py-2 text-[8px]">
                  {a.label}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 理解度ゲート = DQバトル画面
 * 左＝敵／右＝出題（敵セリフ）。下部ログはナレーター／操作案内／デブリーフ。
 */
export function AtlasBattle({
  question,
  gateId,
  contextSummary = null,
  resources = [],
  enemyName,
  initialHp = 72,
  initialVerdict = null,
  initialDebrief = null,
  onFlee,
  onGoGates,
  onCastSpell,
  onPollVerdict,
  onCheckMicro,
  hintText = "関連エントリやどうぐの処方を確認できるぞ。",
  zukanHref = "/zukan",
  relatedEntryId = null,
  relatedInboxId = null,
  relatedMisconceptionId = null,
  onGoZukan,
}: AtlasBattleProps) {
  const def = DEFAULT_ENEMY;
  const displayName = enemyName ?? def.name;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hp, setHp] = useState(initialVerdict === "pass" ? 0 : initialHp);
  const [phase, setPhase] = useState<Phase>(initialVerdict ? "result" : "idle");
  const [cmd, setCmd] = useState<"answer" | "hint" | "zukan" | "run">("answer");
  const [narrator, setNarrator] = useState(() => {
    if (initialVerdict === "pass") {
      return "CLEAR！　つまずきはしずまった。ちずがあかるくなり、ずかんへ記録されるぞ。";
    }
    if (initialVerdict === "retry") {
      return "しかし！　まだあかりが足りぬ。デブリーフを読んだら、いきなり全文ではなく『まず1観点を言い直す』のじゃ。";
    }
    return "まものが口をひらいた！　右のセリフの問いにこたえよ。対話で練るなら下のじゅもん、すぐ書くなら『こたえる』（どちらも同じ受理の道じゃ）。";
  });
  const [answer, setAnswer] = useState("");
  const [anim, setAnim] = useState<"appear" | "idle" | "hit" | "defeat">(
    initialVerdict === "pass" ? "defeat" : "appear",
  );
  const [verdict, setVerdict] = useState<BattleVerdict | null>(initialVerdict);
  const [canResubmit, setCanResubmit] = useState(initialVerdict === "retry");
  const [debrief, setDebrief] = useState<GateDebrief | null>(initialDebrief);
  const [microDone, setMicroDone] = useState(() => {
    if (initialVerdict !== "retry") return false;
    return !!loadMicroProgress(gateId)?.microDone;
  });
  const [microSeed, setMicroSeed] = useState(() => {
    const p = loadMicroProgress(gateId);
    return p ? buildAnswerSeedFromMicro(p.cleared) : "";
  });

  const hasMicro =
    !!debrief?.weakAspects &&
    debrief.weakAspects.length > 0 &&
    !!onCheckMicro;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    paintEnemyFrame(ctx, def, 0, 2);
    const t = window.setInterval(() => {
      frame = 1 - frame;
      paintEnemyFrame(ctx, def, frame, 2);
    }, 420);
    const appear = window.setTimeout(() => {
      setAnim((a) => (a === "appear" ? "idle" : a));
    }, 600);
    return () => {
      clearInterval(t);
      clearTimeout(appear);
    };
  }, [def, gateId]);

  // 採点待ち中は結果をポーリング
  useEffect(() => {
    if (phase !== "waiting" || !onPollVerdict) return;
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const raw = await onPollVerdict();
        if (cancelled) return;
        const { verdict: v, debrief: d } = normalizePoll(raw);
        if (v === "pass" || v === "retry") {
          applyVerdict(v, d ?? null);
          return;
        }
      } catch {
        /* keep waiting */
      }
      if (tries >= 40) {
        if (!cancelled) {
          setNarrator(
            "採点がまだ戻ってこないぞ。しれん一覧で状態を見るか、しばらくして『結果を確認』を押すのじゃ。",
          );
        }
        return;
      }
      window.setTimeout(() => void tick(), 3000);
    };
    const id = window.setTimeout(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [phase, onPollVerdict, gateId]);

  function applyVerdict(
    v: Extract<BattleVerdict, "pass" | "retry">,
    d: GateDebrief | null,
  ) {
    setVerdict(v);
    setDebrief(d);
    setPhase("result");
    setAnim(v === "pass" ? "defeat" : "idle");
    setCanResubmit(v === "retry");
    if (v === "pass") {
      setHp(0);
      clearMicroProgress(gateId);
      setMicroDone(false);
      setMicroSeed("");
    } else {
      const saved = loadMicroProgress(gateId);
      setMicroDone(!!saved?.microDone);
      setMicroSeed(saved ? buildAnswerSeedFromMicro(saved.cleared) : "");
    }
    const weakCount = d?.weakAspects?.length ?? 0;
    const leftoverOnPass = v === "pass" ? (d?.weakAspects?.length ?? 0) : 0;
    setNarrator(
      v === "pass"
        ? leftoverOnPass > 0
          ? "CLEAR！　ただし薄い論点が残っておる。『あとひと押し』を見て種を拾え。"
          : "CLEAR！　つまずきはしずまった。ちずがあかるくなり、ずかんへ記録されるぞ。"
        : weakCount > 0
          ? "しかし！　まだあかりが足りぬ。デブリーフを読んだら『まず1観点を言い直す』で筋肉をつけよ。いきなり全文はきついぞ。"
          : "しかし！　まだあかりが足りぬ。下のデブリーフを読んでから答え直せ。",
    );
  }

  function startMicro() {
    if (!hasMicro) {
      setPhase("recall");
      setNarrator("デブリーフを畳む。正しい仕組みを2文で思い出してみよ。");
      return;
    }
    setPhase("micro");
    setNarrator(
      "ミニチェックじゃ。正しい仕組みは隠す。弱い観点を1つずつ、自分の言葉で言い直せ。通した文は本回答の下書きに残るぞ。",
    );
  }

  function goToAnswer(extra?: string, seedOverride?: string) {
    setCanResubmit(true);
    const base = (seedOverride ?? microSeed).trim();
    const merged = [base, extra?.trim()]
      .filter(Boolean)
      .join("\n\n");
    if (merged) setAnswer(merged);
    setPhase("answer");
    setNarrator(
      merged
        ? "ミニ／思い出しの種が下書きに入った。足りない論点を足して、本回答を整えよ。"
        : "準備できたぞ。右の問いに、自分の言葉で本回答を書け。",
    );
  }

  async function cast() {
    if (!answer.trim()) {
      setPhase("answer");
      setNarrator("じゅもんにはことばが要るぞ。右の問いに、自分の言葉でこたえよ。");
      return;
    }

    setPhase("casting");
    setNarrator("答えを受け付けた！　裁きは別の座で進む——しばらく待て。");
    setAnim("hit");
    setCanResubmit(false);
    setDebrief(null);
    clearMicroProgress(gateId);
    setMicroDone(false);
    setMicroSeed("");

    let result: BattleVerdict = "pending";
    try {
      result =
        (await onCastSpell?.(answer, canResubmit ? "resubmit" : "submit")) ??
        "pending";
    } catch {
      result = "pending";
    }

    if (result === "empty") {
      setPhase("answer");
      setAnim("idle");
      setNarrator("じゅもんにはことばが要るぞ。右の問いに、自分の言葉でこたえよ。");
      return;
    }

    let next = hp;
    await new Promise<void>((resolve) => {
      const tick = window.setInterval(() => {
        next = Math.max(28, next - 8);
        setHp(next);
        if (next <= 28) {
          clearInterval(tick);
          resolve();
        }
      }, 180);
    });

    setVerdict(result);
    if (result === "pass" || result === "retry") {
      // 同期で合否が返るケースは稀。デブリーフは poll 相当で取り直す
      if (onPollVerdict) {
        try {
          const polled = normalizePoll(await onPollVerdict());
          applyVerdict(result, polled.debrief ?? null);
          return;
        } catch {
          /* fall through */
        }
      }
      applyVerdict(result, null);
      return;
    }

    setAnim("idle");
    setPhase("waiting");
    setNarrator(
      "回答は受け付けた！　いま採点の旅の途中じゃ。この画面で結果が戻るのを待て。急ぎならしれん一覧でも確認できるぞ。",
    );
  }

  const animClass =
    anim === "appear"
      ? "dq-enemy-appear"
      : anim === "hit"
        ? "dq-enemy-hit"
        : anim === "defeat"
          ? "dq-enemy-defeat"
          : "dq-enemy-idle";

  const commandsLocked = phase === "casting";

  return (
    <div className="mx-auto grid max-w-[1180px] gap-2.5 px-3.5 py-3.5">
      <div className="flex items-center justify-between gap-2.5">
        <div className="font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a]">
          ◆ しれん／理解度ゲート
        </div>
        <button type="button" className="dq-btn dq-btn-ghost" onClick={onFlee}>
          にげる（ちずへ）
        </button>
      </div>

      <section className="overflow-hidden border-4 border-black shadow-[6px_6px_0_#000]">
        <div className="relative grid min-h-[280px] grid-cols-1 items-center gap-4 bg-[linear-gradient(#2a4a7a_0%,#1a3a18_48%,#0c220c_100%)] px-4 py-5 shadow-[inset_0_0_0_3px_#3d6b3a] md:min-h-[44vh] md:grid-cols-[minmax(200px,0.9fr)_1.4fr] md:gap-6 md:px-6">
          <div className="z-[1] flex flex-col items-center justify-center gap-2">
            <div className="border-[3px] border-white bg-[#001a8c] px-3 py-2 font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a] shadow-[4px_4px_0_#000]">
              {displayName}
            </div>
            <canvas
              ref={canvasRef}
              width={64}
              height={64}
              className={`h-36 w-36 drop-shadow-[6px_6px_0_#000] md:h-44 md:w-44 ${animClass}`}
              style={{ imageRendering: "pixelated" }}
              aria-hidden
            />
            <div className="h-3.5 w-22 rounded-[50%] bg-black/35" aria-hidden />
            <div className="w-[min(280px,92%)] border-[3px] border-white bg-[#001a8c] px-2.5 py-2 shadow-[3px_3px_0_#000]">
              <div className="mb-1.5 flex justify-between font-[family-name:var(--font-pixel)] text-[11px]">
                <span>GATE HP</span>
                <span>
                  {hp} / 100
                </span>
              </div>
              <div className="h-3.5 border-2 border-[#223] bg-black">
                <i
                  className="block h-full bg-gradient-to-r from-[#e84848] to-[#f0d25a]"
                  style={{ width: `${hp}%` }}
                />
              </div>
            </div>
          </div>

          <div
            className="relative z-[2] w-full border-4 border-white bg-[#001a8c] px-4 py-4 shadow-[5px_5px_0_#000] md:min-h-[220px]"
            role="dialog"
            aria-label="つまずきのセリフ（問い）"
          >
            <div className="mb-2.5 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
              ◆ つまずき「{displayName.replace(/^つまずき：/, "")}」のセリフ
            </div>
            <p className="m-0 text-[18px] leading-relaxed text-[#f7f3d9] md:text-[20px]">
              「{question}」
            </p>
            {contextSummary ? (
              <div className="mt-3 border-l-[3px] border-[#9ec0ff] pl-2.5">
                <div className="mb-1 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
                  ◆ 当時の状況
                </div>
                <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[#c9c3a0]">
                  {contextSummary}
                </p>
              </div>
            ) : null}
            {resources.length > 0 ? (
              <ul className="mt-2 mb-0 list-none space-y-1 p-0">
                {resources.map((r) => (
                  <li key={`${r.kind}:${r.label}`} className="text-[12px] text-[#9ec0ff]">
                    {r.href ? (
                      <a href={r.href} className="text-[#9ec0ff] no-underline hover:underline">
                        [{r.kind}] {r.label}
                      </a>
                    ) : (
                      <span>
                        [{r.kind}] {r.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
              ……と、まものが言い放った。この問いにこたえて、あかりをともせ！
            </p>
            <span
              className="absolute top-1/2 right-full hidden h-0 w-0 -translate-y-1/2 border-y-8 border-r-[12px] border-y-transparent border-r-white md:block"
              aria-hidden
            />
            <span
              className="absolute bottom-full left-1/2 -ml-2 h-0 w-0 border-x-8 border-b-[12px] border-x-transparent border-b-white md:hidden"
              aria-hidden
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-t-4 border-black bg-[#000c4a] p-2.5 md:grid-cols-[0.85fr_1.15fr]">
          <div className="dq-win p-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a]">
              あなた
            </div>
            <div className="flex justify-between text-[14px]">
              <span>理解ゲージ</span>
              <span>85%</span>
            </div>
            <div className="mt-1 h-2.5 border-2 border-[#223] bg-black">
              <i className="block h-full w-[85%] bg-[#3ecf5a]" />
            </div>
            <div className="mt-2 flex justify-between text-[14px]">
              <span>状態</span>
              <span className="truncate pl-2 text-[#c9c3a0]">
                {phase === "waiting"
                  ? "採点中…"
                  : verdict === "pass"
                    ? "CLEAR"
                    : verdict === "retry"
                      ? "もういちど"
                      : "たたかい中"}
              </span>
            </div>
          </div>

          <div className="dq-win grid grid-cols-2 gap-2 p-3">
            {(
              [
                ["answer", "こたえる", "直接書いて提出（MCPと同じ受理）"],
                ["hint", "ヒント", "関連エントリ／処方を見る"],
                ["zukan", "ずかん", "同系統のつまずきを開く"],
                ["run", "にげる", "ちずにもどる（進捗はそのまま）"],
              ] as const
            ).map(([k, label, sub]) => (
              <button
                key={k}
                type="button"
                disabled={commandsLocked}
                className={`border-[3px] border-white bg-[#000c4a] p-3 text-left font-[family-name:var(--font-pixel)] text-[12px] text-[#f7f3d9] disabled:opacity-50 ${
                  cmd === k ? "text-[#f0d25a] outline outline-2 outline-[#f0d25a]" : ""
                }`}
                onClick={() => {
                  setCmd(k);
                  if (k === "run") {
                    setNarrator("にげた！　ゲートの進捗はそのまま。");
                    setTimeout(() => onFlee?.(), 500);
                    return;
                  }
                  if (k === "answer") {
                    if (phase === "waiting") {
                      setNarrator(
                        "いま採点の旅の途中じゃ。結果が戻るまで待つんじゃ。下の『結果を確認』もしれん一覧も使えるぞ。",
                      );
                      return;
                    }
                    if (verdict === "pass") {
                      setNarrator("このしれんは CLEAR 済みじゃ。ちずかずかんへ進むのじゃ。");
                      return;
                    }
                    if (verdict === "retry" && hasMicro && !microDone) {
                      startMicro();
                      return;
                    }
                    goToAnswer();
                    return;
                  }
                  if (k === "hint") {
                    if (phase !== "waiting" && phase !== "micro" && phase !== "recall") {
                      setPhase(verdict ? "result" : "idle");
                    }
                    setNarrator(`ヒント：${hintText}`);
                    return;
                  }
                  if (k === "zukan") {
                    setNarrator(
                      relatedMisconceptionId
                        ? "関連のずかん詳細へ飛ぶぞ…"
                        : `ずかん（${zukanHref}）で同タグのつまずきを見られるぞ。`,
                    );
                    setTimeout(() => {
                      if (onGoZukan) onGoZukan();
                      else if (typeof window !== "undefined") {
                        window.location.href = zukanHref;
                      }
                    }, 280);
                    return;
                  }
                  if (phase !== "waiting" && phase !== "micro" && phase !== "recall") {
                    setPhase(verdict ? "result" : "idle");
                  }
                }}
              >
                {label}
                <span className="mt-1.5 block font-[family-name:var(--font-jp)] text-[13px] font-normal leading-snug text-[#c9c3a0]">
                  {sub}
                </span>
              </button>
            ))}
          </div>

          <div className="dq-win min-h-24 p-3 md:col-span-2">
            <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
              ◆ ナレーター
            </div>
            <p className="m-0 text-[16px] leading-relaxed">{narrator}</p>

            {phase === "result" && (verdict === "pass" || verdict === "retry") ? (
              <DebriefPanel
                verdict={verdict}
                debrief={debrief}
                relatedEntryId={relatedEntryId}
                relatedInboxId={relatedInboxId}
                relatedMisconceptionId={relatedMisconceptionId}
              />
            ) : null}

            {phase === "micro" && debrief && onCheckMicro ? (
              <AtlasMicroDrill
                gateId={gateId}
                debrief={debrief}
                onCheck={onCheckMicro}
                onComplete={(seedDraft) => {
                  setMicroDone(true);
                  setMicroSeed(seedDraft);
                  setPhase("recall");
                  setNarrator(
                    "観点は通した！　通した文は下書きに残した。次は畳んで2文思い出してみよ。",
                  );
                }}
                onSkipToAnswer={(seedDraft) => {
                  setMicroDone(true);
                  setMicroSeed(seedDraft);
                  goToAnswer(undefined, seedDraft);
                }}
              />
            ) : null}

            {phase === "recall" ? (
              <AtlasRecallDrill
                seedHint={microSeed || null}
                onReady={(recall) => goToAnswer(recall)}
                onSkip={() => goToAnswer()}
              />
            ) : null}

            {phase === "waiting" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="dq-btn"
                  onClick={() => {
                    void (async () => {
                      setNarrator("結果を覗きにいったぞ…");
                      const raw = (await onPollVerdict?.()) ?? "pending";
                      const { verdict: v, debrief: d } = normalizePoll(raw);
                      if (v === "pass" || v === "retry") {
                        applyVerdict(v, d ?? null);
                      } else {
                        setNarrator(
                          "まだ採点の旅の途中じゃ。そのまま待つか、しれん一覧で状態を見るのじゃ。",
                        );
                      }
                    })();
                  }}
                >
                  結果を確認
                </button>
                <button type="button" className="dq-btn dq-btn-ghost" onClick={onGoGates}>
                  しれん一覧へ
                </button>
                <button type="button" className="dq-btn dq-btn-ghost" onClick={onFlee}>
                  ちずへ
                </button>
              </div>
            ) : null}

            {phase === "result" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {verdict === "retry" && hasMicro && !microDone ? (
                  <button type="button" className="dq-btn" onClick={startMicro}>
                    まず1観点を言い直す
                  </button>
                ) : null}
                {verdict === "retry" && (!hasMicro || microDone) ? (
                  <button
                    type="button"
                    className="dq-btn"
                    onClick={() => {
                      setPhase("recall");
                      setNarrator(
                        "デブリーフを畳む。正しい仕組みを2文で思い出してから本回答へ。",
                      );
                    }}
                  >
                    閉じて思い出す
                  </button>
                ) : null}
                {verdict === "retry" && microDone ? (
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost"
                    onClick={() => goToAnswer()}
                  >
                    本回答へ（下書きあり）
                  </button>
                ) : null}
                {verdict === "retry" && !hasMicro ? (
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost"
                    onClick={() => goToAnswer()}
                  >
                    本回答へ
                  </button>
                ) : null}
                {verdict === "pass" ? (
                  <button type="button" className="dq-btn" onClick={onFlee}>
                    ちずへもどる
                  </button>
                ) : null}
                <button type="button" className="dq-btn dq-btn-ghost" onClick={onGoGates}>
                  しれん一覧へ
                </button>
              </div>
            ) : null}

            {phase === "micro" || phase === "recall" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="dq-btn dq-btn-ghost"
                  onClick={() => {
                    setPhase("result");
                    setNarrator("デブリーフにもどった。準備ができたらミニチェックを再開せよ。");
                  }}
                >
                  デブリーフにもどる
                </button>
              </div>
            ) : null}

            {phase === "answer" ? (
              <div className="mt-2.5 grid gap-2">
                <p className="m-0 text-[13px] text-[#c9c3a0]">
                  こたえ先：右の「{question.slice(0, 40)}
                  {question.length > 40 ? "…" : ""}」
                  {microSeed
                    ? " ／ ミニで通した文が下書きに入っておる"
                    : ""}
                </p>
                <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
                  つまり 下に書いた文を提出する。受理・採点は MCP answer_gate
                  と同じ経路。対話で練るならページ下の『じゅもんをとなえる』。
                </p>
                <textarea
                  className="min-h-[96px] w-full resize-y border-[3px] border-white bg-[#000c4a] p-2.5 font-[family-name:var(--font-jp)] text-[15px] text-[#f7f3d9]"
                  placeholder="まものの問いに対する答えを、自分の言葉で書く…"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="dq-btn" onClick={() => void cast()}>
                    提出する
                  </button>
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost"
                    onClick={() => {
                      setPhase(verdict === "retry" ? "result" : "idle");
                      setNarrator("提出をやめた。コマンドを選びなおすのじゃ。");
                    }}
                  >
                    やめる
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
