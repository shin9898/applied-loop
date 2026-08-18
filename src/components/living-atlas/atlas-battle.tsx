"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_ENEMY,
  paintEnemyFrame,
  type EnemyDef,
} from "./atlas-enemies";
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
import { AtlasSpellWait } from "./atlas-spell-wait";
import { AtlasWaitCompanion } from "./atlas-wait-companion";
import { formatRubricHint } from "@/lib/gate-hint";
import type { GateTaskLink } from "@/lib/task-map";

export type BattleVerdict =
  | "pass"
  | "retry"
  | "pending"
  | "empty"
  | "busy"
  | "grading_failed";

export type PollResult = {
  verdict: BattleVerdict;
  debrief?: GateDebrief | null;
  nextReviewLabel?: string | null;
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
  /** 系統別スプライト。未指定なら DEFAULT_ENEMY */
  enemy?: EnemyDef;
  /** Override display name only */
  enemyName?: string;
  initialHp?: number;
  /** 再訪時: すでに採点済みなら結果＋デブリーフを初期表示 */
  initialVerdict?: Extract<
    BattleVerdict,
    "pass" | "retry" | "grading_failed"
  > | null;
  initialDebrief?: GateDebrief | null;
  onFlee?: () => void;
  onGoGates?: () => void;
  /** 受理成功後に呼ぶ（チュートリアルの /setup 復帰など） */
  onAccepted?: () => void;
  /** true なら受理直後に onAccepted を自動実行。サンプルは false で miss デブリーフを見せる */
  autoLeaveOnAccept?: boolean;
  /** 受理後に出す導線ラベル（例: じゅんびにもどる） */
  afterAcceptLabel?: string;
  /** 悪問として閉じる（pending のみ） */
  onDismissBadQuestion?: () => Promise<"ok" | "busy">;
  /** あとまわし（parked。pending のみ） */
  onPark?: () => Promise<"ok" | "busy">;
  onCastSpell?: (
    answer: string,
    mode: "submit" | "resubmit",
  ) => Promise<BattleVerdict> | BattleVerdict;
  onPollVerdict?: () => Promise<PollResult | BattleVerdict>;
  /** 採点失敗（保留）からの再採点 */
  onRetryGrading?: () => Promise<"pending" | "busy">;
  onCheckMicro?: (input: {
    aspect: string;
    paraphrase: string;
  }) => Promise<MicroCheckResult>;
  /** 採点観点（ヒント表示用。答えは含めない） */
  rubricCriteria?: string[];
  /** @deprecated rubricCriteria があればそちらを優先 */
  hintText?: string;
  zukanHref?: string;
  /** 根因「学びを拾う／ずかん」の深リンク */
  relatedEntryId?: string | null;
  relatedInboxId?: string | null;
  relatedMisconceptionId?: string | null;
  /** B5-5: CLEAR 時の再出題予告ラベル */
  initialNextReviewLabel?: string | null;
  onGoZukan?: () => void;
  /**
   * ダンジョン（/gates?d=系統）で連続撃破しているときの「つぎのまものへ」。
   * バトルの中身は変えず、結果／採点待ちの導線に 1 本足すだけ。
   */
  nextGate?: { href: string; label: string } | null;
  /** この gate に紐づく今日の任務（デブリーフ「きょうの任務との関わり」用） */
  taskLinks?: GateTaskLink[];
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

/**
 * ナレーター文の唯一の発生源 (Issue #3)。
 * トーン方針: 儀式イベント(verdict確定/にげた/受理)は演出1文まで、手順ガイドと
 * エラー・復旧は比喩ゼロで命令/原因+手順のみ、ボタン押下直後の一時フィードバック
 * は最短のまま。「採点の旅」の比喩は初出(cast_accepted)のみに絞る。
 */
export type NarratorEvent =
  | {
      kind: "verdict";
      verdict: Extract<BattleVerdict, "pass" | "retry" | "grading_failed">;
      weakCount: number;
      leftoverOnPass: number;
    }
  | { kind: "poll_timeout" }
  | { kind: "start_recall" }
  | { kind: "start_micro" }
  | { kind: "go_answer"; hasMerged: boolean }
  | { kind: "answer_empty" }
  | { kind: "cast_accepted" }
  | { kind: "accept_and_leave" }
  | { kind: "accept_wait"; hasOnAccepted: boolean }
  | { kind: "flee" }
  | { kind: "waiting_blocked" }
  | { kind: "already_cleared" }
  | { kind: "go_zukan"; hasRelated: boolean; zukanHref: string }
  | { kind: "micro_step_cleared" }
  | { kind: "poll_start" }
  | { kind: "poll_still_waiting" }
  | { kind: "retry_grading_start" }
  | { kind: "retry_grading_failed" }
  | { kind: "retry_grading_started" }
  | { kind: "close_to_recall" }
  | { kind: "park_start" }
  | { kind: "park_done" }
  | { kind: "park_failed" }
  | { kind: "dismiss_start" }
  | { kind: "dismiss_done" }
  | { kind: "dismiss_failed" }
  | { kind: "back_to_debrief" }
  | { kind: "cancel_answer" };

export function narratorFor(event: NarratorEvent): string {
  switch (event.kind) {
    case "verdict":
      if (event.verdict === "pass") {
        return event.leftoverOnPass > 0
          ? "CLEAR！　薄い論点が残っておる。『あとひと押し』を見よ。"
          : "CLEAR！　つまずきはしずまった。";
      }
      if (event.verdict === "grading_failed") {
        return "採点が保留になった（認証切れの可能性）。『再採点する』を押すか、じゅんびで診断せよ。";
      }
      return event.weakCount > 0
        ? "しかし！　まだ足りぬ。デブリーフを読み、『まず1観点を言い直す』のじゃ。"
        : "しかし！　まだ足りぬ。デブリーフを読んでから答え直せ。";
    case "poll_timeout":
      return "採点がまだ戻らぬ。しれん一覧で状態を見るか、少し待って『結果を確認』を押せ。";
    case "start_recall":
      return "正しい仕組みを2文で思い出してみよ。";
    case "start_micro":
      return "弱い観点を1つずつ、自分の言葉で言い直せ。";
    case "go_answer":
      return event.hasMerged
        ? "足りない論点を足して、本回答を整えよ。"
        : "自分の言葉で本回答を書け。";
    case "answer_empty":
      return "こたえが空じゃ。右の問いに、自分の言葉で書け。";
    case "cast_accepted":
      return "答えを受け付けた！　採点を待て。";
    case "accept_and_leave":
      return "回答を受け付けた。じゅんびへ戻る。";
    case "accept_wait":
      return event.hasOnAccepted
        ? "採点を待て。結果を見たら下のボタンでじゅんびに戻れる。"
        : "採点を待て。急ぎならしれん一覧でも確認できる。";
    case "flee":
      return "にげた！　進捗はそのまま。";
    case "waiting_blocked":
      return "まだ採点中じゃ。『結果を確認』かしれん一覧で状態を見よ。";
    case "already_cleared":
      return "このしれんは CLEAR 済みじゃ。";
    case "go_zukan":
      return event.hasRelated
        ? "関連のずかんへ飛ぶぞ…"
        : `ずかん（${event.zukanHref}）で同タグのつまずきを見られるぞ。`;
    case "micro_step_cleared":
      return "観点は通した！　次は畳んで2文思い出してみよ。";
    case "poll_start":
      return "結果を覗きにいったぞ…";
    case "poll_still_waiting":
      return "まだ採点中じゃ。";
    case "retry_grading_start":
      return "再採点を頼んだぞ…";
    case "retry_grading_failed":
      return "再採点を始められなかった。じゅんびで採点 CLI を確認せよ。";
    case "retry_grading_started":
      return "採点を再開した。結果を待て。";
    case "close_to_recall":
      return "正しい仕組みを2文で思い出してから本回答へ。";
    case "park_start":
      return "あとまわしにするぞ…";
    case "park_done":
      return "あとまわしにした。材料はきょうのしょに残る。";
    case "park_failed":
      return "あとまわしにできなかった。状態が変わっておる。";
    case "dismiss_start":
      return "悪問として閉じるぞ…";
    case "dismiss_done":
      return "閉じた。しばらくは出さぬ。しれん一覧へ戻る。";
    case "dismiss_failed":
      return "閉じられなかった。すでに提出済みか、状態が変わっておる。";
    case "back_to_debrief":
      return "デブリーフにもどった。準備ができたらミニチェックを再開せよ。";
    case "cancel_answer":
      return "提出をやめた。コマンドを選びなおせ。";
  }
}

/** ◆ きょうの任務との関わり（デブリーフ末尾。今日の DailyTaskMap にこの gate が紐づいていれば出す） */
function TaskLinkNote({ taskLinks }: { taskLinks: GateTaskLink[] }) {
  return (
    <div className="border-[3px] border-[#9ec0ff] bg-[#000c4a] p-3">
      <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
        ◆ きょうの任務との関わり
      </div>
      {taskLinks.length > 0 ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {taskLinks.map((l, i) => (
            <li
              key={`${l.task.slice(0, 40)}-${i}`}
              className="border-l-[3px] border-[#9ec0ff] pl-2"
            >
              <p className="m-0 text-[13px] leading-snug text-[#f7f3d9]">
                「{l.task}」
              </p>
              <p className="m-0 mt-0.5 text-[11px] text-[#c9c3a0]">
                {l.reason || "このしれんの学びに紐づく任務じゃ。"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
          きょうはまだ任務との紐づけがない。
        </p>
      )}
    </div>
  );
}

function DebriefPanel({
  verdict,
  debrief,
  relatedEntryId = null,
  relatedInboxId = null,
  relatedMisconceptionId = null,
  nextReviewLabel = null,
  taskLinks = [],
}: {
  verdict: Extract<BattleVerdict, "pass" | "retry">;
  debrief: GateDebrief | null;
  relatedEntryId?: string | null;
  relatedInboxId?: string | null;
  relatedMisconceptionId?: string | null;
  /** B5-5: CLEAR 時の再出題予告（YYYY-MM-DD など） */
  nextReviewLabel?: string | null;
  taskLinks?: GateTaskLink[];
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
        <div className="border-[3px] border-[#9ec0ff] bg-[#000c4a] p-3">
          <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
            ◆ 再出題の予告
          </div>
          <p className="m-0 text-[14px] leading-relaxed text-[#f7f3d9]">
            {nextReviewLabel
              ? `つぎのしれん候補日: ${nextReviewLabel}（ずかんの再出題スケジューラ）`
              : "紐づく誤解があれば、数日後に再出題がかかる。ずかんで nextReview を見よ。"}
          </p>
        </div>
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
        <TaskLinkNote taskLinks={taskLinks} />
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
      <TaskLinkNote taskLinks={taskLinks} />
    </div>
  );
}

/**
 * しれん（理解度チェック）= DQバトル画面
 * 左＝敵／右＝出題（敵セリフ）。下部ログはナレーター／操作案内／デブリーフ。
 */
export function AtlasBattle({
  question,
  gateId,
  contextSummary = null,
  resources = [],
  enemy,
  enemyName,
  initialHp = 72,
  initialVerdict = null,
  initialDebrief = null,
  onFlee,
  onGoGates,
  onAccepted,
  autoLeaveOnAccept = true,
  afterAcceptLabel = "じゅんびにもどる",
  onCastSpell,
  onPollVerdict,
  onRetryGrading,
  onDismissBadQuestion,
  onPark,
  onCheckMicro,
  rubricCriteria = [],
  hintText,
  zukanHref = "/zukan",
  relatedEntryId = null,
  relatedInboxId = null,
  relatedMisconceptionId = null,
  initialNextReviewLabel = null,
  onGoZukan,
  nextGate = null,
  taskLinks = [],
}: AtlasBattleProps) {
  const def = enemy ?? DEFAULT_ENEMY;
  const displayName = enemyName ?? def.name;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hp, setHp] = useState(initialVerdict === "pass" ? 0 : initialHp);
  const [nextReviewLabel, setNextReviewLabel] = useState<string | null>(
    initialNextReviewLabel,
  );
  const [phase, setPhase] = useState<Phase>(
    initialVerdict === "grading_failed"
      ? "result"
      : initialVerdict
        ? "result"
        : "idle",
  );
  // AtlasMicroDrillのconfirmSkip「飛ばして進む」はこのコンポーネントと
  // 同じコミットでunmountされるため起動元ボタンがDOMから消える。フォーカス
  // 復帰先として本回答フォームのtextareaを渡す（opus2周目レビュー指摘、
  // 2026-08-18）
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** ポーリングが40回（約2分）試みても採点が終わらず諦めたかどうか。
   * true の間は "あなた" カードのアニメーション（AtlasSpellWait / AtlasWaitCompanion）を止める。 */
  const [pollExhausted, setPollExhausted] = useState(false);
  const [cmd, setCmd] = useState<"answer" | "hint" | "zukan" | "run">("answer");
  const [narrator, setNarrator] = useState(() => {
    if (
      initialVerdict === "pass" ||
      initialVerdict === "retry" ||
      initialVerdict === "grading_failed"
    ) {
      const weakCount = initialDebrief?.weakAspects?.length ?? 0;
      return narratorFor({
        kind: "verdict",
        verdict: initialVerdict,
        weakCount,
        leftoverOnPass: initialVerdict === "pass" ? weakCount : 0,
      });
    }
    return "まものが口をひらいた！　右のセリフの問いにこたえよ。対話で練るなら下のじゅもん、すぐ書くなら『こたえる』。";
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
        const { verdict: v, debrief: d, nextReviewLabel: nrl } =
          normalizePoll(raw);
        if (nrl) setNextReviewLabel(nrl);
        if (v === "pass" || v === "retry" || v === "grading_failed") {
          applyVerdict(v, d ?? null);
          return;
        }
      } catch {
        /* keep waiting */
      }
      if (tries >= 40) {
        if (!cancelled) {
          setNarrator(narratorFor({ kind: "poll_timeout" }));
          setPollExhausted(true);
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
    v: Extract<BattleVerdict, "pass" | "retry" | "grading_failed">,
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
    } else if (v === "retry") {
      const saved = loadMicroProgress(gateId);
      setMicroDone(!!saved?.microDone);
      setMicroSeed(saved ? buildAnswerSeedFromMicro(saved.cleared) : "");
    }
    const weakCount = d?.weakAspects?.length ?? 0;
    const leftoverOnPass = v === "pass" ? (d?.weakAspects?.length ?? 0) : 0;
    setNarrator(
      narratorFor({ kind: "verdict", verdict: v, weakCount, leftoverOnPass }),
    );
  }

  function startMicro() {
    if (!hasMicro) {
      setPhase("recall");
      setNarrator(narratorFor({ kind: "start_recall" }));
      return;
    }
    setPhase("micro");
    setNarrator(narratorFor({ kind: "start_micro" }));
  }

  function goToAnswer(extra?: string, seedOverride?: string) {
    setCanResubmit(true);
    const base = (seedOverride ?? microSeed).trim();
    const merged = [base, extra?.trim()]
      .filter(Boolean)
      .join("\n\n");
    if (merged) setAnswer(merged);
    setPhase("answer");
    setNarrator(narratorFor({ kind: "go_answer", hasMerged: !!merged }));
  }

  async function cast() {
    if (!answer.trim()) {
      setPhase("answer");
      setNarrator(narratorFor({ kind: "answer_empty" }));
      return;
    }

    setPhase("casting");
    setNarrator(narratorFor({ kind: "cast_accepted" }));
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
      setNarrator(narratorFor({ kind: "answer_empty" }));
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
    if (
      result === "pass" ||
      result === "retry" ||
      result === "grading_failed"
    ) {
      if (onAccepted && autoLeaveOnAccept && result !== "grading_failed") {
        setAnim("idle");
        setPhase("waiting");
        setPollExhausted(false);
        setNarrator(narratorFor({ kind: "accept_and_leave" }));
        window.setTimeout(() => {
          onAccepted();
        }, 1100);
        return;
      }
      // 同期で合否が返るケースは稀。デブリーフは poll 相当で取り直す
      if (onPollVerdict) {
        try {
          const polled = normalizePoll(await onPollVerdict());
          if (polled.nextReviewLabel) {
            setNextReviewLabel(polled.nextReviewLabel);
          }
          if (
            polled.verdict === "pass" ||
            polled.verdict === "retry" ||
            polled.verdict === "grading_failed"
          ) {
            applyVerdict(polled.verdict, polled.debrief ?? null);
            return;
          }
        } catch {
          /* fall through */
        }
      }
      applyVerdict(result, null);
      return;
    }

    setAnim("idle");
    setPhase("waiting");
    setPollExhausted(false);
    if (onAccepted && autoLeaveOnAccept) {
      setNarrator(narratorFor({ kind: "accept_and_leave" }));
      window.setTimeout(() => {
        onAccepted();
      }, 1100);
      return;
    }
    setNarrator(narratorFor({ kind: "accept_wait", hasOnAccepted: !!onAccepted }));
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
          ◆ しれん（理解度チェック）
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
            {contextSummary ? (
              <div className="mb-3 border-l-[3px] border-[#9ec0ff] pl-2.5">
                <div className="mb-1 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
                  ◆ 文脈
                </div>
                <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[#c9c3a0]">
                  {contextSummary}
                </p>
              </div>
            ) : null}
            <div className="mb-1 font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a]">
              ◆ 問い
            </div>
            <p className="m-0 text-[18px] leading-relaxed text-[#f7f3d9] md:text-[20px]">
              「{question}」
            </p>
            {resources.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
                  ◆ 手がかり
                </div>
                <ul className="mt-0 mb-0 list-none space-y-1 p-0">
                  {resources.map((r) => (
                    <li
                      key={`${r.kind}:${r.label}`}
                      className="text-[12px] text-[#9ec0ff]"
                    >
                      {r.href ? (
                        <a
                          href={r.href}
                          className="text-[#9ec0ff] no-underline hover:underline"
                        >
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
              </div>
            ) : null}
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
          {phase === "waiting" ? (
            <div className="flex flex-wrap items-start gap-2">
              <AtlasSpellWait
                variant="panel"
                active={phase === "waiting" && !pollExhausted}
                label="さいばんの じゅもんを かきとめている……"
              />
              <AtlasWaitCompanion active={phase === "waiting" && !pollExhausted} />
            </div>
          ) : (
            <div className="dq-win p-3">
              <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a]">
                あなた
              </div>
              <div className="mt-2 flex justify-between text-[14px]">
                <span>状態</span>
                <span className="truncate pl-2 text-[#c9c3a0]">
                  {verdict === "pass"
                    ? "CLEAR"
                    : verdict === "retry"
                      ? "miss"
                      : verdict === "grading_failed"
                        ? "保留"
                        : "たたかい中"}
                </span>
              </div>
            </div>
          )}

          <div className="dq-win grid grid-cols-2 gap-2 p-3">
            {(
              [
                ["answer", "こたえる", "直接書いて提出"],
                ["hint", "ヒント", "採点観点を見る（答えは出さない）"],
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
                    setNarrator(narratorFor({ kind: "flee" }));
                    setTimeout(() => onFlee?.(), 500);
                    return;
                  }
                  if (k === "answer") {
                    if (phase === "waiting") {
                      setNarrator(narratorFor({ kind: "waiting_blocked" }));
                      return;
                    }
                    if (verdict === "pass") {
                      setNarrator(narratorFor({ kind: "already_cleared" }));
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
                    const body =
                      hintText?.trim() || formatRubricHint(rubricCriteria);
                    setNarrator(`ヒント：\n${body}`);
                    return;
                  }
                  if (k === "zukan") {
                    setNarrator(
                      narratorFor({
                        kind: "go_zukan",
                        hasRelated: !!relatedMisconceptionId,
                        zukanHref,
                      }),
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
            <p className="m-0 whitespace-pre-wrap text-[16px] leading-relaxed">
              {narrator}
            </p>

            {phase === "result" && (verdict === "pass" || verdict === "retry") ? (
              <DebriefPanel
                verdict={verdict}
                debrief={debrief}
                relatedEntryId={relatedEntryId}
                relatedInboxId={relatedInboxId}
                relatedMisconceptionId={relatedMisconceptionId}
                nextReviewLabel={nextReviewLabel}
                taskLinks={taskLinks}
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
                  setNarrator(narratorFor({ kind: "micro_step_cleared" }));
                }}
                onSkipToAnswer={(seedDraft) => {
                  setMicroDone(true);
                  setMicroSeed(seedDraft);
                  goToAnswer(undefined, seedDraft);
                }}
                fallbackFocus={() => answerTextareaRef.current}
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
                {nextGate ? (
                  <Link href={nextGate.href} className="dq-btn dq-btn-ghost">
                    {nextGate.label}
                  </Link>
                ) : null}
                {onAccepted ? (
                  <button type="button" className="dq-btn" onClick={onAccepted}>
                    {afterAcceptLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={onAccepted ? "dq-btn dq-btn-ghost" : "dq-btn"}
                  onClick={() => {
                    void (async () => {
                      setNarrator(narratorFor({ kind: "poll_start" }));
                      const raw = (await onPollVerdict?.()) ?? "pending";
                      const { verdict: v, debrief: d, nextReviewLabel: nrl } =
                        normalizePoll(raw);
                      if (nrl) setNextReviewLabel(nrl);
                      if (
                        v === "pass" ||
                        v === "retry" ||
                        v === "grading_failed"
                      ) {
                        applyVerdict(v, d ?? null);
                      } else {
                        setNarrator(narratorFor({ kind: "poll_still_waiting" }));
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
                {nextGate && verdict === "pass" ? (
                  <Link href={nextGate.href} className="dq-btn">
                    {nextGate.label}
                  </Link>
                ) : null}
                {verdict === "grading_failed" ? (
                  <>
                    <button
                      type="button"
                      className="dq-btn"
                      onClick={() => {
                        void (async () => {
                          setNarrator(narratorFor({ kind: "retry_grading_start" }));
                          setPhase("waiting");
                          setPollExhausted(false);
                          const r = (await onRetryGrading?.()) ?? "busy";
                          if (r !== "pending") {
                            setPhase("result");
                            setNarrator(
                              narratorFor({ kind: "retry_grading_failed" }),
                            );
                          } else {
                            setNarrator(
                              narratorFor({ kind: "retry_grading_started" }),
                            );
                          }
                        })();
                      }}
                    >
                      再採点する
                    </button>
                    <Link href="/setup" className="dq-btn dq-btn-ghost">
                      じゅんびで診断
                    </Link>
                  </>
                ) : null}
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
                      setNarrator(narratorFor({ kind: "close_to_recall" }));
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
                {verdict === "pass" || verdict === "retry" ? (
                  <button
                    type="button"
                    /* 金は画面に 1 つだけ。連続撃破中は「つぎのまものへ」が主役 */
                    className={
                      nextGate && verdict === "pass"
                        ? "dq-btn dq-btn-ghost"
                        : "dq-btn"
                    }
                    onClick={() => {
                      if (onGoZukan) onGoZukan();
                      else if (typeof window !== "undefined") {
                        window.location.href = zukanHref;
                      }
                    }}
                  >
                    ずかんを見る
                  </button>
                ) : null}
                {verdict === "pass" || verdict === "retry" ? (
                  onAccepted ? (
                    <button type="button" className="dq-btn dq-btn-ghost" onClick={onAccepted}>
                      {afterAcceptLabel}
                    </button>
                  ) : (
                    <button type="button" className="dq-btn dq-btn-ghost" onClick={onFlee}>
                      ちずへもどる
                    </button>
                  )
                ) : null}
                {nextGate && verdict !== "pass" ? (
                  <Link href={nextGate.href} className="dq-btn dq-btn-ghost">
                    {nextGate.label}
                  </Link>
                ) : null}
                <button type="button" className="dq-btn dq-btn-ghost" onClick={onGoGates}>
                  しれん一覧へ
                </button>
              </div>
            ) : null}

            {phase === "idle" && (onDismissBadQuestion || onPark) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {onPark ? (
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost"
                    onClick={() => {
                      void (async () => {
                        setNarrator(narratorFor({ kind: "park_start" }));
                        const r = await onPark();
                        if (r === "ok") {
                          setNarrator(narratorFor({ kind: "park_done" }));
                          window.setTimeout(() => onGoGates?.(), 500);
                        } else {
                          setNarrator(narratorFor({ kind: "park_failed" }));
                        }
                      })();
                    }}
                  >
                    あとまわし（今日は扱わない）
                  </button>
                ) : null}
                {onDismissBadQuestion ? (
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost"
                    onClick={() => {
                      void (async () => {
                        setNarrator(narratorFor({ kind: "dismiss_start" }));
                        const r = await onDismissBadQuestion();
                        if (r === "ok") {
                          setNarrator(narratorFor({ kind: "dismiss_done" }));
                          window.setTimeout(() => onGoGates?.(), 500);
                        } else {
                          setNarrator(narratorFor({ kind: "dismiss_failed" }));
                        }
                      })();
                    }}
                  >
                    悪問として閉じる
                  </button>
                ) : null}
              </div>
            ) : null}

            {phase === "micro" || phase === "recall" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="dq-btn dq-btn-ghost"
                  onClick={() => {
                    setPhase("result");
                    setNarrator(narratorFor({ kind: "back_to_debrief" }));
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
                  下に書いた文を、そのまま提出する。対話で練るならページ下の『じゅもんをとなえる』。
                </p>
                <textarea
                  ref={answerTextareaRef}
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
                      setNarrator(narratorFor({ kind: "cancel_answer" }));
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
