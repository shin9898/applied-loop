"use client";

import { useEffect, useState } from "react";

type Props = {
  variant: "inline" | "panel";
  /** 例: "じゅもんを かきとめている……" */
  label: string;
  active: boolean;
};

const PHRASES = [
  "ふるいけや　かはずとびこむ　みずのおと",
  "つきひかり　もりのおくより　こえひとつ",
  "かぜのおと　しずかにきざむ　しるしかな",
];

const CHAR_INTERVAL_MS = 140;
const HOLD_MS = 900;
const TICK_MS = 100;

/**
 * 経過時間から表示すべき文字数を返す。
 * 「1文字ずつタイピング → 全文表示のままホールド」を1サイクルとしてループする。
 */
export function visibleCharsForElapsed(
  elapsedMs: number,
  phraseLength: number,
  charIntervalMs = CHAR_INTERVAL_MS,
  holdMs = HOLD_MS,
): number {
  if (phraseLength <= 0) return 0;
  const cycleMs = phraseLength * charIntervalMs + holdMs;
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  return Math.min(phraseLength, Math.floor(t / charIntervalMs));
}

function pickPhrase(): string {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)]!;
}

export function AtlasSpellWait({ variant, label, active }: Props) {
  const [phrase] = useState(pickPhrase);
  const [charsShown, setCharsShown] = useState(0);

  useEffect(() => {
    if (!active) {
      setCharsShown(0);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setCharsShown(phrase.length);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setCharsShown(
        visibleCharsForElapsed(Date.now() - startedAt, phrase.length),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, phrase]);

  if (!active) return null;

  const visible = phrase.slice(0, charsShown).split("");

  return (
    <div
      className={`atlas-spell-wait atlas-spell-wait--${variant}${
        variant === "panel" ? " dq-win" : ""
      }`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {variant === "panel" ? (
        <p className="atlas-spell-wait__label">{label}</p>
      ) : null}
      <p className="atlas-spell-wait__line">
        {visible.map((ch, i) => (
          <span
            key={i}
            className={
              i === visible.length - 1
                ? "atlas-spell-wait__char atlas-spell-wait__char--active"
                : "atlas-spell-wait__char"
            }
          >
            {ch}
          </span>
        ))}
        <span className="atlas-cursor" />
      </p>
    </div>
  );
}
