"use client";

import { useRouter } from "next/navigation";
import {
  checkGateMicroAspect,
  pollGateVerdict,
  resubmitGateAnswer,
  submitGateAnswer,
  type GateBattleVerdict,
} from "@/lib/actions";
import type { GateDebrief } from "@/lib/grade-payload";
import { AtlasBattle, type BattleVerdict } from "./atlas-battle";

export function AtlasGateBattleClient({
  gate,
}: {
  gate: {
    id: string;
    question: string;
    domain?: string | null;
    initialVerdict?: Extract<BattleVerdict, "pass" | "retry"> | null;
    initialDebrief?: GateDebrief | null;
  };
}) {
  const router = useRouter();
  return (
    <AtlasBattle
      gateId={gate.id}
      question={gate.question}
      domain={gate.domain}
      initialVerdict={gate.initialVerdict ?? null}
      initialDebrief={gate.initialDebrief ?? null}
      onFlee={() => router.push("/")}
      onGoGates={() => router.push("/gates")}
      onCastSpell={async (answer, mode) => {
        try {
          const fn = mode === "resubmit" ? resubmitGateAnswer : submitGateAnswer;
          return await fn(gate.id, answer);
        } catch {
          return "pending";
        }
      }}
      onPollVerdict={async () => {
        try {
          const { verdict, debrief } = await pollGateVerdict(gate.id);
          return { verdict, debrief };
        } catch {
          return { verdict: "pending" satisfies GateBattleVerdict };
        }
      }}
      onCheckMicro={async ({ aspect, paraphrase }) => {
        try {
          return await checkGateMicroAspect({
            gateId: gate.id,
            aspect,
            paraphrase,
          });
        } catch {
          return {
            ok: false,
            feedback: "ミニチェックに失敗した。答え合わせから進めてよいぞ。",
            allowSelfAdvance: true,
          };
        }
      }}
    />
  );
}
