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
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";
import { AtlasBattle, type BattleVerdict } from "./atlas-battle";

export function AtlasGateBattleClient({
  gate,
}: {
  gate: {
    id: string;
    question: string;
    domain?: string | null;
    contextSummary?: string | null;
    resources?: { kind: string; label: string; href?: string | null }[];
    initialVerdict?: Extract<BattleVerdict, "pass" | "retry"> | null;
    initialDebrief?: GateDebrief | null;
    relatedEntryId?: string | null;
    relatedInboxId?: string | null;
    relatedMisconceptionId?: string | null;
  };
}) {
  const router = useRouter();
  const isTutorial = gate.id === TUTORIAL_GATE_ID;
  const zukanHref = gate.relatedMisconceptionId
    ? `/zukan/${gate.relatedMisconceptionId}`
    : "/zukan";
  return (
    <AtlasBattle
      gateId={gate.id}
      question={gate.question}
      domain={gate.domain}
      contextSummary={gate.contextSummary}
      resources={gate.resources}
      initialVerdict={gate.initialVerdict ?? null}
      initialDebrief={gate.initialDebrief ?? null}
      relatedEntryId={gate.relatedEntryId ?? null}
      relatedInboxId={gate.relatedInboxId ?? null}
      relatedMisconceptionId={gate.relatedMisconceptionId ?? null}
      zukanHref={zukanHref}
      onFlee={() => router.push(isTutorial ? "/setup" : "/")}
      onGoGates={() => router.push("/gates")}
      onGoZukan={() => router.push(zukanHref)}
      onAccepted={
        isTutorial
          ? () => router.push("/setup?from=sample_gate")
          : undefined
      }
      afterAcceptLabel="じゅんびにもどる（次の手へ）"
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
