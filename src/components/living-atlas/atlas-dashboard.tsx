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
import { AtlasPageTitle } from "./atlas-page-title";
import { AtlasWorldMap, REGION_LEGEND } from "./atlas-world-map";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasWorldIntroModal } from "./atlas-onboarding";
import type { SetupDiagnosis } from "@/lib/setup-diagnosis";
import { pickTaskMapDisplay } from "@/lib/task-map-display";
import { resolveHomeCta } from "@/lib/home-cta";
import type { TextbookGuidance } from "@/lib/textbook-guidance-shared";

export type TaskMapView = {
  dateKey: string;
  tasks: {
    task: string;
    related: { title: string; href: string; reason?: string }[];
  }[];
};

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
  /** 今日のタスク × 学び (ADR-0013) */
  taskMap?: TaskMapView | null;
  /** 今日が空のときの昨日フォールバック */
  yesterdayTaskMap?: TaskMapView | null;
  /** 弱点観点トップ (ADR-0011) */
  weaknesses?: { aspect: string; missRate: number; sampleCount: number }[] | null;
  /** UI→LLM→MCP。未設定ならじゅもん案内のみ */
  wsToken?: string | null;
  setupDiagnosis?: SetupDiagnosis | null;
  /** ADR-0020 C3-3: 昨日 Mastery / きょうのしょ 導線 */
  textbookGuidance?: TextbookGuidance | null;
};

type StatusTab = "status" | "tasks" | "weak";

/** 右カラム: ステータス / 任務 / 弱点を1窓にタブ集約 */
function StatusCommandPanel({
  adventurer,
  resolvedTotal,
  thisWeekDelta,
  streakDays,
  systemStars,
  todos,
  taskMap,
  yesterdayTaskMap = null,
  weaknesses,
  pendingGate = null,
}: {
  adventurer: AdventurerLevel;
  resolvedTotal: number;
  thisWeekDelta: number;
  streakDays: number;
  systemStars: SystemStar[];
  todos: { title: string; meta: string }[];
  taskMap: AtlasDashboardProps["taskMap"];
  yesterdayTaskMap?: AtlasDashboardProps["yesterdayTaskMap"];
  weaknesses: AtlasDashboardProps["weaknesses"];
  pendingGate?: AtlasDashboardProps["pendingGate"];
}) {
  const { map: activeMap, source: taskSource } = pickTaskMapDisplay(
    taskMap,
    yesterdayTaskMap,
  );
  const showingYesterday = taskSource === "yesterday";
  const taskCount = activeMap?.tasks.length ?? 0;
  const relatedCount =
    activeMap?.tasks.reduce((n, t) => n + t.related.length, 0) ?? 0;
  const weakCount = weaknesses?.length ?? 0;
  const [tab, setTab] = useState<StatusTab>("status");
  const expPct = Math.round(adventurer.expRatio * 100);
  const fightHref = pendingGate ? `/gates/${pendingGate.id}` : "/gates";

  const tabs: { id: StatusTab; label: string; badge?: string }[] = [
    { id: "status", label: "ステータス" },
    {
      id: "tasks",
      label: "任務",
      badge: taskCount > 0 ? String(taskCount) : undefined,
    },
    {
      id: "weak",
      label: "弱点",
      badge: weakCount > 0 ? String(weakCount) : undefined,
    },
  ];

  return (
    <AtlasReveal
      as="aside"
      delayIndex={1}
      className="dq-win flex h-full min-h-0 min-w-0 flex-col gap-2.5 p-3.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="dq-win-title mb-0">ぼうけんしゃ</h2>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          司令塔
        </p>
      </div>

      <div
        className="flex overflow-hidden border-[3px] border-white"
        role="tablist"
        aria-label="ぼうけんしゃパネル"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`min-w-0 flex-1 px-2 py-2.5 font-[family-name:var(--font-pixel)] text-[10px] leading-none ${
                active
                  ? "bg-[#f0d25a] text-[#000c4a]"
                  : "bg-[#000c4a] text-[#c9c3a0]"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className={active ? "text-[#001a8c]" : "text-[#f0d25a]"}>
                  {" "}
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/*
        3タブを同一グリッドセルに重ね、高さは最大（通常はステータス）で固定。
        切り替え時のパネル高さジャンプ／ちらつきを防ぐ。
      */}
      <div className="grid min-h-0 flex-1 overflow-y-auto overflow-x-hidden [grid-template-areas:'stack']">
        <div
          role="tabpanel"
          aria-hidden={tab !== "status"}
          className={`[grid-area:stack] flex flex-col gap-3 ${
            tab === "status" ? "" : "invisible pointer-events-none"
          }`}
        >
            <div>
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
            </div>

            <div className="flex flex-col border-t-2 border-[#002070] pt-3">
              <h3 className="m-0 mb-2 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
                ◆ いまのクエスト
              </h3>
              <ul className="m-0 list-none p-0">
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
              <p className="mb-0 pt-3 text-[11px] leading-relaxed text-[#c9c3a0]">
                任務・弱点は上のタブへ。移動は黒いコマンド窓じゃ。
              </p>
            </div>
        </div>

        <div
          role="tabpanel"
          aria-hidden={tab !== "tasks"}
          className={`[grid-area:stack] ${
            tab === "tasks" ? "" : "invisible pointer-events-none"
          }`}
        >
            <p className="m-0 mb-2 text-[12px] text-[#c9c3a0]">
              {activeMap
                ? `${showingYesterday ? "昨日の控え · " : ""}${activeMap.dateKey} · ${taskCount} 任務 · 学び ${relatedCount}`
                : "きょうのマッピングはまだないぞ"}
            </p>
            {showingYesterday ? (
              <p className="m-0 mb-2 text-[11px] leading-relaxed text-[#f0d25a]">
                今日分は未保存。morning_briefing → save_task_mappings で更新せよ。
              </p>
            ) : null}
            {activeMap && activeMap.tasks.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {activeMap.tasks.map((t, i) => (
                  <li
                    key={`${t.task.slice(0, 40)}-${i}`}
                    className={`min-w-0 py-2 ${
                      i ? "border-t-2 border-[#002070]" : "pt-0"
                    }`}
                  >
                    <p
                      className="m-0 line-clamp-2 break-words text-[13px] leading-snug text-[#f7f3d9]"
                      title={t.task}
                    >
                      {t.task}
                    </p>
                    {t.related.length > 0 ? (
                      <ul className="mt-1 mb-0 list-none space-y-0.5 p-0">
                        {t.related.slice(0, 3).map((r) => (
                          <li key={r.href + r.title} className="min-w-0">
                            <Link
                              href={r.href}
                              title={
                                r.reason ? `${r.title} — ${r.reason}` : r.title
                              }
                              className="block truncate text-[11px] text-[#9ec0ff] no-underline hover:underline"
                            >
                              {r.title}
                            </Link>
                          </li>
                        ))}
                        {t.related.length > 3 ? (
                          <li className="text-[10px] text-[#c9c3a0]">
                            +{t.related.length - 3} 件
                          </li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="mt-1 mb-0 text-[11px] text-[#c9c3a0]">
                        関連学びなし
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2.5">
                <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                  昨日の控えもない。朝の結びつきがまだない朝じゃ。
                </p>
                <p className="m-0 border-l-[3px] border-[#9ec0ff] pl-2 text-[12px] leading-relaxed text-[#f7f3d9]">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
                    つまり{" "}
                  </span>
                  じゅもんで morning_briefing → 必要なら save_task_mappings。
                  手順が不安なら{" "}
                  <Link href="/setup" className="text-[#9ec0ff] underline">
                    じゅんび
                  </Link>
                  。
                </p>
                {pendingGate ? (
                  <div className="border-t-2 border-[#002070] pt-2.5">
                    <p className="m-0 mb-2 text-[12px] text-[#c9c3a0]">
                      任務の代わりに、いま解けるしれんがあるぞ。
                    </p>
                    <p className="m-0 mb-2 line-clamp-2 text-[13px] text-[#f7f3d9]">
                      {pendingGate.title ?? "未クリアのしれん"}
                    </p>
                    <Link href={fightHref} className="dq-btn inline-block">
                      たたかう
                    </Link>
                  </div>
                ) : (
                  <p className="m-0 border-t-2 border-[#002070] pt-2.5 text-[12px] text-[#c9c3a0]">
                    しれんもまだない。学びを拾うか、じゅんびを点検せよ。
                  </p>
                )}
              </div>
            )}
        </div>

        <div
          role="tabpanel"
          aria-hidden={tab !== "weak"}
          className={`[grid-area:stack] ${
            tab === "weak" ? "" : "invisible pointer-events-none"
          }`}
        >
            <p className="m-0 mb-2 text-[12px] text-[#c9c3a0]">
              横断で欠ける論点。次のしれんで優先せよ。
            </p>
            {weaknesses && weaknesses.length > 0 ? (
              <>
                <ul className="m-0 list-none p-0">
                  {weaknesses.slice(0, 8).map((w, i) => (
                    <li
                      key={w.aspect}
                      className={`flex min-w-0 items-baseline justify-between gap-2 py-2 ${
                        i ? "border-t-2 border-[#002070]" : "pt-0"
                      }`}
                    >
                      <span className="min-w-0 truncate text-[13px] text-[#f7f3d9]">
                        {w.aspect}
                      </span>
                      <span className="shrink-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#e84848]">
                        欠 {Math.round(w.missRate * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/gates"
                  className="mt-3 inline-block font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
                >
                  しれん一覧へ →
                </Link>
              </>
            ) : (
              <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                まだ弱点の集計がないようじゃ。しれんを積むとここが育つぞ。
              </p>
            )}
        </div>
      </div>
    </AtlasReveal>
  );
}

const LOG: Record<string, { who: string; title: string; body: string }> = {
  "quest-1": {
    who: "◆ しれんの案内",
    title: "未クリアのしれん",
    body: "『たたかう』で解答画面へ。じゅもん（回答）は採点に送られるぞ。",
  },
  "clear-1": {
    who: "◆ CLEAR（ずかんに記録済み）",
    title: "クリア済みのつまずき",
    body: "ずかんで本文・根拠・再出題を見返せる。同じ系統のしれんのヒントになるぞ。",
  },
  you: {
    who: "◆ いまのばしょ",
    title: "しれん連峰のふもと",
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
    { title: "① 未クリアのしれんを1つ解く", meta: "『たたかう』→ じゅもん（LLM）で回答" },
    { title: "② 受信箱の学びを仕分ける", meta: "にっき → 候補を確認" },
    { title: "③ 弱ってる repo の処方を見る", meta: "どうぐ → cache / harness 処方" },
  ],
  taskMap = null,
  yesterdayTaskMap = null,
  weaknesses = null,
  wsToken = null,
  setupDiagnosis = null,
  textbookGuidance = null,
}: AtlasDashboardProps) {
  const [activeId, setActiveId] = useState(pendingGate ? "quest-1" : "you");
  const adventurer =
    adventurerProp ?? adventurerLevelFromResolved(resolvedTotal);

  const log = LOG[activeId] ?? {
    who: "◆ しれんの案内",
    title: pendingGate?.title ?? "つぎのしれんはないようじゃ",
    body: pendingGate
      ? "『たたかう』で解答画面へ。問い全文はそこで読むのじゃ。"
      : "ちずのピンを選ぶか、コマンド窓からにっき・どうぐを開くとよいぞ。",
  };

  const primaryCta = resolveHomeCta({
    essentialsReady: setupDiagnosis?.essentialsReady ?? true,
    tutorialSampleSubmitted:
      setupDiagnosis?.tutorialSampleSubmitted ?? true,
    tutorialReady: setupDiagnosis?.tutorialReady ?? true,
    pendingGateId: pendingGate?.id ?? null,
    pendingGateTitle: pendingGate?.title ?? null,
    gitHookInstalled: setupDiagnosis?.gitHookInstalled ?? false,
    textbookGuidance,
  });
  const assistContext = [
    textbookGuidance
      ? `きょうのしょ導線: ${textbookGuidance.briefingLine}`
      : "",
    pendingGate
      ? `次のしれん id: ${pendingGate.id}\n${pendingGate.title ?? ""}\n${pendingGate.question}`
      : "次のしれん: なし",
    weaknesses?.length
      ? `弱点: ${weaknesses
          .slice(0, 3)
          .map((w) => `${w.aspect}(${Math.round(w.missRate * 100)}%)`)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <AtlasShell>
      <AtlasWorldIntroModal />
      <AtlasReveal as="section">
        <div className="grid grid-cols-1 items-center gap-3.5 border-4 border-[#f0d25a] bg-[#001a8c] p-4 outline outline-4 outline-[#000c4a] shadow-[6px_6px_0_#000] md:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
              ◆ いまの一手
            </div>
            <h1 className="m-0 font-[family-name:var(--font-jp)] text-[18px] font-normal leading-relaxed">
              {primaryCta.title}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[#c9c3a0]">
              {primaryCta.body}
            </p>
          </div>
          <Link href={primaryCta.href} className="dq-btn">
            {primaryCta.label}
          </Link>
        </div>
      </AtlasReveal>
      <AtlasReveal as="section">
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent="general"
            context={assistContext}
            title="じゅもんで今日を進める"
            blurb="朝の仕分けも、証跡も、どうぐの見立ても——願うならここからじゅもんを。ひとつのしれんなら上の一手へ。"
            plain="ホーム用の全体操作。Claude/Codex が開き MCP で morning_briefing・仕分け・処方など。1問集中は上のプライマリ CTA。"
            defaultOpen={false}
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
      </AtlasReveal>

      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
        <AtlasReveal as="section" className="dq-win flex h-full flex-col gap-2.5 p-3">
          <AtlasPageTitle
            title="ちず"
            sub="あかるい領ほど、まち・きがふえるんじゃ"
            surface="map"
          />
          <AtlasWorldMap activeId={activeId} onSelect={setActiveId} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#c9c3a0]">
            {REGION_LEGEND.map((r) => (
              <span key={r.name} className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block h-2.5 w-2.5 border border-black"
                  style={{ background: r.swatch }}
                  aria-hidden
                />
                {r.name}
              </span>
            ))}
            <span className="text-[#9ec0ff]">！＝未クリア</span>
            <span>まち／き＝学びの密度</span>
          </div>
        </AtlasReveal>

        <StatusCommandPanel
          adventurer={adventurer}
          resolvedTotal={resolvedTotal}
          thisWeekDelta={thisWeekDelta}
          streakDays={streakDays}
          systemStars={systemStars}
          todos={todos}
          taskMap={taskMap}
          yesterdayTaskMap={yesterdayTaskMap}
          weaknesses={weaknesses}
          pendingGate={pendingGate}
        />
      </div>

      <AtlasReveal
        as="section"
        delayIndex={2}
        className="dq-win grid grid-cols-1 items-center gap-3 p-3.5 md:grid-cols-[1fr_auto]"
      >
        <div>
          <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
            {log.who}
          </div>
          <h2 className="m-0 text-[16px] font-normal leading-relaxed">{log.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#c9c3a0]">{log.body}</p>
        </div>
        <Link href={primaryCta.href} className="dq-btn">
          {primaryCta.label}
        </Link>
      </AtlasReveal>
    </AtlasShell>
  );
}
