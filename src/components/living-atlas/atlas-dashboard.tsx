/**
 * Living Atlas dashboard — DQ / ぼうけんのしょ composition
 * ナビはフローティング・コマンドドックへ集約。画面内に重複コマンドは置かない。
 * 右カラムは地図と同じ高さの「ステータス1窓」。
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  adventurerLevelFromResolved,
  formatStars,
  type AdventurerLevel,
  type SystemStar,
} from "@/lib/atlas-level";
import { AtlasShell } from "./atlas-shell";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasPageTitle } from "./atlas-page-title";
import {
  AtlasWorldMap,
  FOG_REGION_POS,
  SYSTEM_REGION_POS,
  type MapMarker,
} from "./atlas-world-map";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { useAtlasLiveEvents } from "./atlas-live-events-context";
import { AtlasConsoleShell } from "./atlas-console-shell";
import { AtlasWorldIntroModal } from "./atlas-onboarding";
import { AtlasSurfaceIcon, surfaceIdFromHref } from "./atlas-surface-icons";
import type { SetupDiagnosis } from "@/lib/setup-diagnosis";
import type { TextbookGuidance } from "@/lib/textbook-guidance-shared";

/** デイリークエスト1件。href があれば行全体がクリッカブルになる */
export type DashboardTodo = {
  title: string;
  meta: string;
  href?: string;
  cta?: string;
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
    /** 表示用ラベル（例: キャッシュ） */
    system?: string | null;
    /** 地図の領座標を引くための生キー（例: cache） */
    systemKey?: string;
    tags?: string[];
  };
  /** 未クリアしれんの総数（！ピンの脇に表示） */
  pendingGateCount?: number;
  todos?: DashboardTodo[];
  /** 弱点観点トップ (ADR-0011) */
  weaknesses?: { aspect: string; missRate: number; sampleCount: number }[] | null;
  /** UI→LLM→MCP。未設定ならじゅもん案内のみ */
  wsToken?: string | null;
  setupDiagnosis?: SetupDiagnosis | null;
  /** ADR-0020 C3-3: 昨日 Mastery / きょうのしょ 導線 */
  textbookGuidance?: TextbookGuidance | null;
};

type StatusTab = "status" | "weak";

/** 右カラム: ステータス / 弱点を1窓にタブ集約 */
function StatusCommandPanel({
  adventurer,
  resolvedTotal,
  thisWeekDelta,
  streakDays,
  systemStars,
  todos,
  weaknesses,
  bounceIcon = false,
}: {
  adventurer: AdventurerLevel;
  resolvedTotal: number;
  thisWeekDelta: number;
  streakDays: number;
  systemStars: SystemStar[];
  todos: DashboardTodo[];
  weaknesses: AtlasDashboardProps["weaknesses"];
  bounceIcon?: boolean;
}) {
  const weakCount = weaknesses?.length ?? 0;
  const [tab, setTab] = useState<StatusTab>("status");
  const expPct = Math.round(adventurer.expRatio * 100);

  const tabs: { id: StatusTab; label: string; badge?: string }[] = [
    { id: "status", label: "ステータス" },
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
        <h2 className="dq-win-title mb-0">
          ぼうけんしゃ
          {bounceIcon && (
            <span className="atlas-capture-bounce" aria-hidden>
              📥
            </span>
          )}
        </h2>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          司令塔
        </p>
      </div>

      {/* Lv./EXP は面キャラの「今の自分」表示。タブ切り替えに関係なく常時表示 */}
      <div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="atlas-self-avatar atlas-self-avatar--panel" aria-hidden>
              <span className="atlas-self-avatar__frame atlas-self-avatar__frame--1" />
              <span className="atlas-self-avatar__frame atlas-self-avatar__frame--2" />
            </span>
            <div>
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[18px] text-[#f0d25a]">
                Lv.{adventurer.level}
              </p>
              <p className="mt-1 mb-0 text-[14px] text-[#f7f3d9]">
                {adventurer.title}
              </p>
            </div>
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
              className="atlas-exp-fill block h-full bg-gradient-to-r from-[#3ecf5a] to-[#f0d25a]"
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
                ◆ デイリークエスト
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {todos.slice(0, 2).map((t) =>
                  t.href ? (
                    <li key={t.title}>
                      <Link
                        href={t.href}
                        className="flex items-center gap-2 border-2 border-[#002070] bg-white/[0.04] px-1.5 py-1.5 no-underline transition-colors hover:border-[#f0d25a]"
                      >
                        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center bg-[#001a8c] shadow-[inset_-2px_-2px_0_rgba(0,0,0,0.6),2px_2px_0_rgba(0,0,0,0.25)]">
                          <AtlasSurfaceIcon
                            surface={surfaceIdFromHref(t.href)}
                            size={14}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] text-[#f7f3d9]">
                            {t.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[9px] text-[#c9c3a0]">
                            {t.meta}
                          </span>
                        </span>
                        {t.cta ? (
                          <span className="flex-none font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
                            {t.cta} →
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ) : (
                    <li
                      key={t.title}
                      className="border-2 border-transparent px-2 py-2 text-[14px] leading-snug"
                    >
                      {t.title}
                      <span className="mt-0.5 block text-[12px] text-[#c9c3a0]">
                        {t.meta}
                      </span>
                    </li>
                  ),
                )}
              </ul>
              <p className="mb-0 pt-3 text-[11px] leading-relaxed text-[#c9c3a0]">
                弱点は上のタブへ。移動は黒いコマンド窓じゃ。
              </p>
            </div>
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

export function AtlasDashboard({
  resolvedTotal,
  thisWeekDelta,
  streakDays = 0,
  adventurer: adventurerProp,
  systemStars = [],
  pendingGate,
  pendingGateCount,
  todos = [
    {
      title: "① 未クリアのしれんを1つ解く",
      meta: "『たたかう』→ じゅもん（LLM）で回答",
      href: "/gates",
      cta: "しれんへ",
    },
    {
      title: "② 受信箱の学びを仕分ける",
      meta: "にっき → 候補を確認",
      href: "/entries",
      cta: "うけばこへ",
    },
    {
      title: "③ 弱ってる repo の処方を見る",
      meta: "どうぐ → cache / harness 処方",
      href: "/harness",
      cta: "どうぐへ",
    },
  ],
  weaknesses = null,
  wsToken = null,
  setupDiagnosis = null,
  textbookGuidance = null,
}: AtlasDashboardProps) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(pendingGate ? "quest-1" : "you");
  const { lastEvent } = useAtlasLiveEvents();
  const [clearedGateId, setClearedGateId] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [bounceIcon, setBounceIcon] = useState(false);
  const lastSeqRef = useRef(0);
  const pendingGateRef = useRef(pendingGate);

  useEffect(() => {
    pendingGateRef.current = pendingGate;
  }, [pendingGate]);

  useEffect(() => {
    if (!lastEvent || lastEvent.seq === lastSeqRef.current) return;
    lastSeqRef.current = lastEvent.seq;

    setPulse(true);
    const pulseTimer = setTimeout(() => setPulse(false), 900);

    if (lastEvent.type === "gate_passed") {
      router.refresh();
      if (pendingGateRef.current && lastEvent.gateId === pendingGateRef.current.id) {
        setClearedGateId(lastEvent.gateId);
      }
    } else if (lastEvent.type === "task_mapping_saved") {
      setBanner(
        `今の任務と関連しそうな学びを検知しました（${lastEvent.taskCount}件）`,
      );
      const bannerTimer = setTimeout(() => setBanner(null), 6000);
      return () => {
        clearTimeout(pulseTimer);
        clearTimeout(bannerTimer);
        setBanner(null);
      };
    } else if (lastEvent.type === "capture_added") {
      setBounceIcon(true);
      const bounceTimer = setTimeout(() => setBounceIcon(false), 1200);
      return () => {
        clearTimeout(pulseTimer);
        clearTimeout(bounceTimer);
        setBounceIcon(false);
      };
    }

    return () => clearTimeout(pulseTimer);
  }, [lastEvent]);

  const adventurer =
    adventurerProp ?? adventurerLevelFromResolved(resolvedTotal);

  const questPos = pendingGate
    ? (SYSTEM_REGION_POS[pendingGate.systemKey ?? ""] ?? FOG_REGION_POS)
    : null;
  const mapMarkers: MapMarker[] = [
    { id: "you", kind: "you", label: "あなた", left: "22%", top: "64%" },
    ...(pendingGate && questPos
      ? [
          {
            id: "quest-1",
            kind: clearedGateId === pendingGate.id ? ("clear" as const) : ("quest" as const),
            label: "！",
            left: questPos.left,
            top: questPos.top,
            href: `/gates/${pendingGate.id}`,
          },
        ]
      : []),
  ];

  const starByKey = new Map(systemStars.map((s) => [s.key, s.stars]));
  const regionBrightness = {
    knowledge: (starByKey.get("knowledge") ?? 0) / 5,
    harness: (starByKey.get("harness") ?? 0) / 5,
    cache: (starByKey.get("cache") ?? 0) / 5,
    design: (starByKey.get("design") ?? 0) / 5,
    fog:
      Math.max(starByKey.get("verification") ?? 0, starByKey.get("premise") ?? 0) /
      5,
  };

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

  const topScreenContent = (
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
      <AtlasReveal as="section" className="dq-win flex h-full flex-col gap-3 p-3.5">
        <AtlasPageTitle
          title="ちず"
          sub={
            pendingGate
              ? `！＝いまのしれん（未クリア ${pendingGateCount ?? 1} 件）`
              : "領＝学びの系統じゃ"
          }
          surface="map"
        />
        <div className="atlas-worldmap-frame">
          <AtlasWorldMap
            markers={mapMarkers}
            activeId={activeId}
            onSelect={setActiveId}
            regionBrightness={regionBrightness}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#c9c3a0]">
          <span className="text-[#f0d25a]">！＝未クリアのしれん</span>
          <span>自キャラ＝いま</span>
          <span>領＝学びの系統</span>
        </div>

      </AtlasReveal>

      <StatusCommandPanel
        adventurer={adventurer}
        resolvedTotal={resolvedTotal}
        thisWeekDelta={thisWeekDelta}
        streakDays={streakDays}
        systemStars={systemStars}
        todos={todos}
        weaknesses={weaknesses}
        bounceIcon={bounceIcon}
      />
    </div>
  );

  const bottomScreenContent = wsToken ? (
    <AtlasAssist
      wsToken={wsToken}
      intent="general"
      context={assistContext}
      title="じゅもんで今日を進める"
      blurb="朝の仕分けも、証跡も、どうぐの見立ても——願うならここからじゅもんを。ひとつのしれんなら上の一手へ。"
      plain="ホーム用の全体操作。Claude/Codex が開き MCP で morning_briefing・仕分け・処方など。1問集中は上のプライマリ CTA。"
      defaultOpen={true}
    />
  ) : (
    <AtlasAssistUnavailable />
  );

  return (
    <AtlasShell>
      <AtlasWorldIntroModal />
      <AtlasConsoleShell
        topScreen={topScreenContent}
        bottomScreen={bottomScreenContent}
        pulse={pulse}
      />
      {banner && (
        <div className="atlas-live-banner" role="status">
          💬 {banner}
        </div>
      )}
    </AtlasShell>
  );
}
