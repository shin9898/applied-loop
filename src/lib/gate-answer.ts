/**
 * ゲート回答の単一受理経路 (ADR-0010)。
 * MCP answer_gate / バトル Server Action / じゅもん(terminal) がここを通る。
 */
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { gradeGate } from "@/lib/gate";

export type GateAnswerSource = "mcp" | "terminal" | "battle";

export type AcceptGateAnswerResult =
  | { ok: true; status: "accepted" }
  | {
      ok: false;
      code:
        | "empty"
        | "not_found"
        | "not_accepting"
        | "not_due"
        | "already_pass"
        | "grading";
      message: string;
    };

function answerModeFor(source: GateAnswerSource): string {
  if (source === "terminal") return "assisted";
  // battle / mcp はセッション内回答として同じモード
  return "in_session";
}

const REANSWERABLE = new Set([
  "failed",
  "self_graded_fail",
  "grading_failed",
  "pending",
]);

/**
 * DB を触らない受理判定（回帰テスト用に分離）。
 */
export function evaluateGateAcceptability(input: {
  status: string;
  nextReviewAt: Date | null;
  resubmit?: boolean;
  now?: Date;
}): Exclude<AcceptGateAnswerResult, { ok: true }> | { ok: true } {
  const { status, nextReviewAt, resubmit } = input;
  const now = input.now ?? new Date();

  if (status === "passed" || status === "self_graded_pass") {
    return {
      ok: false,
      code: "already_pass",
      message: "このゲートはすでに CLEAR 済みです。",
    };
  }

  if (status === "answered" || status === "grading") {
    return {
      ok: false,
      code: "grading",
      message: `採点中または回答済みです (status: ${status})。`,
    };
  }

  if (resubmit) {
    if (!REANSWERABLE.has(status)) {
      return {
        ok: false,
        code: "not_accepting",
        message: `このゲートは再回答を受け付けていません (status: ${status})。`,
      };
    }
  } else if (status !== "pending") {
    return {
      ok: false,
      code: "not_accepting",
      message: `このゲートは回答を受け付けていません (status: ${status})。`,
    };
  }

  if (nextReviewAt && nextReviewAt > now) {
    return {
      ok: false,
      code: "not_due",
      message: "このゲートはまだ出題予定前です。",
    };
  }

  return { ok: true };
}

/**
 * @param resubmit true のとき failed 等から答え直しを許可
 */
export async function acceptGateAnswer(input: {
  gateId: string;
  answer: string;
  source: GateAnswerSource;
  resubmit?: boolean;
}): Promise<AcceptGateAnswerResult> {
  const id = input.gateId.trim();
  const ans = input.answer.trim();
  if (!id || !ans) {
    return {
      ok: false,
      code: "empty",
      message: "gateId と answer は必須です。",
    };
  }

  const gate = await prisma.gate.findUnique({ where: { id } });
  if (!gate) {
    return {
      ok: false,
      code: "not_found",
      message: `ゲートが見つかりません (id: ${id})。`,
    };
  }

  const policy = evaluateGateAcceptability({
    status: gate.status,
    nextReviewAt: gate.nextReviewAt,
    resubmit: input.resubmit,
  });
  if (!policy.ok) return policy;

  const answerMode = answerModeFor(input.source);
  const clearGrade = Boolean(input.resubmit && gate.status !== "pending");

  await prisma.gate.update({
    where: { id },
    data: {
      answer: ans,
      status: "answered",
      answeredAt: new Date(),
      answerMode,
      ...(clearGrade
        ? {
            gradeNote: null,
            rubricResult: null,
            gradedAt: null,
          }
        : {}),
    },
  });

  after(() => {
    gradeGate(id).catch((e) => console.error("[gate] grade failed:", e));
  });

  try {
    const { recordActivationOnce } = await import("@/lib/activation-funnel");
    const { TUTORIAL_GATE_ID } = await import("@/lib/tutorial-constants");
    if (id === TUTORIAL_GATE_ID) {
      recordActivationOnce("sample_submitted", { source: input.source });
    }
  } catch {
    /* ignore */
  }

  return { ok: true, status: "accepted" };
}
