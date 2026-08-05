/**
 * Living Atlas dashboard — DQ / ぼうけんのしょ composition
 * ナビはフローティング・コマンドドックへ集約。画面内に重複コマンドは置かない。
 * 右カラムは地図と同じ高さの「ステータス1窓」。
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import {
  adventurerLevelFromResolved,
  formatStars,
  type AdventurerLevel,
  type SystemStar,
} from "@/lib/atlas-level";
import { AtlasShell } from "./atlas-shell";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasWorldMap } from "./atlas-world-map";

export type AtlasDashboardProps = {
  resolvedTotal: number;
  thisWeekDelta: number;
  streakDays?: number;
  adventurer?: AdventurerLevel;
  systemStars?: SystemStar[];
  pendingGate: null | {
    id: string;
    question: string;
    /** 一覧用の短い見出し（全文はバトルへ） */
    title?: string;
    context?: string;
    domain?: string | null;
    system?: string | null;
    tags?: string[];
  };
  todos?: { title: string; meta: string }[];
};

const LOG: Record<string, { who: string; title: string; body: string }> = {
  "quest-1": {
    who: "◆ ゲートの案内",
    title: "未クリアの理解度ゲート",
    body: "『たたかう』でバトル画面へ。じゅもん（回答）は採点パイプラインに送られるぞ。",
  },
  "clear-1": {
    who: "◆ CLEAR（ずかんに記録済み）",
    title: "クリア済みのつまずき",
    body: "ずかんで本文・根拠・再出題を見返せる。同じ系統のゲートのヒントになるぞ。",
  },
  you: {
    who: "◆ いまのばしょ",
    title: "ゲート連峰のふもと",
    body: "未クリアの「！」は未解明帯にある。画面のコマンド窓（黒）でどうぐ・にっきへ移れるぞ。",
  },
};

export function AtlasDashboard({
  resolvedTotal,
  thisWeekDelta,
  streakDays = 0,
  adventurer: adventurerProp,
  systemStars = [],
  pendingGate,
  todos = [
    { title: "① 未クリアゲートを1つ解く", meta: "『たたかう』→ じゅもん（LLM）で回答" },
    { title: "② 受信箱の学びを仕分ける", meta: "にっき → capture 候補を確認" },
    { title: "③ 弱ってる repo の処方を見る", meta: "どうぐ → cache / harness 処方" },
  ],
}: AtlasDashboardProps) {
  const [activeId, setActiveId] = useState(pendingGate ? "quest-1" : "you");
  const adventurer =
    adventurerProp ?? adventurerLevelFromResolved(resolvedTotal);

  const log = LOG[activeId] ?? {
    who: "◆ ゲートの案内",
    title: pendingGate?.title ?? "つぎのしれんはないようじゃ",
    body: pendingGate
      ? "『たたかう』でバトル画面へ。問い全文はそこで読むのじゃ。"
      : "ちずのピンを選ぶか、コマンド窓からにっき・どうぐを開くとよいぞ。",
  };

  const fightHref = pendingGate ? `/gates/${pendingGate.id}` : "/gates";
  const expPct = Math.round(adventurer.expRatio * 100);

  return (
    <AtlasShell>
      {pendingGate ? (
        <AtlasReveal as="section">
          <div className="grid grid-cols-1 items-center gap-3.5 border-4 border-[#f0d25a] bg-[#001a8c] p-4 outline outline-4 outline-[#000c4a] shadow-[6px_6px_0_#000] md:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
                ◆ つぎのしれん
              </div>
              <h1 className="m-0 font-[family-name:var(--font-jp)] text-[18px] font-normal leading-relaxed">
                {pendingGate.title ?? "未クリアの理解度ゲート"}
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-[#c9c3a0]">
                {[pendingGate.context, pendingGate.system]
                  .filter(Boolean)
                  .join(" · ") || "たたかう画面で問い全文を読むのじゃ"}
              </p>
            </div>
            <Link href={fightHref} className="dq-btn">
              たたかう
            </Link>
          </div>
        </AtlasReveal>
      ) : null}

      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
        <AtlasReveal as="section" className="dq-win flex h-full flex-col gap-2.5 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="dq-win-title mb-0">WORLD MAP</h2>
            <div className="text-[13px] text-[#c9c3a0]">
              あかるい領ほど、まち・きがふえるんじゃ
            </div>
          </div>
          <AtlasWorldMap activeId={activeId} onSelect={setActiveId} />
          <div className="flex flex-wrap gap-x-3.5 gap-y-2 text-[12px] text-[#c9c3a0]">
            <span>みどり＝理解がつもった領</span>
            <span>！＝未クリアのゲート</span>
            <span>まち／き＝エントリ密度</span>
            <span>ピンを選ぶと下のログに説明が出るぞ</span>
          </div>
        </AtlasReveal>

        <AtlasReveal
          as="aside"
          delayIndex={1}
          className="dq-win flex h-full min-h-0 flex-col gap-3 p-3.5"
        >
          <div>
            <h2 className="dq-win-title">ぼうけんしゃ</h2>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="m-0 font-[family-name:var(--font-pixel)] text-[18px] text-[#f0d25a]">
                  Lv.{adventurer.level}
                </p>
                <p className="mt-1 mb-0 text-[14px] text-[#f7f3d9]">
                  {adventurer.title}
                </p>
              </div>
              <div className="text-right text-[12px] text-[#c9c3a0]">
                <div>撃破 {resolvedTotal}</div>
                <div className="text-[#f0d25a]">今週 +{thisWeekDelta}</div>
              </div>
            </div>
            <div className="mt-2.5">
              <div className="mb-1 flex justify-between font-[family-name:var(--font-pixel)] text-[9px] text-[#c9c3a0]">
                <span>EXP</span>
                <span>
                  {adventurer.expInLevel} / {adventurer.expToNext}
                </span>
              </div>
              <div className="h-3.5 border-2 border-[#223] bg-black">
                <i
                  className="block h-full bg-gradient-to-r from-[#3ecf5a] to-[#f0d25a]"
                  style={{ width: `${expPct}%` }}
                />
              </div>
            </div>
            {streakDays > 0 ? (
              <p className="mt-2 mb-0 font-[family-name:var(--font-pixel)] text-[11px] text-[#3ecf5a]">
                れんぞく {streakDays}日
              </p>
            ) : (
              <p className="mt-2 mb-0 text-[11px] text-[#c9c3a0]">
                れんぞくはまだこれからじゃ
              </p>
            )}
          </div>

          <div className="border-t-2 border-[#002070] pt-3">
            <h3 className="m-0 mb-2 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
              ◆ ステータス（領）
            </h3>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {(systemStars.length > 0
                ? systemStars
                : [
                    { key: "cache", label: "キャッシュ", stars: 0, count: 0 },
                    { key: "harness", label: "ハーネス", stars: 0, count: 0 },
                    { key: "design", label: "設計判断", stars: 0, count: 0 },
                    { key: "knowledge", label: "知識", stars: 0, count: 0 },
                  ]
              ).map((s) => (
                <li
                  key={s.key}
                  className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[13px]"
                >
                  <span className="text-[#c9c3a0]">{s.label}</span>
                  <span
                    className="font-[family-name:var(--font-pixel)] text-[10px] tracking-tight text-[#f0d25a]"
                    aria-label={`${s.stars}つ星`}
                  >
                    {formatStars(s.stars)}
                  </span>
                  <span className="text-[11px] text-[#c9c3a0]">{s.count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 mb-0 text-[11px] leading-relaxed text-[#c9c3a0]">
              ★はクリア密度の見え方。合否そのものではないぞ。
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t-2 border-[#002070] pt-3">
            <h3 className="m-0 mb-2 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
              ◆ いまのクエスト
            </h3>
            <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
              {todos.map((t, i) => (
                <li
                  key={t.title}
                  className={`py-2 text-[14px] leading-snug ${
                    i ? "border-t-2 border-[#002070]" : "pt-0"
                  }`}
                >
                  {t.title}
                  <span className="mt-0.5 block text-[12px] text-[#c9c3a0]">
                    {t.meta}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-auto mb-0 pt-3 text-[11px] leading-relaxed text-[#c9c3a0]">
              場所を移るときは黒い「コマンド」窓を使うのじゃ（たたむ・ドラッグ可）。
            </p>
          </div>
        </AtlasReveal>
      </div>

      <AtlasReveal
        as="section"
        delayIndex={3}
        className="dq-win grid grid-cols-1 items-center gap-3 p-3.5 md:grid-cols-[1fr_auto]"
      >
        <div>
          <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
            {log.who}
          </div>
          <h2 className="m-0 text-[16px] font-normal leading-relaxed">{log.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#c9c3a0]">{log.body}</p>
        </div>
        {pendingGate ? (
          <Link href={fightHref} className="dq-btn">
            たたかう
          </Link>
        ) : null}
      </AtlasReveal>
    </AtlasShell>
  );
}
