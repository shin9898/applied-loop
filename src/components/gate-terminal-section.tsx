"use client";

import { useEffect, useState } from "react";
import { TerminalSquare } from "lucide-react";
import { TerminalPanel } from "@/components/terminal-panel";
import {
  defaultJumonPrefs,
  loadJumonPrefs,
  resolveModelValue,
  saveJumonPrefs,
  TERMINAL_MODEL_OPTIONS,
  type JumonCliPrefs,
  type TerminalCmd,
} from "@/lib/terminal-models";

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
  const [prefs, setPrefs] = useState<JumonCliPrefs>(() =>
    defaultJumonPrefs(defaultCmd),
  );
  const [customModel, setCustomModel] = useState("");

  useEffect(() => {
    const loaded = loadJumonPrefs(defaultCmd);
    setPrefs(loaded);
    if (loaded.modelId === "custom" && loaded.modelValue) {
      setCustomModel(loaded.modelValue);
    }
  }, [defaultCmd]);

  const modelValue = resolveModelValue(
    prefs.cmd,
    prefs.modelId,
    prefs.modelId === "custom" ? customModel : prefs.modelValue,
  );

  function updatePrefs(next: JumonCliPrefs) {
    setPrefs(next);
    saveJumonPrefs(next);
    if (open) setOpen(false);
  }

  return (
    <section className="space-y-4 rounded-lg bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-bold text-ink">AI と一緒に考える</p>
          <p className="text-xs leading-5 text-ink-secondary">
            サービスとモデルを選んでから起動する。対話しながら回答を組み立てる。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-[10px] border border-border text-xs font-bold">
            {(["claude", "codex"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() =>
                  updatePrefs({ cmd: c, modelId: "default", modelValue: null })
                }
                className={
                  prefs.cmd === c
                    ? "bg-accent px-3 py-2 text-surface"
                    : "bg-surface px-3 py-2 text-ink-secondary transition-colors hover:bg-accent-muted"
                }
              >
                {c}
              </button>
            ))}
          </div>
          <select
            className="rounded-[10px] border border-border bg-surface px-2 py-2 text-xs font-bold text-ink"
            value={prefs.modelId}
            onChange={(e) => {
              const modelId = e.target.value;
              updatePrefs({
                cmd: prefs.cmd,
                modelId,
                modelValue: resolveModelValue(prefs.cmd, modelId, customModel),
              });
            }}
          >
            {TERMINAL_MODEL_OPTIONS[prefs.cmd].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            <option value="custom">カスタム…</option>
          </select>
          {prefs.modelId === "custom" ? (
            <input
              type="text"
              value={customModel}
              placeholder="model id"
              className="w-28 rounded-[10px] border border-border bg-surface px-2 py-2 text-xs text-ink"
              onChange={(e) => {
                const v = e.target.value;
                setCustomModel(v);
                updatePrefs({
                  cmd: prefs.cmd,
                  modelId: "custom",
                  modelValue: v.trim() || null,
                });
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-accent px-5 py-3 text-sm font-bold text-surface transition-opacity hover:opacity-90"
          >
            <TerminalSquare className="h-4 w-4" strokeWidth={2.2} />
            {open
              ? "ターミナルを閉じる"
              : `AI と考える（${prefs.cmd}${modelValue ? ` · ${modelValue}` : ""}）`}
          </button>
        </div>
      </div>
      {open ? (
        <TerminalPanel
          key={`${prefs.cmd}:${modelValue ?? "default"}`}
          gateId={gateId}
          wsToken={wsToken}
          cmd={prefs.cmd}
          model={modelValue}
        />
      ) : null}
    </section>
  );
}
