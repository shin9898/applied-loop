"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SetupCheck, SetupDiagnosis } from "@/lib/setup-diagnosis";
import { AtlasVoicePlain } from "./atlas-voice-plain";

const INTRO_KEY = "atlas-world-intro-seen";

const INTRO_SLIDES: {
  who: string;
  title: string;
  body: string;
  plain: string;
}[] = [
  {
    who: "◆ 天の声",
    title: "そなたのぼうけんのしょを開け",
    body: "ここは Living Atlas。わかったことがつもった領はあかるくなり、まだ霞むところは霧や「！」となる。地図は、そなたのいまの見取り図じゃ。",
    plain:
      "ホームの WORLD MAP は理解の進捗マップ。右の司令塔で Lv・今日の任務・弱点を切り替える。",
  },
  {
    who: "◆ 天の声",
    title: "願いごとには、じゅもんを",
    body: "学びを拾うのも、しれんに答えるのも、紙の帳面ではなくじゅもんの道を通るのじゃ。画面の『じゅもんをとなえる』でも、外の賢者と手を組んでもよい。どちらも同じ扉じゃ。",
    plain:
      "登録・仕分け・回答などの書き込みはアプリフォームではなく MCP。『じゅもんをとなえる』で Claude/Codex が開き、同じツールを呼ぶ。Cursor 等の外部 MCP でも可。",
  },
  {
    who: "◆ 天の声",
    title: "迷いがあるなら、たたかえ",
    body: "『たたかう』を選べば、ひとつの問いに向き合える。裁きはすぐには下らぬ——あわててそなたに合わせて歪めぬためじゃ。勝っても負けても、ずかんと足跡に残るぞ。",
    plain:
      "『たたかう』→ /gates/[id] で1問に回答。採点は別プロセスで非同期。結果はずかん・証跡に残る。合否はすぐ断定されない。",
  },
];

const MANUAL_STEPS: { title: string; body: string; plain: string }[] = [
  {
    title: "① 賢者と手を結べ",
    body: "外の賢者に applied-loop の道を通せ。",
    plain:
      "Claude / Cursor / Codex に MCP（http://localhost:3100/api/mcp + Bearer）を登録。手順は docs/mcp-setup.md。",
  },
  {
    title: "② 足跡を拾う仕込みをせよ",
    body: "鉤をかけ、賢者への教えを記せ。",
    plain:
      "`./scripts/setup-git-hook.sh <repo>` で commit→しれん生成。ルールスニペットで朝 briefing・学び捕捉を習慣化。",
  },
  {
    title: "③ 朝を開き、しれんへ",
    body: "朝の声を聞き、迷いがあればたたかえ。",
    plain:
      "`morning_briefing` → 必要なら仕分け／任務マッピング → ホームの『たたかう』または `answer_gate`。合否は `get_gate_result`。",
  },
];

/** ホーム用: 必須欠けのときだけ薄い1行 */
export function AtlasSetupBanner({ diagnosis }: { diagnosis: SetupDiagnosis }) {
  if (diagnosis.essentialsReady) return null;
  const next = diagnosis.checks.find((c) => c.id === diagnosis.nextCheckId);
  return (
    <div className="border-4 border-[#f0d25a] bg-[#001a8c] px-3 py-2.5 outline outline-4 outline-[#000c4a] shadow-[4px_4px_0_#000]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 min-w-0 text-[13px] leading-snug text-[#f7f3d9]">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
            天の声
          </span>
          <span className="mx-2 text-[#9ec0ff]">·</span>
          支度が足りぬ。まず {next?.label ?? "じゅんび"} じゃ
        </p>
        <Link
          href="/setup"
          className="shrink-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a] no-underline hover:underline"
        >
          みちしるべへ →
        </Link>
      </div>
      {next?.plain ? (
        <p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          つまり {next.plain}
        </p>
      ) : null}
    </div>
  );
}

/** 初回のみ: 世界観の短いモーダル（ページ自動遷移なし） */
export function AtlasWorldIntroModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(INTRO_KEY) === "1") return;
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!open) return null;
  const slide = INTRO_SLIDES[step] ?? INTRO_SLIDES[0];
  const last = step >= INTRO_SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#000814cc] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-intro-title"
    >
      <div className="dq-win w-full max-w-md p-4 shadow-[8px_8px_0_#000]">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          {slide.who}
        </p>
        <h2
          id="atlas-intro-title"
          className="mt-2 mb-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]"
        >
          {slide.title}
        </h2>
        <AtlasVoicePlain
          className="mt-3"
          voice={slide.body}
          plain={slide.plain}
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
            {step + 1} / {INTRO_SLIDES.length}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0]"
              onClick={finish}
            >
              とばす
            </button>
            {step > 0 ? (
              <button
                type="button"
                className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                onClick={() => setStep((s) => s - 1)}
              >
                もどる
              </button>
            ) : null}
            <button
              type="button"
              className="dq-btn !px-3 !py-2 text-[8px]"
              onClick={() => {
                if (last) finish();
                else setStep((s) => s + 1);
              }}
            >
              {last ? "しょを閉じる" : "つぎへ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** /setup: 診断フルパネル */
export function AtlasSetupPanel({ diagnosis }: { diagnosis: SetupDiagnosis }) {
  const next = diagnosis.checks.find((c) => c.id === diagnosis.nextCheckId);

  return (
    <section className="dq-win p-3.5">
      <h1 className="dq-win-title mb-1">みちしるべ</h1>
      <AtlasVoicePlain
        voice={`聞け。旅の支度を数えておる。かなめ ${diagnosis.readyRequired}/${diagnosis.totalRequired}${
          diagnosis.essentialsReady
            ? " —— かなめはそろった"
            : " —— まだ欠けておるものがある"
        }`}
        plain="必須（アプリ起動・MCP_TOKEN）が揃うと書き込み系が動く。任意項目はしれん自動生成や画面内じゅもん用。"
      />

      {next ? (
        <div className="mt-3 border-l-[3px] border-[#f0d25a] bg-[#001a8c] px-3 py-2">
          <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
            ◆ 天の声 · つぎにせよ
          </p>
          <p className="mt-1 mb-0 text-[14px] text-[#f7f3d9]">{next.label}</p>
          <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
            {next.howTo}
          </p>
          <p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
            つまり {next.plain}
          </p>
        </div>
      ) : (
        <p className="mt-3 mb-0 text-[13px] text-[#3ecf5a]">
          支度は整った。ちずへもどり、じゅもんか『たたかう』を選べ。
          <span className="mt-1 block text-[11px] text-[#9ec0ff]">
            つまり ホームから今日の操作を始められる状態。
          </span>
        </p>
      )}

      <ul className="mt-3 mb-0 list-none space-y-2 p-0">
        {diagnosis.checks.map((c) => (
          <CheckRow
            key={c.id}
            check={c}
            highlight={c.id === diagnosis.nextCheckId}
          />
        ))}
      </ul>

      <ol className="mt-4 mb-0 list-none space-y-3 border-t-2 border-[#002070] p-0 pt-3">
        <li className="mb-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
          ◆ 三つの教え
        </li>
        {MANUAL_STEPS.map((s) => (
          <li key={s.title}>
            <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
              {s.title}
            </p>
            <AtlasVoicePlain className="mt-1" voice={s.body} plain={s.plain} />
          </li>
        ))}
        <li className="text-[11px] text-[#c9c3a0]">
          詳細手順:{" "}
          <code className="text-[#9ec0ff]">docs/onboarding.md</code>
          {" · "}
          <code className="text-[#9ec0ff]">docs/mcp-setup.md</code>
        </li>
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/" className="dq-btn !px-3 !py-2 text-[8px]">
          ちずにもどる
        </Link>
        {diagnosis.essentialsReady ? (
          <button
            type="button"
            className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
            onClick={() => {
              try {
                localStorage.removeItem(INTRO_KEY);
              } catch {
                /* ignore */
              }
              window.location.href = "/";
            }}
          >
            天の声をもう一度
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CheckRow({
  check,
  highlight,
}: {
  check: SetupCheck;
  highlight: boolean;
}) {
  return (
    <li
      className={`flex min-w-0 items-start gap-2 py-1.5 text-[13px] ${
        highlight ? "text-[#f7f3d9]" : "text-[#c9c3a0]"
      }`}
    >
      <span
        className={`shrink-0 font-[family-name:var(--font-pixel)] text-[10px] ${
          check.ok ? "text-[#3ecf5a]" : "text-[#e84848]"
        }`}
      >
        {check.ok ? "✓" : "！"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 leading-snug">
          {check.label}
          {!check.required ? (
            <span className="ml-1 text-[10px] text-[#9ec0ff]">任意</span>
          ) : null}
        </p>
        <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9a9470]">
          {check.detail}
        </p>
        <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          つまり {check.plain}
        </p>
        {!check.ok ? (
          <p className="mt-0.5 mb-0 font-mono text-[10px] leading-relaxed text-[#c9c3a0]">
            → {check.howTo}
          </p>
        ) : null}
      </div>
    </li>
  );
}
