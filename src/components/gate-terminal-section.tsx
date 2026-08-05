"use client";

import { useState } from "react";
import { TerminalSquare } from "lucide-react";
import { TerminalPanel } from "@/components/terminal-panel";

type TerminalCmd = "claude" | "codex";

/** ゲート詳細の「ターミナルで回答」展開 UI (ADR-0015) */
export function GateTerminalSection({
  gateId,
  wsToken,
  defaultCmd = "codex",
}: {
  gateId: string;
  wsToken: string;
  defaultCmd?: TerminalCmd;
}) {
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState<TerminalCmd>(defaultCmd);

  const toggle = (next: TerminalCmd) => {
    if (open && next !== cmd) {
      // 実行中の切替は終了後の再起動 UI で行う。親側では一度閉じて次回起動に反映
      setOpen(false);
    }
    setCmd(next);
  };

  return (
    <section className="space-y-4 rounded-lg bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-bold text-ink">AI と一緒に考える</p>
          <p className="text-xs leading-5 text-ink-secondary">
            契約 LLM を理解チェックの文脈付きで起動し、対話しながら回答を組み立てます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-[10px] border border-border text-xs font-bold">
            {(["claude", "codex"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={
                  cmd === c
                    ? "bg-accent px-3 py-2 text-surface"
                    : "bg-surface px-3 py-2 text-ink-secondary transition-colors hover:bg-accent-muted"
                }
              >
                {c}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-accent px-5 py-3 text-sm font-bold text-surface transition-opacity hover:opacity-90"
          >
            <TerminalSquare className="h-4 w-4" strokeWidth={2.2} />
            {open ? "ターミナルを閉じる" : "AI と考える"}
          </button>
        </div>
      </div>
      {open && <TerminalPanel gateId={gateId} wsToken={wsToken} cmd={cmd} />}
    </section>
  );
}
