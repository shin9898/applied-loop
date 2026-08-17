"use client";

import { useState, useTransition } from "react";
import { runGradingProbeLiveAction } from "@/lib/actions";
import { AtlasSpellWait } from "./atlas-spell-wait";
import type { GradingProbeResult } from "@/lib/grading-probe";

export function AtlasGradingProbeButton({
  onResult,
}: {
  onResult: (result: GradingProbeResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="dq-btn dq-btn-ghost !px-2 !py-1.5 text-[7px]"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await runGradingProbeLiveAction();
              onResult(result);
            } catch {
              setError("確認できなかった。もう一度試してほしい。");
            }
          });
        }}
      >
        {pending ? "伺いを立てておる…" : "賢者に伺いを立てる"}
      </button>
      <AtlasSpellWait
        variant="inline"
        active={pending}
        label="めくりんが賢者に伺いを立てておる……"
      />
      {error ? (
        <p className="mt-1 mb-0 text-[11px] text-[#e84848]">{error}</p>
      ) : null}
    </div>
  );
}
