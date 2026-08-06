"use client";

import { useRouter } from "next/navigation";
import {
  checkGateMicroAspect,
  dismissGateWithReason,
  pollGateVerdict,
  resubmitGateAnswer,
  retryGateGrading,
  submitGateAnswer,
  type GateBattleVerdict,
} from "@/lib/actions";
import type { GateDebrief } from "@/lib/grade-payload";
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";
import type { SystemKind } from "@/lib/atlas-taxonomy";
import { enemyForGate } from "./atlas-enemies";
import { AtlasBattle, type BattleVerdict } from "./atlas-battle";

export function AtlasGateBattleClient({
  gate,
}: {
  gate: {
    id: string;
    question: string;
    domain?: string | null;
    contextSummary?: string | null;
    system?: SystemKind;
    resources?: { kind: string; label: string; href?: string | null }[];
    rubricCriteria?: string[];
    initialVerdict?: Extract<
      BattleVerdict,
      "pass" | "retry" | "grading_failed"
    > | null;
    initialDebrief?: GateDebrief | null;
    relatedEntryId?: string | null;
    relatedInboxId?: string | null;
    relatedMisconceptionId?: string | null;
    nextReviewLabel?: string | null;
  };
}) {
  const router = useRouter();
  const isTutorial = gate.id === TUTORIAL_GATE_ID;
  const zukanHref = gate.relatedMisconceptionId
    ? `/zukan/${gate.relatedMisconceptionId}`
    : "/zukan";
  const enemy = enemyForGate({
    system: gate.system,
    domain: gate.domain,
    text: [gate.question, gate.contextSummary].filter(Boolean).join("\n"),
  });
  return (
    <AtlasBattle
      gateId={gate.id}
      question={gate.question}
      domain={gate.domain}
      contextSummary={gate.contextSummary}
      enemy={enemy}
      resources={gate.resources}
      rubricCriteria={gate.rubricCriteria ?? []}
      initialVerdict={gate.initialVerdict ?? null}
      initialDebrief={gate.initialDebrief ?? null}
      relatedEntryId={gate.relatedEntryId ?? null}
      relatedInboxId={gate.relatedInboxId ?? null}
      relatedMisconceptionId={gate.relatedMisconceptionId ?? null}
      initialNextReviewLabel={gate.nextReviewLabel ?? null}
      zukanHref={zukanHref}
      onFlee={() => router.push(isTutorial ? "/setup" : "/")}
      onGoGates={() => router.push("/gates")}
      onGoZukan={() => router.push(zukanHref)}
      onAccepted={
        isTutorial
          ? () => router.push("/setup?from=sample_gate")
          : undefined
      }
      autoLeaveOnAccept={!isTutorial}
      afterAcceptLabel="じゅんびにもどる（次の手へ）"
      onDismissBadQuestion={
        isTutorial
          ? undefined
          : async () => {
              try {
                return await dismissGateWithReason(gate.id, "bad_question");
              } catch {
                return "busy";
              }
            }
      }
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
          const { verdict, debrief, nextReviewLabel } =
            await pollGateVerdict(gate.id);
          return { verdict, debrief, nextReviewLabel };
        } catch {
          return { verdict: "pending" satisfies GateBattleVerdict };
        }
      }}
      onRetryGrading={async () => {
        try {
          return await retryGateGrading(gate.id);
        } catch {
          return "busy";
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
