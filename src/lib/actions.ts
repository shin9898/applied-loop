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

export type GateBattleVerdict =
  | "pass"
  | "retry"
  | "pending"
  | "empty"
  | "busy"
  | "grading_failed";

function verdictFromStatus(status: string): GateBattleVerdict {
  if (status === "passed" || status === "self_graded_pass") return "pass";
  if (status === "grading_failed") return "grading_failed";
  if (status === "failed" || status === "self_graded_fail") {
    return "retry";
  }
  if (status === "answered" || status === "grading") return "pending";
  if (status === "pending") return "busy"; // 未提出のまま（再入力可）
  return "pending";
}

/**
 * バトル UI 用。受理は acceptGateAnswer（MCP と同じ経路）。
 * empty = 空欄 / busy = まだ未提出で再入力可
 */
export async function submitGateAnswer(
  gateId: string,
  answer: string,
): Promise<GateBattleVerdict> {
  try {
    await requireAuth();
    const id = gateId.trim();
    if (!id) return "pending";
    if (!answer.trim()) return "empty";

    const gate = await prisma.gate.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!gate) return "pending";

    const already = verdictFromStatus(gate.status);
    if (already === "pass" || already === "retry" || already === "pending") {
      return already;
    }

    const { acceptGateAnswer } = await import("@/lib/gate-answer");
    const result = await acceptGateAnswer({
      gateId: id,
      answer,
      source: "battle",
    });
    if (!result.ok) {
      if (result.code === "empty") return "empty";
      if (result.code === "not_accepting" && gate.status === "pending") {
        return "busy";
      }
      return "pending";
    }

    revalidatePath("/");
    revalidatePath("/gates");
    revalidatePath(`/gates/${id}`);
    revalidatePath("/setup");
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
  nextReviewLabel: string | null;
}> {
  try {
    await requireAuth();
    const id = gateId.trim();
    if (!id) {
      return { verdict: "pending", note: null, debrief: null, nextReviewLabel: null };
    }
    const gate = await prisma.gate.findUnique({
      where: { id },
      select: {
        status: true,
        gradeNote: true,
        rubricResult: true,
        rubricCriteria: true,
        misconception: { select: { nextReviewAt: true } },
      },
    });
    if (!gate) {
      return { verdict: "pending", note: null, debrief: null, nextReviewLabel: null };
    }
    const verdict = verdictFromStatus(gate.status);
    if (
      verdict === "pass" ||
      verdict === "retry" ||
      verdict === "grading_failed"
    ) {
      const { recordActivationOnce, maybeRecordFirstComplete } = await import(
        "@/lib/activation-funnel"
      );
      recordActivationOnce("first_verdict", { status: gate.status });
      const { isTutorialGateSubmitted } = await import("@/lib/tutorial-seed");
      const { mcpTouchedRecently } = await import("@/lib/tutorial-state");
      maybeRecordFirstComplete({
        sampleSubmitted: await isTutorialGateSubmitted(),
        mcpTouched: mcpTouchedRecently(),
        hasVerdict: true,
      });
    }
    const { TUTORIAL_GATE_ID } = await import("@/lib/tutorial-constants");
    const debrief =
      verdict === "pass" || verdict === "retry"
        ? buildGateDebrief(gate.gradeNote, gate.rubricResult, {
            rubricCriteriaJson: gate.rubricCriteria,
            ensureAspects: id === TUTORIAL_GATE_ID && verdict === "retry",
          })
        : null;
    const nextAt = gate.misconception?.nextReviewAt;
    const nextReviewLabel = nextAt
      ? nextAt.toISOString().slice(0, 10)
      : null;
    return {
      verdict,
      note: gate.gradeNote,
      debrief,
      nextReviewLabel,
    };
  } catch (e) {
    console.error("[gate] pollGateVerdict failed:", e);
    return {
      verdict: "pending",
      note: null,
      debrief: null,
      nextReviewLabel: null,
    };
  }
}

/**
 * 不合格／採点失敗後の答え直し。受理は acceptGateAnswer（MCP と同じ経路）。
 */
export async function resubmitGateAnswer(
  gateId: string,
  answer: string,
): Promise<GateBattleVerdict> {
  try {
    await requireAuth();
    const id = gateId.trim();
    if (!id) return "pending";
    if (!answer.trim()) return "empty";

    const gate = await prisma.gate.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!gate) return "pending";

    if (gate.status === "passed" || gate.status === "self_graded_pass") {
      return "pass";
    }
    if (gate.status === "answered" || gate.status === "grading") {
      return "pending";
    }

    const { acceptGateAnswer } = await import("@/lib/gate-answer");
    const result = await acceptGateAnswer({
      gateId: id,
      answer,
      source: "battle",
      resubmit: true,
    });
    if (!result.ok) {
      if (result.code === "empty") return "empty";
      if (result.code === "already_pass") return "pass";
      return "pending";
    }

    revalidatePath("/");
    revalidatePath("/gates");
    revalidatePath(`/gates/${id}`);
    revalidatePath("/setup");
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
  await retryGateGrading(gateId);
}

/** バトル UI 用: 採点失敗からの再採点 */
export async function retryGateGrading(gateId: string): Promise<"pending" | "busy"> {
  await requireAuth();
  const id = gateId.trim();
  if (!id) return "busy";
  const updated = await prisma.gate.updateMany({
    where: { id, status: "grading_failed" },
    data: { status: "answered", gradeNote: null },
  });
  if (updated.count === 0) return "busy";
  after(async () => {
    await gradeGate(id).catch((e) => console.error("[gate] grade failed:", e));
  });
  revalidatePath(`/gates/${id}`);
  revalidatePath("/gates");
  return "pending";
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

const DISMISS_REASONS = new Set([
  "bad_question",
  "duplicate",
  "not_relevant",
  "other",
  "too_many",
]);

/** ゲートを閉じる (スキップ。発火点チューニングの計測対象) */
export async function dismissGate(formData: FormData) {
  await requireAuth();
  const gateId = str(formData, "gateId");
  const reason = str(formData, "reason") || "other";
  if (!gateId) throw new Error("gateId is required");
  await dismissGateWithReason(gateId, reason);
}

/** バトル UI 用: 悪問スキップ（B5-4） */
export async function dismissGateWithReason(
  gateId: string,
  reason: string,
): Promise<"ok" | "busy"> {
  await requireAuth();
  const id = gateId.trim();
  const r = DISMISS_REASONS.has(reason) ? reason : "other";
  if (!id) return "busy";
  const updated = await prisma.gate.updateMany({
    where: { id, status: { in: ["pending", "failed", "grading_failed"] } },
    data: { status: "dismissed", dismissReason: r },
  });
  if (updated.count === 0) return "busy";
  revalidatePath("/gates");
  revalidatePath(`/gates/${id}`);
  revalidatePath("/");
  return "ok";
}

/**
 * ADR-0020 C1-2: pending をあとまわし（parked）。
 * backlog cap の件数から外れ、あとで unpark できる。材料（DevEvent）は消えない。
 */
export async function parkGate(gateId: string): Promise<"ok" | "busy"> {
  await requireAuth();
  const id = gateId.trim();
  if (!id) return "busy";
  const updated = await prisma.gate.updateMany({
    where: { id, status: "pending" },
    data: { status: "parked", dismissReason: "parked" },
  });
  if (updated.count === 0) return "busy";
  revalidatePath("/gates");
  revalidatePath(`/gates/${id}`);
  revalidatePath("/");
  return "ok";
}

/** parked → pending に戻す */
export async function unparkGate(gateId: string): Promise<"ok" | "busy"> {
  await requireAuth();
  const id = gateId.trim();
  if (!id) return "busy";
  const updated = await prisma.gate.updateMany({
    where: { id, status: "parked" },
    data: { status: "pending", dismissReason: null },
  });
  if (updated.count === 0) return "busy";
  revalidatePath("/gates");
  revalidatePath(`/gates/${id}`);
  revalidatePath("/");
  return "ok";
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

/** チュートリアル: サンプル seed を保証 */
export async function ensureTutorialSeedAction(): Promise<{ gateId: string }> {
  await requireAuth();
  const { ensureTutorialSeed } = await import("@/lib/tutorial-seed");
  const r = await ensureTutorialSeed();
  const { recordActivationOnce } = await import("@/lib/activation-funnel");
  recordActivationOnce("sample_started", { gateId: r.gateId });
  revalidatePath("/setup");
  revalidatePath("/");
  revalidatePath("/gates");
  return { gateId: r.gateId };
}

/** チュートリアル: LLM 道を選択 */
export async function setTutorialLlmTrackAction(
  track: "claude" | "cursor" | "codex" | "jumon",
): Promise<void> {
  await requireAuth();
  const { writeTutorialState } = await import("@/lib/tutorial-state");
  writeTutorialState({
    llmTrack: track,
    llmTrackAt: new Date().toISOString(),
    // 道を選び直したら、貼るステップはやり直す
    llmStepDone: false,
  });
  revalidatePath("/setup");
}

/** チュートリアル: コピペ呼び出しを「できた」 */
export async function markTutorialLlmStepDoneAction(): Promise<void> {
  await requireAuth();
  const { writeTutorialState } = await import("@/lib/tutorial-state");
  writeTutorialState({ llmStepDone: true });
  const { recordActivationOnce } = await import("@/lib/activation-funnel");
  recordActivationOnce("mcp_touched", { source: "manual_done" });
  revalidatePath("/setup");
}

/** チュートリアル: hook を今は飛ばす */
export async function skipTutorialHookAction(): Promise<void> {
  await requireAuth();
  const { writeTutorialState } = await import("@/lib/tutorial-state");
  writeTutorialState({
    hookSkipped: true,
    completedAt: new Date().toISOString(),
  });
  revalidatePath("/setup");
  revalidatePath("/");
}

/** チュートリアル完了を確定 */
export async function completeTutorialAction(): Promise<void> {
  await requireAuth();
  const { writeTutorialState } = await import("@/lib/tutorial-state");
  writeTutorialState({ completedAt: new Date().toISOString() });
  const { recordActivationOnce, maybeRecordFirstComplete } = await import(
    "@/lib/activation-funnel"
  );
  const { isTutorialGateSubmitted } = await import("@/lib/tutorial-seed");
  const sampleSubmitted = await isTutorialGateSubmitted();
  const hasVerdict = await prisma.gate.count({
    where: {
      status: {
        in: [
          "passed",
          "failed",
          "self_graded_pass",
          "self_graded_fail",
          "grading_failed",
        ],
      },
    },
  });
  maybeRecordFirstComplete({
    sampleSubmitted,
    mcpTouched: true,
    hasVerdict: hasVerdict > 0,
  });
  if (hasVerdict > 0) recordActivationOnce("first_verdict");
  revalidatePath("/setup");
  revalidatePath("/");
}

/** 監視リポジトリを追加（まだ鉤はかけない） */
export async function addWatchedRepoAction(
  path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { addWatchedRepo } = await import("@/lib/watched-repos");
  const res = addWatchedRepo({ path });
  if (!res.ok) return res;
  revalidatePath("/setup");
  revalidatePath("/");
  return { ok: true };
}

/** 監視リストから外し、可能なら hook marker も外す */
export async function removeWatchedRepoAction(
  path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { disconnectRepoHook, removeWatchedRepo } = await import(
    "@/lib/watched-repos"
  );
  disconnectRepoHook(path);
  const res = removeWatchedRepo(path);
  if (!res.ok) return res;
  revalidatePath("/setup");
  revalidatePath("/");
  return { ok: true };
}

/** 登録済み（または指定 path）に setup-git-hook を適用 */
export async function installWatchedReposAction(opts?: {
  paths?: string[];
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  await requireAuth();
  const {
    installHooksForRepos,
    listWatchedRepos,
    addWatchedRepo,
  } = await import("@/lib/watched-repos");

  let targets: string[] = [];
  if (opts?.paths?.length) {
    for (const p of opts.paths.filter(Boolean)) {
      const added = addWatchedRepo({ path: p });
      if (!added.ok) return { ok: false, error: added.error };
      targets.push(added.repo.path);
    }
  } else {
    targets = listWatchedRepos().map((r) => r.path);
  }
  if (targets.length === 0) {
    return { ok: false, error: "先にリポジトリパスを追加せよ" };
  }
  const res = installHooksForRepos(targets);
  revalidatePath("/setup");
  revalidatePath("/");
  if (!res.ok) {
    return { ok: false, error: res.error ?? (res.output || "install failed") };
  }
  const { recordActivationOnce } = await import("@/lib/activation-funnel");
  recordActivationOnce("hook_installed", { source: "setup_ui" });
  return { ok: true, output: res.output };
}

/** B3-3: 初 CLEAR 後に証跡ナビを出すか */
export async function getEvidenceNavUnlocked(): Promise<boolean> {
  try {
    await requireAuth();
    const { hasFirstClear } = await import("@/lib/first-clear");
    return hasFirstClear();
  } catch {
    return false;
  }
}

/** ADR-0020: 指定日の日次教科書を（再）生成 */
export async function regenerateDailyTextbookAction(dateKey: string) {
  await requireAuth();
  const { generateDailyTextbook } = await import("@/lib/daily-textbook");
  const result = await generateDailyTextbook(dateKey);
  revalidatePath("/retro");
  revalidatePath(`/retro/${dateKey}`);
  return result;
}

/**
 * 材料はあるのに未作成の日を、まとめて教科書化する（LLMなし・手元の規則だけ）。
 * 1日失敗したら全部止める、ではなく日付ごとに成否を返して部分成功を許す。
 */
export async function bulkGenerateDailyTextbooksAction(dateKeys: string[]) {
  await requireAuth();
  const { generateDailyTextbook } = await import("@/lib/daily-textbook");
  const targets = [
    ...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))),
  ].slice(0, 31);
  const done: string[] = [];
  const failed: string[] = [];
  for (const dateKey of targets) {
    try {
      await generateDailyTextbook(dateKey);
      done.push(dateKey);
      revalidatePath(`/retro/${dateKey}`);
    } catch {
      failed.push(dateKey);
    }
  }
  revalidatePath("/retro");
  return { done, failed };
}

/** ADR-0020: 1章だけヘッドレス LLM でスロットを磨く（失敗時は規則文維持） */
export async function polishTextbookChapterAction(
  chapterId: string,
  dateKey: string,
) {
  await requireAuth();
  const { polishTextbookChapter } = await import(
    "@/lib/textbook-chapter-polish"
  );
  const result = await polishTextbookChapter(chapterId);
  revalidatePath(`/retro/${dateKey}`);
  revalidatePath("/retro");
  return result;
}

/** ADR-0020: 確認問いの Mastery を保存 */
export async function setTextbookMasteryAction(
  checkId: string,
  mastery: string,
  dateKey: string,
) {
  await requireAuth();
  const { isMasteryState, setCheckMastery } = await import(
    "@/lib/daily-textbook"
  );
  if (!isMasteryState(mastery)) {
    throw new Error(`invalid mastery: ${mastery}`);
  }
  await setCheckMastery(checkId, mastery);
  revalidatePath(`/retro/${dateKey}`);
  revalidatePath("/retro");
}

/** opt-in 匿名テレメトリの同意トグル（W5-8 #15） */
export async function setTelemetryOptInAction(formData: FormData) {
  await requireAuth();
  const { setTelemetryOptIn } = await import("@/lib/telemetry-consent");
  const optedIn = formData.get("optedIn") === "1";
  setTelemetryOptIn(optedIn);
  revalidatePath("/setup");
}
