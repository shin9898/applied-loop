"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { SetupCheck, SetupDiagnosis } from "@/lib/setup-diagnosis";
import {
  TUTORIAL_LLM_LABELS,
  TUTORIAL_TERMS,
  tutorialPastePrompt,
  type TutorialLlmTrack,
} from "@/lib/tutorial-constants";
import type { TutorialProgress } from "@/lib/tutorial-progress";
import {
  completeTutorialAction,
  ensureTutorialSeedAction,
  markTutorialLlmStepDoneAction,
  setTutorialLlmTrackAction,
  skipTutorialHookAction,
} from "@/lib/actions";
import { AtlasVoicePlain } from "./atlas-voice-plain";

const INTRO_KEY = "atlas-world-intro-seen";

/** ホーム用: 必須欠け or チュートリアル未完のとき */
export function AtlasSetupBanner({ diagnosis }: { diagnosis: SetupDiagnosis }) {
  if (diagnosis.essentialsReady && diagnosis.tutorialReady) return null;
  const next = diagnosis.checks.find((c) => c.id === diagnosis.nextCheckId);
  const label = !diagnosis.essentialsReady
    ? `支度が足りぬ。まず ${next?.label ?? "じゅんび"} じゃ`
    : "はじめのチュートリアルがまだ途中じゃ";
  return (
    <div className="border-4 border-[#f0d25a] bg-[#001a8c] px-3 py-2.5 outline outline-4 outline-[#000c4a] shadow-[4px_4px_0_#000]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 min-w-0 text-[13px] leading-snug text-[#f7f3d9]">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
            天の声
          </span>
          <span className="mx-2 text-[#9ec0ff]">·</span>
          {label}
        </p>
        <Link
          href="/setup"
          className="shrink-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a] no-underline hover:underline"
        >
          じゅんびへ →
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

/** 初回のみ: 1枚＋じゅんびへ */
export function AtlasWorldIntroModal() {
  const [open, setOpen] = useState(false);

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

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#000814cc] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-intro-title"
    >
      <div className="dq-win w-full max-w-md p-4 shadow-[8px_8px_0_#000]">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          ◆ 天の声
        </p>
        <h2
          id="atlas-intro-title"
          className="mt-2 mb-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]"
        >
          ぼうけんのしょへようこそ
        </h2>
        <AtlasVoicePlain
          className="mt-3"
          voice="ここは理解の地図じゃ。まずはじゅんびで、サンプルのしれんを1問提出せよ。賢者（LLM）との道は、そのあとでよい。"
          plain="最初は Web で1問解く。MCP やツール名は次のステップで、貼るだけの文を渡す。"
        />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0]"
            onClick={finish}
          >
            とばす
          </button>
          <Link
            href="/setup"
            className="dq-btn !px-3 !py-2 text-[8px]"
            onClick={finish}
          >
            じゅんびへ進む
          </Link>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="dq-btn !px-3 !py-2 text-[8px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          window.setTimeout(() => setOk(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? "コピーした" : "この文をコピー"}
    </button>
  );
}

function suggestedToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `al_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `al_${Date.now().toString(36)}_change_me`;
}

/** /setup: 進行つきチュートリアル */
export function AtlasSetupPanel({
  diagnosis,
  progress,
}: {
  diagnosis: SetupDiagnosis;
  progress: TutorialProgress;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tokenHint] = useState(() => suggestedToken());
  const current = progress.currentStepId;

  const run = (fn: () => Promise<unknown>) => {
    startTransition(() => {
      void fn().then(() => router.refresh());
    });
  };

  useEffect(() => {
    run(() => ensureTutorialSeedAction());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount 時に一度だけ seed
  }, []);

  const paste = useMemo(
    () =>
      progress.llmTrack ? tutorialPastePrompt(progress.llmTrack) : null,
    [progress.llmTrack],
  );

  return (
    <section className="dq-win space-y-4 p-3.5">
      <div>
        <h1 className="dq-win-title mb-1">じゅんび（チュートリアル）</h1>
        <AtlasVoicePlain
          voice={
            progress.tutorialReady
              ? "支度の最短路は通った。あとは毎日のループじゃ。"
              : "聞け。いまやる1手だけを示そう。終われば次が開く。"
          }
          plain="Web でサンプルしれん1問 → LLM に貼る文で1回呼ぶ。git hook は任意。"
        />
      </div>

      {/* ステップ一覧 */}
      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {progress.steps
          .filter((s) => s.id !== "done")
          .map((s, i) => {
            const active = s.id === current;
            return (
              <li
                key={s.id}
                className={`rounded-sm border px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] ${
                  s.done
                    ? "border-[#3ecf5a] text-[#3ecf5a]"
                    : active
                      ? "border-[#f0d25a] bg-[#f0d25a] text-[#000c4a]"
                      : "border-[#445] text-[#9a9470]"
                }`}
              >
                {i + 1}.{s.optional ? "任意" : s.done ? "済" : "次"}
              </li>
            );
          })}
      </ol>

      {/* いまやる1手 */}
      <div className="border-[3px] border-[#f0d25a] bg-[#001a8c] p-3.5">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
          ◆ いまやる1手
        </p>

        {current === "token" ? (
          <StepToken tokenHint={tokenHint} />
        ) : null}

        {current === "sample_gate" ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#f7f3d9]">
              サンプルしれん（理解度チェック）を1問提出する
            </p>
            <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              MCP はまだ不要。『たたかう』で自分の言葉を書き、『提出する』。
              合否はすぐ出ない（採点は別プロセス）——それで正しい。
            </p>
            <Link
              href={`/gates/${progress.tutorialGateId}`}
              className="dq-btn inline-block !px-3 !py-2 text-[8px]"
            >
              たたかう（サンプルへ）
            </Link>
          </div>
        ) : null}

        {current === "llm_pick" ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#f7f3d9]">使う LLM を選ぶ</p>
            <p className="m-0 text-[12px] text-[#c9c3a0]">
              迷ったら『じゅもん』。アプリ内から同じ道を開ける（ENABLE_TERMINAL=true）。
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                Object.keys(TUTORIAL_LLM_LABELS) as TutorialLlmTrack[]
              ).map((track) => (
                <button
                  key={track}
                  type="button"
                  disabled={pending}
                  className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                  onClick={() => run(() => setTutorialLlmTrackAction(track))}
                >
                  {TUTORIAL_LLM_LABELS[track]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {current === "llm_call" && progress.llmTrack && paste ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#f7f3d9]">
              {TUTORIAL_LLM_LABELS[progress.llmTrack]} に、この文を貼る
            </p>
            <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              ツール名を覚えなくてよい。成功すると朝の要約やしれん一覧が返る。
              {progress.mcpRecent
                ? " —— MCP 疎通を検知したぞ。"
                : ""}
            </p>
            <LlmTrackHint track={progress.llmTrack} />
            <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap border-[2px] border-white bg-[#000c4a] p-2.5 text-[11px] leading-relaxed text-[#f7f3d9]">
              {paste}
            </pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={paste} />
              {progress.llmTrack === "jumon" ? (
                <Link href="/" className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]">
                  ちずでじゅもんを開く
                </Link>
              ) : null}
              <button
                type="button"
                disabled={pending}
                className="dq-btn !px-3 !py-2 text-[8px]"
                onClick={() => run(() => markTutorialLlmStepDoneAction())}
              >
                できた（次へ）
              </button>
            </div>
          </div>
        ) : null}

        {current === "hook" ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#f7f3d9]">
              （任意）git hook でしれんを増やす
            </p>
            <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              毎日の自動生成用。今は飛ばして、あとからでもよい。
            </p>
            <pre className="m-0 overflow-x-auto border-[2px] border-white bg-[#000c4a] p-2.5 text-[11px] text-[#f7f3d9]">
              {"./scripts/setup-git-hook.sh /path/to/your-repo"}
            </pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text="./scripts/setup-git-hook.sh /path/to/your-repo" />
              <button
                type="button"
                disabled={pending}
                className="dq-btn !px-3 !py-2 text-[8px]"
                onClick={() => run(() => skipTutorialHookAction())}
              >
                今は飛ばして完了
              </button>
              <button
                type="button"
                disabled={pending}
                className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                onClick={() => run(() => completeTutorialAction())}
              >
                hook 済みとして完了
              </button>
            </div>
          </div>
        ) : null}

        {current === "done" ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#3ecf5a]">チュートリアル完了</p>
            <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              本運用: 朝に要約 → しれん → 学びの記録。詳細は docs/onboarding.md。
            </p>
            <Link href="/" className="dq-btn inline-block !px-3 !py-2 text-[8px]">
              ちずへもどる
            </Link>
          </div>
        ) : null}
      </div>

      {/* 用語 */}
      <div className="border-t-2 border-[#002070] pt-3">
        <p className="m-0 mb-2 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
          ◆ 用語（UI → 意味）
        </p>
        <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
          {TUTORIAL_TERMS.map((t) => (
            <li key={t.ui} className="text-[12px] text-[#c9c3a0]">
              <span className="text-[#f7f3d9]">{t.ui}</span>
              <span className="text-[#9ec0ff]"> = </span>
              {t.plain}
            </li>
          ))}
        </ul>
      </div>

      {/* 診断の詳細（折りたたみ相当で下部） */}
      <details className="border-t-2 border-[#002070] pt-3">
        <summary className="cursor-pointer font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
          診断の詳細（かなめ {diagnosis.readyRequired}/
          {diagnosis.totalRequired}）
        </summary>
        <ul className="mt-2 mb-0 list-none space-y-2 p-0">
          {diagnosis.checks.map((c) => (
            <CheckRow
              key={c.id}
              check={c}
              highlight={c.id === diagnosis.nextCheckId}
            />
          ))}
        </ul>
      </details>

      <p className="m-0 text-[11px] text-[#c9c3a0]">
        正本: <code className="text-[#9ec0ff]">docs/onboarding.md</code>
        {" · "}
        MCP詳細: <code className="text-[#9ec0ff]">docs/mcp-setup.md</code>
      </p>
    </section>
  );
}

function StepToken({ tokenHint }: { tokenHint: string }) {
  const envSnippet = [
    `MCP_TOKEN=${tokenHint}`,
    "ENABLE_TERMINAL=true",
  ].join("\n");
  return (
    <div className="mt-2 space-y-2">
      <p className="m-0 text-[15px] text-[#f7f3d9]">
        合言葉（MCP_TOKEN）を .env に書く
      </p>
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        下の例をコピーしてプロジェクトの .env に保存し、
        <code className="text-[#9ec0ff]"> npm run dev:all </code>
        で再起動。書いたらこのページを再読み込み。
      </p>
      <pre className="m-0 overflow-x-auto border-[2px] border-white bg-[#000c4a] p-2.5 text-[11px] text-[#f7f3d9]">
        {envSnippet}
      </pre>
      <CopyButton text={envSnippet} />
    </div>
  );
}

function LlmTrackHint({ track }: { track: TutorialLlmTrack }) {
  if (track === "jumon") {
    return (
      <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
        つまり ホームの『じゅもんをとなえる』を開き、貼って送信。ENABLE_TERMINAL と
        dev:all が必要。
      </p>
    );
  }
  if (track === "claude") {
    return (
      <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
        つまり 先に{" "}
        <code>
          claude mcp add --transport http applied-loop
          http://localhost:3100/api/mcp --header &quot;Authorization: Bearer
          …&quot;
        </code>
        。手順は docs/mcp-setup.md。
      </p>
    );
  }
  if (track === "cursor") {
    return (
      <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
        つまり ~/.cursor/mcp.json に applied-loop の url と Bearer を追加してから貼る。
      </p>
    );
  }
  return (
    <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
      つまり ~/.codex/config.toml に applied-loop を追加してから貼る。
    </p>
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
