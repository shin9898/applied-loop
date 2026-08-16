"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { joinWaitlist } from "@/lib/actions";

function StatusLine() {
  const params = useSearchParams();
  if (params.get("joined") === "1") {
    return (
      <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#f0d25a]">
        とうろくした。動きがあったら この あどれす に しらせる。
      </p>
    );
  }
  if (params.get("error") === "1") {
    return (
      <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#ff9e9e]">
        めーるあどれす の 形式を たしかめてほしい。
      </p>
    );
  }
  return null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="dq-btn !text-[10px]" disabled={pending}>
      {pending ? "そうしん中…" : "しらせをうけとる"}
    </button>
  );
}

export function LpWaitlistForm() {
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
        <SubmitButton />
      </form>
      <Suspense fallback={null}>
        <StatusLine />
      </Suspense>
    </div>
  );
}
