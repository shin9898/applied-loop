"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { joinWaitlist } from "@/lib/actions";

const COPY = {
  ja: {
    joined: "とうろくした。動きがあったら この あどれす に しらせる。",
    error: "めーるあどれす の 形式を たしかめてほしい。",
    pending: "そうしん中…",
    submit: "しらせをうけとる",
  },
  en: {
    joined: "You're on the list. We'll email this address when there's news.",
    error: "Please check the email address format.",
    pending: "Sending…",
    submit: "Notify me",
  },
} as const;

function StatusLine({ lang }: { lang: "ja" | "en" }) {
  const t = COPY[lang];
  const params = useSearchParams();
  if (params.get("joined") === "1") {
    return (
      <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#f0d25a]">
        {t.joined}
      </p>
    );
  }
  if (params.get("error") === "1") {
    return (
      <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#ff9e9e]">
        {t.error}
      </p>
    );
  }
  return null;
}

function SubmitButton({ lang }: { lang: "ja" | "en" }) {
  const t = COPY[lang];
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="dq-btn !text-[10px]" disabled={pending}>
      {pending ? t.pending : t.submit}
    </button>
  );
}

export function LpWaitlistForm({ lang = "ja" }: { lang?: "ja" | "en" }) {
  return (
    <div>
      <form action={joinWaitlist} className="mt-4 flex flex-wrap gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          className="min-w-[220px] flex-1 border-[3px] border-[#002070] bg-[#000814] px-3 py-2 font-mono text-[13px] text-[#f7f3d9] placeholder:text-[#5a6a9a] focus:border-[#9ec0ff] focus:outline-none"
        />
        <SubmitButton lang={lang} />
      </form>
      <Suspense fallback={null}>
        <StatusLine lang={lang} />
      </Suspense>
    </div>
  );
}
