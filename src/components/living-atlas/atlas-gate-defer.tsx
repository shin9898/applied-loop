"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  dismissGateWithReason,
  parkGate,
  unparkGate,
} from "@/lib/actions";

/** pending しれんをあとまわし / スキップ（C1-2） */
export function AtlasGateDeferActions({
  gateId,
  mode = "active",
}: {
  gateId: string;
  mode?: "active" | "parked";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-1">
      {mode === "active" ? (
        <>
          <button
            type="button"
            disabled={pending}
            className="dq-btn dq-btn-ghost !px-2 !py-1.5 text-[7px]"
            title="pending から外す。あとで戻せる"
            onClick={() => {
              startTransition(async () => {
                await parkGate(gateId);
                router.refresh();
              });
            }}
          >
            あとまわし
          </button>
          <button
            type="button"
            disabled={pending}
            className="dq-btn dq-btn-ghost !px-2 !py-1.5 text-[7px]"
            title="悪問・重複などとして閉じる"
            onClick={() => {
              startTransition(async () => {
                await dismissGateWithReason(gateId, "not_relevant");
                router.refresh();
              });
            }}
          >
            閉じる
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="dq-btn !px-2 !py-1.5 text-[7px]"
          onClick={() => {
            startTransition(async () => {
              await unparkGate(gateId);
              router.refresh();
            });
          }}
        >
          もどす
        </button>
      )}
    </div>
  );
}
