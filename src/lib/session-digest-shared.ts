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
