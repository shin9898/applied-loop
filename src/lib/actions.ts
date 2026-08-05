"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { dayStartJST } from "@/lib/date";
import { gradeGate } from "@/lib/gate";
import {
  approveRequirementLink,
  rejectRequirementLink,
  refreshRequirementsForGate,
} from "@/lib/requirement";
import {
  buildGateDebrief,
  type GateDebrief,
} from "@/lib/grade-payload";
import {
  evaluateMicroParaphrase,
  type MicroCheckResult,
} from "@/lib/micro-check";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createEntry(formData: FormData) {
  await requireAuth();
  const title = str(formData, "title");
  if (!title) throw new Error("title is required");
  const entry = await prisma.entry.create({
    data: {
      title,
      source: str(formData, "source") || null,
      kind: str(formData, "kind") || "book",
      note: str(formData, "note") || null,
    },
  });
  revalidatePath("/");
  revalidatePath("/entries");
  redirect(`/entries/${entry.id}`);
}

export async function createApplication(formData: FormData) {
  await requireAuth();
  const entryId = str(formData, "entryId");
  const appliedTo = str(formData, "appliedTo");
  const note = str(formData, "note");
  if (!entryId || !appliedTo || !note) throw new Error("required fields missing");
  await prisma.application.create({
    data: {
      entryId,
      appliedTo,
      note,
      decisionChanged: str(formData, "decisionChanged") || null,
    },
  });
  revalidatePath("/");
  revalidatePath(`/entries/${entryId}`);
}

export async function createExperiment(formData: FormData) {
  await requireAuth();
  const entryId = str(formData, "entryId");
  const action = str(formData, "action");
  const successMetric = str(formData, "successMetric");
  if (!entryId || !action || !successMetric) throw new Error("required fields missing");
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 30 * 86400000);
  const experiment = await prisma.experiment.create({
    data: { entryId, action, successMetric, startDate, endDate },
  });
  revalidatePath("/");
  revalidatePath(`/entries/${entryId}`);
  redirect(`/experiments/${experiment.id}`);
}

export async function createCheckIn(formData: FormData) {
  await requireAuth();
  const experimentId = str(formData, "experimentId");
  if (!experimentId) throw new Error("experimentId is required");
  const today = dayStartJST();
  await prisma.checkIn.upsert({
    where: { experimentId_date: { experimentId, date: today } },
    create: {
      experimentId,
      date: today,
      done: true,
      note: str(formData, "note") || null,
    },
    update: { done: true, note: str(formData, "note") || null },
  });
  revalidatePath("/");
  revalidatePath(`/experiments/${experimentId}`);
}

export async function completeExperiment(formData: FormData) {
  await requireAuth();
  const experimentId = str(formData, "experimentId");
  if (!experimentId) throw new Error("experimentId is required");
  await prisma.experiment.update({
    where: { id: experimentId },
    data: {
      status: str(formData, "status") === "abandoned" ? "abandoned" : "completed",
      outcome: str(formData, "outcome") || null,
    },
  });
  revalidatePath("/");
  revalidatePath(`/experiments/${experimentId}`);
}

export async function joinWaitlist(formData: FormData) {
  await requireAuth();
  const email = str(formData, "email");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect("/lp?error=1");
  }
  await prisma.waitlistSignup.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  revalidatePath("/lp");
  redirect("/lp?joined=1");
}

// --- 理解度ゲート (表示側の救済・記録のみ。回答は MCP answer_gate へ集約) ---

export type GateBattleVerdict = "pass" | "retry" | "pending" | "empty" | "busy";

function verdictFromStatus(status: string): GateBattleVerdict {
  if (status === "passed" || status === "self_graded_pass") return "pass";
  if (
    status === "failed" ||
    status === "self_graded_fail" ||
    status === "grading_failed"
  ) {
    return "retry";
  }
  if (status === "answered" || status === "grading") return "pending";
  if (status === "pending") return "busy"; // 未提出のまま（再入力可）
  return "pending";
}

/**
 * ぼうけんのしょ バトル UI 用。MCP answer_gate と同ロジックで回答を受理し、
 * 採点は非同期。失敗しても throw せず pending を返す。
 * empty = 空欄 / busy = まだ未提出で再入力可
 */
export async function submitGateAnswer(
  gateId: string,
  answer: string,
): Promise<GateBattleVerdict> {
  try {
    await requireAuth();
    const id = gateId.trim();
    const ans = answer.trim();
    if (!id) return "pending";
    if (!ans) return "empty";

    const gate = await prisma.gate.findUnique({ where: { id } });
    if (!gate) return "pending";

    const already = verdictFromStatus(gate.status);
    if (already === "pass" || already === "retry" || already === "pending") {
      // pending = 採点中。pass/retry = 既に決着
      return already;
    }

    if (gate.status !== "pending") return "pending";
    if (gate.nextReviewAt && gate.nextReviewAt > new Date()) return "pending";

    await prisma.gate.update({
      where: { id },
      data: {
        answer: ans,
        status: "answered",
        answeredAt: new Date(),
        answerMode: "in_session",
      },
    });

    // MCP answer_gate と同じく after で非同期採点（合否は待たない）
    after(() => {
      gradeGate(id).catch((e) => console.error("[gate] grade failed:", e));
    });

    revalidatePath("/");
    revalidatePath("/gates");
    revalidatePath(`/gates/${id}`);
    revalidatePath("/zukan");
    revalidatePath("/requirements");
    return "pending";
  } catch (e) {
    console.error("[gate] submitGateAnswer failed:", e);
    return "pending";
  }
}

/** バトル画面が採点完了を待つためのポーリング */
export async function pollGateVerdict(
  gateId: string,
): Promise<{
  verdict: GateBattleVerdict;
  note: string | null;
  debrief: GateDebrief | null;
}> {
  try {
    await requireAuth();
    const id = gateId.trim();
    if (!id) return { verdict: "pending", note: null, debrief: null };
    const gate = await prisma.gate.findUnique({
      where: { id },
      select: { status: true, gradeNote: true, rubricResult: true },
    });
    if (!gate) return { verdict: "pending", note: null, debrief: null };
    const verdict = verdictFromStatus(gate.status);
    const debrief =
      verdict === "pass" || verdict === "retry"
        ? buildGateDebrief(gate.gradeNote, gate.rubricResult)
        : null;
    return {
      verdict,
      note: gate.gradeNote,
      debrief,
    };
  } catch (e) {
    console.error("[gate] pollGateVerdict failed:", e);
    return { verdict: "pending", note: null, debrief: null };
  }
}

/**
 * 不合格／採点失敗後に、同じゲートへ答え直す。
 * status を pending に戻してから answer を受け付ける。
 */
export async function resubmitGateAnswer(
  gateId: string,
  answer: string,
): Promise<GateBattleVerdict> {
  try {
    await requireAuth();
    const id = gateId.trim();
    const ans = answer.trim();
    if (!id) return "pending";
    if (!ans) return "empty";

    const gate = await prisma.gate.findUnique({ where: { id } });
    if (!gate) return "pending";

    if (gate.status === "passed" || gate.status === "self_graded_pass") {
      return "pass";
    }
    if (gate.status === "answered" || gate.status === "grading") {
      return "pending";
    }

    const reanswerable = [
      "failed",
      "self_graded_fail",
      "grading_failed",
      "pending",
    ];
    if (!reanswerable.includes(gate.status)) return "pending";

    await prisma.gate.update({
      where: { id },
      data: {
        answer: ans,
        status: "answered",
        answeredAt: new Date(),
        answerMode: "in_session",
        gradeNote: null,
        rubricResult: null,
        gradedAt: null,
      },
    });

    after(() => {
      gradeGate(id).catch((e) => console.error("[gate] grade failed:", e));
    });

    revalidatePath("/");
    revalidatePath("/gates");
    revalidatePath(`/gates/${id}`);
    return "pending";
  } catch (e) {
    console.error("[gate] resubmitGateAnswer failed:", e);
    return "pending";
  }
}

/**
 * 不合格後ミニチェック: 弱い観点を1つ、自分の言葉で言い直せたか判定する。
 * 本採点とは別。LLM 不通時は allowSelfAdvance で答え合わせルートへ。
 */
export async function checkGateMicroAspect(input: {
  gateId: string;
  aspect: string;
  paraphrase: string;
}): Promise<MicroCheckResult> {
  try {
    await requireAuth();
    const id = input.gateId.trim();
    const aspect = input.aspect.trim();
    const paraphrase = input.paraphrase.trim();
    if (!id || !aspect) {
      return {
        ok: false,
        feedback: "観点が特定できぬ。",
        allowSelfAdvance: false,
      };
    }

    const gate = await prisma.gate.findUnique({
      where: { id },
      select: { status: true, gradeNote: true, rubricResult: true },
    });
    if (!gate) {
      return { ok: false, feedback: "ゲートが見つからぬ。", allowSelfAdvance: false };
    }
    const failed = ["failed", "self_graded_fail", "grading_failed"].includes(
      gate.status,
    );
    if (!failed) {
      return {
        ok: false,
        feedback: "ミニチェックは不合格後に使うのじゃ。",
        allowSelfAdvance: false,
      };
    }

    const debrief = buildGateDebrief(gate.gradeNote, gate.rubricResult);
    const target = debrief.weakAspects.find((a) => a.aspect === aspect);
    if (!target) {
      return {
        ok: false,
        feedback: "その観点は今回の弱点一覧に無いぞ。",
        allowSelfAdvance: false,
      };
    }

    return evaluateMicroParaphrase({
      prompt: target.prompt,
      modelAnswer: target.modelAnswer,
      correctModel: debrief.correctModel,
      paraphrase,
    });
  } catch (e) {
    console.error("[gate] checkGateMicroAspect failed:", e);
    return {
      ok: false,
      feedback: "ミニチェックに失敗した。答え合わせから進めてよいぞ。",
      allowSelfAdvance: true,
    };
  }
}

/** 採点失敗からの手動リトライ (認証切れ解消後など) */
export async function retryGrading(formData: FormData) {
  await requireAuth();
  const gateId = str(formData, "gateId");
  if (!gateId) throw new Error("gateId is required");
  await prisma.gate.updateMany({
    where: { id: gateId, status: "grading_failed" },
    data: { status: "answered", gradeNote: null },
  });
  after(async () => {
    await gradeGate(gateId).catch((e) => console.error("[gate] grade failed:", e));
  });
  revalidatePath(`/gates/${gateId}`);
}

/** セルフ採点フォールバック (self_graded フラグで NSM 計算時に区別できる) */
export async function selfGrade(formData: FormData) {
  await requireAuth();
  const gateId = str(formData, "gateId");
  const verdict = str(formData, "verdict");
  if (!gateId || (verdict !== "pass" && verdict !== "fail")) {
    throw new Error("invalid request");
  }
  const gate = await prisma.gate.findUniqueOrThrow({ where: { id: gateId } });
  if (gate.status !== "grading_failed") return;
  await prisma.gate.update({
    where: { id: gateId },
    data: {
      status: verdict === "pass" ? "self_graded_pass" : "self_graded_fail",
      gradedAt: new Date(),
    },
  });
  if (verdict === "pass") {
    await refreshRequirementsForGate(gateId).catch((e) =>
      console.error("[requirement] refresh after selfGrade failed:", e)
    );
  }
  revalidatePath("/gates");
  revalidatePath(`/gates/${gateId}`);
  revalidatePath("/requirements");
  revalidatePath("/");
}

/** ゲートを閉じる (スキップ。発火点チューニングの計測対象) */
export async function dismissGate(formData: FormData) {
  await requireAuth();
  const gateId = str(formData, "gateId");
  if (!gateId) throw new Error("gateId is required");
  await prisma.gate.updateMany({
    where: { id: gateId, status: "pending" },
    data: { status: "dismissed" },
  });
  revalidatePath("/gates");
  revalidatePath("/");
}

/** 参考リソースをクリックした記録 (ADR-0007)。pending/answered のみ。NSM 判定には使わない */
export async function recordResourceAccess(formData: FormData) {
  await requireAuth();
  const gateId = str(formData, "gateId");
  if (!gateId) throw new Error("gateId is required");
  await prisma.gate.updateMany({
    where: { id: gateId, status: { in: ["pending", "answered"] } },
    data: { accessedResource: true },
  });
  revalidatePath(`/gates/${gateId}`);
}

/** 要件リンク提案の承認 (ADR-0014) */
export async function approveReqLink(formData: FormData) {
  await requireAuth();
  const linkId = str(formData, "linkId");
  if (!linkId) throw new Error("linkId is required");
  const result = await approveRequirementLink(linkId);
  if (!result.ok) throw new Error(result.message);
  revalidatePath("/requirements");
  revalidatePath("/");
}

/** 要件リンク提案の却下 (ADR-0014) */
export async function rejectReqLink(formData: FormData) {
  await requireAuth();
  const linkId = str(formData, "linkId");
  if (!linkId) throw new Error("linkId is required");
  const result = await rejectRequirementLink(linkId);
  if (!result.ok) throw new Error(result.message);
  revalidatePath("/requirements");
  revalidatePath("/");
}
