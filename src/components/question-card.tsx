"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Check, Sparkles } from "lucide-react";
import { ContextChipRow } from "@/components/context-chip";

const subscribeNoop = () => () => {};

/** 今日の問いかけカード。「今日は見送る」は当日だけ localStorage に記憶 */
export function QuestionCard({
  entryId,
  title,
  daysSince,
  storageKey,
  repo,
  domain,
  goal,
  meta,
  borderTone = "accent",
}: {
  entryId: string;
  title: string;
  daysSince: number;
  storageKey: string;
  repo?: string | null;
  domain?: string | null;
  goal?: string | null;
  meta?: string | null;
  borderTone?: "accent" | "warn";
}) {
  const stored = useSyncExternalStore(
    subscribeNoop,
    () => localStorage.getItem(storageKey) === "1",
    () => false
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = stored || dismissedNow;

  if (dismissed) return null;

  const borderClass =
    borderTone === "warn" ? "border-warn" : "border-accent";

  return (
    <section
      className={`rounded-[10px] border-l-4 bg-surface ${borderClass} px-[26px] py-5 shadow-none`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={2.2} />
          <span className="text-[13px] font-bold tracking-[2px] text-accent">
            今日の問いかけ
          </span>
        </div>
        <span className="font-display text-xs text-ink-faint">
          登録から {daysSince} 日経過・未適用
        </span>
      </div>
      <h2 className="font-display text-[15px] font-bold leading-6 text-ink">
        「{title}」— 今日のタスクで試せそうですか？
      </h2>
      <div className="mt-2.5">
        <ContextChipRow repo={repo} domain={domain} goal={goal} />
      </div>
      {meta && (
        <p className="mt-2.5 text-[11px] text-ink-faint">{meta}</p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Link
          href={`/entries/${entryId}`}
          className="flex items-center gap-2 rounded-[10px] bg-accent px-5 py-2.5 text-sm font-bold text-surface transition-opacity hover:opacity-90"
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
          試してみた → 記録する
        </Link>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(storageKey, "1");
            setDismissedNow(true);
          }}
          className="rounded-[10px] border border-border px-5 py-2.5 text-sm text-ink-secondary transition-colors hover:bg-surface-raised"
        >
          今日はあとで
        </button>
      </div>
    </section>
  );
}
