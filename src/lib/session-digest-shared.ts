/**
 * 外部セッション・事後ダイジェストの純関数・型 (クライアント可)。DB は session-digest.ts。
 */

export type { SystemKind } from "@/lib/atlas-taxonomy";
import type { SystemKind } from "@/lib/atlas-taxonomy";

export type HarnessRunLike = {
  sessionId: string;
  repo: string | null;
  startedAt: Date;
  endedAt: Date | null;
  tools: string | null;
};

export type CaptureLike = { title: string; capturedAt: Date };
export type GateAnsweredLike = { repo: string | null; answeredAt: Date };
export type DevEventLike = { repo: string; receivedAt: Date };
export type GoalLinkLike = { createdAt: Date };
export type RequirementLinkLike = { createdAt: Date };

export type SessionDigestByRepo = {
  repo: string;
  region: SystemKind | null;
  sessionCount: number;
  captureCount: number;
  /** Capture.title を最大3件、とびら展開部での想起手がかり用 */
  captureSamples: string[];
  gateAnsweredCount: number;
  goalLinkCount: number;
  requirementLinkCount: number;
  commitCount: number;
  sessions: { sessionId: string; startedAt: Date; endedAt: Date | null }[];
};

export type SessionDigest = {
  dateKey: string;
  sessionCount: number;
  repoCount: number;
  byRepo: SessionDigestByRepo[];
  /** HarnessRun.repo が null のセッション数 */
  unresolvedRepoSessionCount: number;
};

export function normalizeRepoKey(repo: string): string {
  return repo.trim().toLowerCase();
}

/** worktree 接頭辞（"{base}-..." / "{base}_..."）を親 repo へ折りたたんで一致判定する */
export function repoKeysMatch(a: string, b: string): boolean {
  const na = normalizeRepoKey(a);
  const nb = normalizeRepoKey(b);
  if (na === nb) return true;
  if (na.length >= 2 && (nb.startsWith(`${na}-`) || nb.startsWith(`${na}_`))) {
    return true;
  }
  if (nb.length >= 2 && (na.startsWith(`${nb}-`) || na.startsWith(`${nb}_`))) {
    return true;
  }
  return false;
}

type ToolUsage = { name?: string };

/**
 * v1ヒューリスティック: applied-loop 自身の repo で、かつ tools が
 * mcp__applied-loop__* のみ（他のツール呼び出しが皆無）なら、
 * アプリ内じゅもん（埋め込みターミナル）由来と判定して除外する。
 * launchd 定期便セッションの判別は将来課題（design doc「外部セッションの定義」参照）。
 */
export function isExternalSession(run: {
  repo: string | null;
  tools: string | null;
}): boolean {
  if (run.repo !== "applied-loop") return true;
  if (!run.tools) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.tools);
  } catch {
    return true;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return true;
  const onlyAppliedLoopMcp = (parsed as ToolUsage[]).every((t) =>
    t.name?.startsWith("mcp__applied-loop__"),
  );
  return !onlyAppliedLoopMcp;
}

export type BuildSessionDigestInput = {
  dateKey: string;
  harnessRuns: HarnessRunLike[];
  captures: CaptureLike[];
  gatesAnswered: GateAnsweredLike[];
  devEvents: DevEventLike[];
  goalLinks: GoalLinkLike[];
  requirementLinks: RequirementLinkLike[];
  /** normalizeRepoKey された repo をキーとする領の解決結果 */
  regionByRepo: Record<string, SystemKind | null>;
};

function newGroup(repo: string, regionByRepo: Record<string, SystemKind | null>): SessionDigestByRepo {
  return {
    repo,
    region: regionByRepo[normalizeRepoKey(repo)] ?? null,
    sessionCount: 0,
    captureCount: 0,
    captureSamples: [],
    gateAnsweredCount: 0,
    goalLinkCount: 0,
    requirementLinkCount: 0,
    commitCount: 0,
    sessions: [],
  };
}

export function buildSessionDigest(input: BuildSessionDigestInput): SessionDigest {
  const {
    dateKey,
    harnessRuns,
    captures,
    gatesAnswered,
    devEvents,
    goalLinks,
    requirementLinks,
    regionByRepo,
  } = input;

  const resolvedRuns = harnessRuns.filter(
    (r): r is HarnessRunLike & { repo: string } => Boolean(r.repo),
  );
  const unresolvedRepoSessionCount = harnessRuns.length - resolvedRuns.length;

  const groups: SessionDigestByRepo[] = [];
  function findOrCreateGroup(repo: string): SessionDigestByRepo {
    const existing = groups.find((g) => repoKeysMatch(g.repo, repo));
    if (existing) return existing;
    const g = newGroup(repo, regionByRepo);
    groups.push(g);
    return g;
  }

  for (const run of resolvedRuns) {
    const g = findOrCreateGroup(run.repo);
    g.sessionCount += 1;
    g.sessions.push({
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
  }

  for (const ev of devEvents) {
    const g = groups.find((g) => repoKeysMatch(g.repo, ev.repo));
    if (g) g.commitCount += 1;
  }

  for (const gate of gatesAnswered) {
    if (!gate.repo) continue;
    const g = groups.find((g) => repoKeysMatch(g.repo, gate.repo!));
    if (g) g.gateAnsweredCount += 1;
  }

  attributeByTimeWindow(groups, resolvedRuns, captures, goalLinks, requirementLinks);

  return {
    dateKey,
    sessionCount: resolvedRuns.length,
    repoCount: groups.length,
    byRepo: groups.sort((a, b) => b.sessionCount - a.sessionCount),
    unresolvedRepoSessionCount,
  };
}

// Task 3 で実装。この Task では no-op。
function attributeByTimeWindow(
  _groups: SessionDigestByRepo[],
  _runs: (HarnessRunLike & { repo: string })[],
  _captures: CaptureLike[],
  _goalLinks: GoalLinkLike[],
  _requirementLinks: RequirementLinkLike[],
): void {
  // Task 3 で実装
}
