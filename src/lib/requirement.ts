import { prisma } from "@/lib/db";

const PASSED_STATUSES = ["passed", "self_graded_pass"] as const;

export type RequirementStatus =
  | "active"
  | "understood"
  | "done"
  | "abandoned";

export type RequirementLinkStatus = "suggested" | "approved";

export type RequirementGateProgress = {
  gateId: string;
  question: string;
  gateStatus: string;
  passed: boolean;
  linkStatus: RequirementLinkStatus;
};

export type RequirementSummary = {
  id: string;
  title: string;
  why: string | null;
  criteria: string | null;
  status: string;
  createdAt: Date;
  approvedGates: RequirementGateProgress[];
  suggestedGateCount: number;
  passedCount: number;
  totalApprovedGates: number;
  allApprovedPassed: boolean;
};

/** active な要件一覧。0 件なら呼び出し側は no-op にできる。 */
export async function listActiveRequirements(): Promise<
  { id: string; title: string; why: string | null; criteria: string | null }[]
> {
  return prisma.requirement.findMany({
    where: { status: "active" },
    select: { id: true, title: true, why: true, criteria: true },
    orderBy: { createdAt: "asc" },
  });
}

function isPassed(status: string): boolean {
  return (PASSED_STATUSES as readonly string[]).includes(status);
}

async function gateProgressForLinks(
  links: { targetType: string; targetId: string; status: string }[]
): Promise<{
  approvedGates: RequirementGateProgress[];
  suggestedGateCount: number;
}> {
  const gateLinks = links.filter((l) => l.targetType === "gate");
  const suggestedGateCount = gateLinks.filter(
    (l) => l.status === "suggested"
  ).length;
  const approved = gateLinks.filter((l) => l.status === "approved");
  if (approved.length === 0) {
    return { approvedGates: [], suggestedGateCount };
  }

  const gates = await prisma.gate.findMany({
    where: { id: { in: approved.map((l) => l.targetId) } },
    select: { id: true, question: true, status: true },
  });
  const byId = new Map(gates.map((g) => [g.id, g]));
  const approvedGates: RequirementGateProgress[] = approved.map((l) => {
    const g = byId.get(l.targetId);
    return {
      gateId: l.targetId,
      question: g?.question ?? "(削除済み理解チェック)",
      gateStatus: g?.status ?? "missing",
      passed: g ? isPassed(g.status) : false,
      linkStatus: "approved",
    };
  });
  return { approvedGates, suggestedGateCount };
}

/** active 要件 + 承認済みゲートの合格状況。未承認リンクは集計に含めない。 */
export async function listRequirementSummaries(
  statuses: RequirementStatus[] = ["active"]
): Promise<RequirementSummary[]> {
  const requirements = await prisma.requirement.findMany({
    where: { status: { in: statuses } },
    include: { links: true },
    orderBy: { createdAt: "desc" },
  });

  const summaries: RequirementSummary[] = [];
  for (const r of requirements) {
    const { approvedGates, suggestedGateCount } = await gateProgressForLinks(
      r.links
    );
    const passedCount = approvedGates.filter((g) => g.passed).length;
    const totalApprovedGates = approvedGates.length;
    summaries.push({
      id: r.id,
      title: r.title,
      why: r.why,
      criteria: r.criteria,
      status: r.status,
      createdAt: r.createdAt,
      approvedGates,
      suggestedGateCount,
      passedCount,
      totalApprovedGates,
      allApprovedPassed:
        totalApprovedGates > 0 && passedCount === totalApprovedGates,
    });
  }
  return summaries;
}

/**
 * 出題プロンプト用。active が 0 件なら null (ゲート生成は従来通り)。
 */
export async function activeRequirementsPromptBlock(): Promise<string | null> {
  const reqs = await listActiveRequirements();
  if (reqs.length === 0) return null;
  const lines = reqs.map((r) => {
    const why = r.why ? ` why:${r.why.slice(0, 120)}` : "";
    const criteria = r.criteria ? ` criteria:${r.criteria.slice(0, 120)}` : "";
    return `- id:${r.id} 「${r.title}」${why}${criteria}`;
  });
  return [
    "関連しそうな要件があれば requirement_suggestions に requirementId の配列で提案せよ (最大3、無ければ [])。",
    "関連が薄い場合は空配列。コード本文は送っていない — 問いの概念と要件タイトルで判断すること。",
    "要件一覧:",
    ...lines,
  ].join("\n");
}

/** LLM 提案の RequirementLink (suggested) を作成。重複は無視。active 0 件なら no-op。 */
export async function createSuggestedRequirementLinks(
  requirementIds: string[],
  target: { targetType: "gate" | "entry"; targetId: string }
): Promise<number> {
  if (requirementIds.length === 0) return 0;
  const activeIds = new Set((await listActiveRequirements()).map((r) => r.id));
  if (activeIds.size === 0) return 0;

  let created = 0;
  for (const requirementId of requirementIds.slice(0, 3)) {
    if (!activeIds.has(requirementId)) continue;
    try {
      await prisma.requirementLink.create({
        data: {
          requirementId,
          targetType: target.targetType,
          targetId: target.targetId,
          status: "suggested",
        },
      });
      created += 1;
    } catch {
      // unique 制約違反など
    }
  }
  return created;
}

/** 採点/出題 JSON の requirement_suggestions を反映。 */
export async function applyRequirementSuggestions(
  ids: unknown,
  target: { targetType: "gate" | "entry"; targetId: string }
): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const requirementIds = ids
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 3);
  await createSuggestedRequirementLinks(requirementIds, target);
}

/**
 * 承認済みゲートリンクが全て pass なら status=understood に更新。
 * 承認済みゲートが 0 件の要件は触らない。
 */
export async function maybeMarkRequirementUnderstood(
  requirementId: string
): Promise<boolean> {
  const req = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: { links: true },
  });
  if (!req || req.status !== "active") return false;

  const approvedGateIds = req.links
    .filter((l) => l.targetType === "gate" && l.status === "approved")
    .map((l) => l.targetId);
  if (approvedGateIds.length === 0) return false;

  const gates = await prisma.gate.findMany({
    where: { id: { in: approvedGateIds } },
    select: { id: true, status: true },
  });
  if (gates.length !== approvedGateIds.length) return false;
  if (!gates.every((g) => isPassed(g.status))) return false;

  await prisma.requirement.update({
    where: { id: requirementId },
    data: { status: "understood", understoodAt: new Date() },
  });
  return true;
}

/** ゲート合格後: 当該ゲートに紐づく active 要件を再評価。 */
export async function refreshRequirementsForGate(
  gateId: string
): Promise<void> {
  const links = await prisma.requirementLink.findMany({
    where: {
      targetType: "gate",
      targetId: gateId,
      status: "approved",
    },
    select: { requirementId: true },
  });
  for (const link of links) {
    await maybeMarkRequirementUnderstood(link.requirementId);
  }
}

export async function approveRequirementLink(linkId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const link = await prisma.requirementLink.findFirst({
    where: { id: linkId, status: "suggested" },
  });
  if (!link) {
    return { ok: false, message: `確認待ちの紐付けが見つかりません (id: ${linkId})。` };
  }
  await prisma.requirementLink.update({
    where: { id: linkId },
    data: { status: "approved" },
  });
  if (link.targetType === "gate") {
    await maybeMarkRequirementUnderstood(link.requirementId);
  }
  return { ok: true, message: `紐付けを承認しました (linkId: ${linkId})。` };
}

export async function rejectRequirementLink(linkId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const link = await prisma.requirementLink.findFirst({
    where: { id: linkId, status: "suggested" },
  });
  if (!link) {
    return { ok: false, message: `確認待ちの紐付けが見つかりません (id: ${linkId})。` };
  }
  await prisma.requirementLink.delete({ where: { id: linkId } });
  return { ok: true, message: `紐付けを却下しました (linkId: ${linkId})。` };
}

/** 手動紐付け (承認済みとして作成)。 */
export async function linkRequirementManual(input: {
  requirementId: string;
  targetType: "gate" | "entry";
  targetId: string;
}): Promise<{ ok: boolean; message: string; linkId?: string }> {
  const req = await prisma.requirement.findUnique({
    where: { id: input.requirementId },
  });
  if (!req) {
    return {
      ok: false,
      message: `要件が見つかりません (id: ${input.requirementId})。`,
    };
  }
  if (input.targetType === "gate") {
    const gate = await prisma.gate.findUnique({ where: { id: input.targetId } });
    if (!gate) {
      return {
        ok: false,
        message: `ゲートが見つかりません (id: ${input.targetId})。`,
      };
    }
  } else {
    const entry = await prisma.entry.findUnique({
      where: { id: input.targetId },
    });
    if (!entry) {
      return {
        ok: false,
        message: `学びが見つかりません (id: ${input.targetId})。`,
      };
    }
  }

  try {
    const link = await prisma.requirementLink.create({
      data: {
        requirementId: input.requirementId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: "approved",
      },
    });
    if (input.targetType === "gate") {
      await maybeMarkRequirementUnderstood(input.requirementId);
    }
    return {
      ok: true,
      message: `紐付けました (linkId: ${link.id})。`,
      linkId: link.id,
    };
  } catch {
    return {
      ok: false,
      message: "同じ紐付けが既に存在します。",
    };
  }
}

/** briefing / ダッシュボード用: 直近に理解確認済みになった要件。 */
export async function recentlyUnderstoodRequirements(
  since: Date,
  limit = 5
): Promise<{ id: string; title: string }[]> {
  return prisma.requirement.findMany({
    where: {
      status: "understood",
      understoodAt: { gte: since },
    },
    select: { id: true, title: true },
    orderBy: { understoodAt: "desc" },
    take: limit,
  });
}

/**
 * 次に進むべき要件候補: active のうち、承認済みゲート未完了または未紐付け。
 * 進捗が少ない順。
 */
export async function nextRequirementCandidates(
  limit = 3
): Promise<RequirementSummary[]> {
  const active = await listRequirementSummaries(["active"]);
  return active
    .filter((r) => !r.allApprovedPassed)
    .sort((a, b) => {
      const aRatio =
        a.totalApprovedGates === 0
          ? -1
          : a.passedCount / a.totalApprovedGates;
      const bRatio =
        b.totalApprovedGates === 0
          ? -1
          : b.passedCount / b.totalApprovedGates;
      if (aRatio !== bRatio) return aRatio - bRatio;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, limit);
}
