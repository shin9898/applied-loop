"use client";

import { useState } from "react";
import { TerminalPanel } from "@/components/terminal-panel";
import { AtlasVoicePlain } from "./atlas-voice-plain";

export type AtlasAssistIntent =
  | "general"
  | "goal-evidence"
  | "triage"
  | "harness"
  | "requirements"
  | "gates";

type TerminalCmd = "claude" | "codex";

const INTENT_PLAIN: Record<AtlasAssistIntent, string> = {
  general:
    "ボタンで Claude/Codex が開き、Applied Loop MCP で登録・仕分け・処方・回答まで実行できる。",
  "goal-evidence":
    "capture_learning_candidate → triage → record_application / approve_goal_link で証跡を残す。にっきは結果表示のみ。",
  triage:
    "triage_inbox で受信箱を accept/skip。必要なら capture_learning_candidate で追加捕捉。",
  harness:
    "suggest_cache_prefix_fix で処方差分を提案し、適用後は record_application。",
  requirements:
    "list/register/link_requirement と approve/reject_requirement_link で要件↔理解を進める。",
  gates:
    "list_pending_gates で問いを確認し、対話のあと answer_gate。合否は get_gate_result。",
};

/**
 * UI から LLM（Claude/Codex）を起動し、MCP で全アクションを完結させる面。
 */
export function AtlasAssist({
  wsToken,
  intent = "general",
  context = "",
  gateId,
  title = "じゅもんで操作する",
  blurb = "賢者を呼び、じゅもんの道で願いを叶えよ。",
  plain,
  defaultOpen = false,
  defaultCmd = "codex",
}: {
  wsToken: string;
  intent?: AtlasAssistIntent;
  context?: string;
  gateId?: string;
  title?: string;
  blurb?: string;
  /** 省略時は intent の既定手引 */
  plain?: string;
  defaultOpen?: boolean;
  defaultCmd?: TerminalCmd;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [cmd, setCmd] = useState<TerminalCmd>(defaultCmd);
  const plainText = plain ?? INTENT_PLAIN[intent];

  return (
    <section
      className={`dq-win relative overflow-hidden p-3.5 ${
        open ? "atlas-assist-casting" : ""
      }`}
    >
      {open ? <div className="atlas-assist-aura" aria-hidden /> : null}
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="dq-win-title mb-1">{title}</h2>
          <AtlasVoicePlain voice={blurb} plain={plainText} />
          <p className="mt-1.5 mb-0 text-[11px] text-[#9ec0ff]">
            意図: {intent}
            {gateId ? ` · gate ${gateId.slice(0, 8)}…` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden border-[3px] border-white">
            {(["claude", "codex"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  if (open && c !== cmd) setOpen(false);
                  setCmd(c);
                }}
                className={`px-3 py-2 font-[family-name:var(--font-pixel)] text-[8px] ${
                  cmd === c
                    ? "bg-[#f0d25a] text-[#000c4a]"
                    : "bg-[#000c4a] text-[#c9c3a0]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="dq-btn !px-3 !py-2 text-[8px]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "とじる" : "じゅもんをとなえる"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="relative mt-3">
          <div className="mb-2 border-l-[3px] border-[#f0d25a] bg-[#001a8c] px-3 py-2">
            <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
              ◆ ひとこと（あなた向け）
            </p>
            <p className="mt-1 mb-0 text-[13px] leading-relaxed text-[#f7f3d9]">
              ターミナルに出る長い文は指示書じゃ。
              <strong className="text-[#f0d25a]">編集せず Enter</strong>
              で送ってほしい。
            </p>
            <p className="mt-1 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
              つまり CLI
              にプロンプトが自動注入される。その送信が対話の開始。その後 MCP
              ツールで操作する。
            </p>
          </div>
          <TerminalPanel
            gateId={gateId}
            session={gateId ? undefined : "atlas"}
            intent={intent}
            context={context}
            wsToken={wsToken}
            cmd={cmd}
            noticeMode={gateId ? "gate" : "atlas"}
          />
        </div>
      ) : null}
    </section>
  );
}

/** ターミナル無効時の案内 */
export function AtlasAssistUnavailable() {
  return (
    <section className="dq-win p-3.5">
      <h2 className="dq-win-title">じゅもん</h2>
      <AtlasVoicePlain
        voice="いま、じゅもんの祭壇は消えておる。合言葉を記し、火を灯せ。"
        plain="ENABLE_TERMINAL=true と MCP_TOKEN を .env に入れ、npm run dev:all する。または外部の Claude/Cursor MCP だけで操作してもよい。"
      />
    </section>
  );
}
