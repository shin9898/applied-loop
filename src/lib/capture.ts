import { after } from "next/server";
import { prisma } from "@/lib/db";
import {
  confirmMisconception,
  parseGateSourceContext,
  type RootCause,
} from "@/lib/gate";
import { suggestLinksForTarget } from "@/lib/goal";
import { observeTextbookCheckGateFollowup } from "@/lib/textbook-check-gate-history";
import {
  checkMisconceptionOverlap,
  computeLinkExistingNextReviewAt,
  encodeOverlapCheckLog,
  isLinkableCandidate,
  MAX_COMPARED,
  selectInterruptCandidates,
} from "@/lib/misconception-overlap";

export type TriageAction = "accept" | "skip";
/** needs_decision を受けた後の2回目呼び出し専用 (ADR-0021) */
export type TriageResolution = "create_new" | "link_existing";

export type TriageOverlapCandidate = {
  id: string;
  concept: string;
  relation: string;
  reason: string;
};

export type TriageResult =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | { ok: "needs_decision"; message: string; candidates: TriageOverlapCandidate[] };

const ALREADY_PROCESSED_RACE: TriageResult = {
  ok: false,
  message: "既に処理済みです（他の呼び出しが先に確定させました）。",
};

/**
 * confirmMisconception を呼び、Capture を accepted + misconceptionId 確定にする共通処理。
 * accept 判定から確定まで LLM 呼び出し（最大 30〜60s）を挟むため、先に status:"pending" を
 * 条件にした updateMany で Capture を「claim」してから作成する（同一 Capture への並行 accept
 * が両方とも Misconception を作ってしまう二重作成レースを防ぐ）。claim に負けたら null を返す。
 */
async function createMisconceptionAndAccept(
  captureId: string,
  title: string,
  gateId: string | null,
  rootCause: RootCause | null,
  overlapCheckJson?: string
): Promise<{ id: string } | null> {
  const acceptedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.capture.updateMany({
      where: { id: captureId, status: "pending" },
      data: {
        status: "accepted",
        reviewedAt: acceptedAt,
        ...(overlapCheckJson !== undefined ? { overlapCheckJson } : {}),
      },
    });
    if (claimed.count === 0) return null;
    const created = await confirmMisconception(title, gateId, rootCause, tx, acceptedAt);
    await tx.capture.update({
      where: { id: captureId },
      data: { misconceptionId: created.id },
    });
    const directFailureCapture = await tx.textbookCheckGateFailureCapture.findUnique({
      where: { captureId },
      select: { id: true },
    });
    if (directFailureCapture !== null) {
      await observeTextbookCheckGateFollowup(tx, {
        failureCaptureId: directFailureCapture.id,
        misconceptionId: created.id,
        scheduledFor: created.nextReviewAt,
        observedAt: acceptedAt,
      });
    }
    return { id: created.id };
  });
}

/**
 * 受信箱の仕分け (ADR-0010)。accept 時は Entry/Misconception 化し、
 * LLM 提案 (goal_suggestions / domain) を after() で起動する。
 *
 * gate 由来 (誤解) の accept は、しれん重複の入口ガード (ADR-0021) を通る:
 * resolution 省略で呼ぶと、既存 Misconception と duplicate × (open|regressed) の
 * 関係が見つかった場合は何も確定させず needs_decision を返す。呼び出し側は
 * resolution ("create_new" | "link_existing") を付けて再度呼び、確定させる。
 * `deps.checkOverlap` はテスト用の差し替え (既定は checkMisconceptionOverlap)。
 */
export async function triageCapture(
  captureId: string,
  action: TriageAction,
  resolution?: TriageResolution,
  misconceptionId?: string,
  deps: { checkOverlap?: typeof checkMisconceptionOverlap } = {}
): Promise<TriageResult> {
  const id = captureId.trim();
  if (!id) return { ok: false, message: "captureId が空です。" };

  const capture = await prisma.capture.findUnique({ where: { id } });
  if (!capture) return { ok: false, message: `Capture が見つかりません (id: ${id})。` };
  if (capture.status !== "pending") {
    return {
      ok: false,
      message: `既に処理済みです (status: ${capture.status})。`,
    };
  }

  if (action === "skip") {
    await prisma.capture.update({
      where: { id },
      data: { status: "ignored", reviewedAt: new Date() },
    });
    return { ok: true, message: `無視しました (id: ${id})。` };
  }

  // accept — gate 由来 (誤解) は重複ガードを経由する
  if (capture.sourceTool === "gate") {
    const { gateId, rootCause } = parseGateSourceContext(capture.sourceContext);

    if (resolution) {
      // 2回目呼び出し。素通りゲート: 1回目の判定ログが無ければ resolution を受理しない
      if (!capture.overlapCheckJson) {
        return {
          ok: false,
          message:
            "resolution は先に accept を呼び needs_decision を受け取った後にのみ有効です。",
        };
      }

      if (resolution === "link_existing") {
        const targetId = misconceptionId?.trim();
        if (!targetId) {
          return {
            ok: false,
            message: "resolution=link_existing には misconceptionId が必要です。",
          };
        }
        // needs_decision で提示した候補以外への紐付けは受理しない。ここを検証しないと
        // refinement/resolved など本来割り込まないはずの Misconception にも紐付けられて
        // しまう back door になる (opus レビュー指摘)
        if (!isLinkableCandidate(capture.overlapCheckJson, targetId)) {
          return {
            ok: false,
            message: `misconceptionId は needs_decision で提示した候補から選んでください (id: ${targetId})。`,
          };
        }
        const target = await prisma.misconception.findUnique({ where: { id: targetId } });
        if (!target) {
          return { ok: false, message: `Misconception が見つかりません (id: ${targetId})。` };
        }
        // gateId が古くて実在しなければ確定自体は止めず、gate 紐付けだけ黙ってスキップする
        // (confirmMisconception と同じ扱い。gate.ts:982-991)
        const linkGate = gateId ? await prisma.gate.findUnique({ where: { id: gateId } }) : null;

        // Capture accept・予約更新・A7-B follow-up evidenceを一つのtransactionに閉じる。
        // これにより後から nextReviewAt が変わっても、accept時点の予約を失わない。
        const acceptedAt = new Date();
        const accepted = await prisma.$transaction(async (tx) => {
          const latestTarget = await tx.misconception.findUnique({
            where: { id: targetId },
            select: { nextReviewAt: true },
          });
          if (latestTarget === null) return false;
          const claimed = await tx.capture.updateMany({
            where: { id, status: "pending" },
            data: { status: "accepted", reviewedAt: acceptedAt, misconceptionId: targetId },
          });
          if (claimed.count === 0) return false;
          const nextReviewAt = computeLinkExistingNextReviewAt(latestTarget.nextReviewAt, acceptedAt);
          await tx.misconception.update({
            where: { id: targetId },
            data: {
              nextReviewAt,
              ...(linkGate ? { gates: { connect: { id: linkGate.id } } } : {}),
            },
          });
          const directFailureCapture = await tx.textbookCheckGateFailureCapture.findUnique({
            where: { captureId: id },
            select: { id: true },
          });
          if (directFailureCapture !== null) {
            await observeTextbookCheckGateFollowup(tx, {
              failureCaptureId: directFailureCapture.id,
              misconceptionId: targetId,
              scheduledFor: nextReviewAt,
              observedAt: acceptedAt,
            });
          }
          return true;
        });
        if (!accepted) return ALREADY_PROCESSED_RACE;
        return {
          ok: true,
          message: `既存の誤解に紐付けました (misconceptionId: ${targetId})。`,
        };
      }

      // create_new
      const createdFromResolution = await createMisconceptionAndAccept(
        id,
        capture.title,
        gateId,
        rootCause
      );
      if (!createdFromResolution) return ALREADY_PROCESSED_RACE;
      return {
        ok: true,
        message: `誤解として登録しました (id: ${id})。72 時間後に再出題されます。`,
      };
    }

    // 1回目呼び出し (resolution 未指定): 重複ガード
    const existing = await prisma.misconception.findMany({
      take: MAX_COMPARED,
      orderBy: { createdAt: "desc" },
      select: { id: true, concept: true, status: true, rootCause: true },
    });

    if (existing.length === 0) {
      // 比較対象が無いので通常通り確定 (v1 と体感は変わらない)
      const created = await createMisconceptionAndAccept(id, capture.title, gateId, rootCause);
      if (!created) return ALREADY_PROCESSED_RACE;
      return {
        ok: true,
        message: `誤解として登録しました (id: ${id})。72 時間後に再出題されます。`,
      };
    }

    const gate = gateId
      ? await prisma.gate.findUnique({ where: { id: gateId }, select: { contextSummary: true } })
      : null;
    const checkOverlap = deps.checkOverlap ?? checkMisconceptionOverlap;
    const outcome = await checkOverlap(
      { title: capture.title, note: capture.note, contextSummary: gate?.contextSummary ?? null },
      existing
    );

    if (!outcome.ok) {
      // fail-open (ADR-0021): ガード失敗でコアループ (うけばこ仕分け) を人質にしない。
      // サイレント失敗にしないよう、ログにも残す (ai-feature-preflight Q7)
      console.error("[misconception-overlap] check failed, fail-open:", outcome.error);
      const created = await createMisconceptionAndAccept(
        id,
        capture.title,
        gateId,
        rootCause,
        encodeOverlapCheckLog({
          comparedIds: existing.map((m) => m.id),
          matches: [],
          checkedAt: new Date().toISOString(),
          error: outcome.error,
        })
      );
      if (!created) return ALREADY_PROCESSED_RACE;
      return {
        ok: true,
        message: `誤解として登録しました (id: ${id})。類似判定は実行できませんでした（${outcome.error}）。未判定のまま新規作成しました。72 時間後に再出題されます。`,
      };
    }

    const interrupting = selectInterruptCandidates(outcome.matches);
    const overlapCheckJson = encodeOverlapCheckLog({
      comparedIds: existing.map((m) => m.id),
      matches: outcome.matches,
      checkedAt: new Date().toISOString(),
    });

    if (interrupting.length > 0) {
      await prisma.capture.update({ where: { id }, data: { overlapCheckJson } });
      return {
        ok: "needs_decision",
        message: "にた ごかいが みつかった。既存に紐付けるか、新規作成するか選べ。",
        candidates: interrupting.map((m) => ({
          id: m.id,
          concept: m.concept,
          relation: m.relation,
          reason: m.reason,
        })),
      };
    }

    // refinement（精緻化）・duplicate×resolved（再発疑い）はどちらも割り込まず素通しだが、
    // ADR-0021 の両方の「注記のみ」行を満たすため一言残す（今までログ列にしか残らず
    // 実質サイレントだった）。status を明示条件に含めるのは自己文書化のため
    // （OverlapMatch.status は string 型で、将来 status 値が増えても安全に「注記なし」へ
    // 縮退させたい。今はこの分岐に残る duplicate は resolved のものだけ）
    const regression = outcome.matches.find(
      (m) => m.relation === "duplicate" && m.status === "resolved"
    );
    const refinement = outcome.matches.find((m) => m.relation === "refinement");
    const created = await createMisconceptionAndAccept(
      id,
      capture.title,
      gateId,
      rootCause,
      overlapCheckJson
    );
    if (!created) return ALREADY_PROCESSED_RACE;
    const note = regression
      ? `既存「${regression.concept}」は解決済みですが、同じ誤解の再発の可能性があります。`
      : refinement
        ? `既存「${refinement.concept}」の精緻化と判定されました。`
        : "";
    return {
      ok: true,
      message: note
        ? `誤解として登録しました (id: ${id})。${note}72 時間後に再出題されます。`
        : `誤解として登録しました (id: ${id})。72 時間後に再出題されます。`,
    };
  }

  const entry = await prisma.entry.create({
    data: {
      title: capture.title,
      note: capture.note,
      kind: "insight",
      source: capture.sourceContext || capture.sourceTool,
    },
  });
  await prisma.capture.update({
    where: { id },
    data: { status: "accepted", reviewedAt: new Date(), entryId: entry.id },
  });

  // ADR-0008: active Goal への紐付け提案 (0 件なら no-op。タイトルのみ渡す)
  after(async () => {
    await suggestLinksForTarget({
      targetType: "entry",
      targetId: entry.id,
      title: entry.title,
    }).catch((e) => console.error("[goal] suggest on accept failed:", e));
  });

  return {
    ok: true,
    message: `学びとして登録しました (entryId: ${entry.id})。目標紐付け提案を非同期で起動しました。`,
  };
}
