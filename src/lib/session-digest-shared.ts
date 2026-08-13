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
  // length >= 2: 1文字の repo 名との偶発一致（例: "a" が "a-b-c" を飲み込む）を避ける下限
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
 * v1ヒューリスティック（design doc「外部セッションの定義」）:
 * - `turns` が極端に少ない（< 2）セッションは launchd 定期便（`claude -p` 等の
 *   cron 実行）とみなし、repo によらず除外する。1ターンの定期便はどの repo で
 *   走っても「手元で LLM を使った」体験ではないため、applied-loop 以外も落とす
 * - applied-loop 自身の repo で、かつ tools が mcp__applied-loop__* のみ
 *   （他のツール呼び出しが皆無）なら、アプリ内じゅもん（埋め込みターミナル）
 *   由来と判定して除外する
 */
export function isExternalSession(run: {
  repo: string | null;
  tools: string | null;
  turns?: number;
}): boolean {
  if (typeof run.turns === "number" && run.turns < 2) return false;
  // normalizeRepoKey 化は大文字小文字の揺れを直すだけで、worktree ディレクトリ名は
  // 直らない（例: このブランチ自身の worktree で走ったセッションは repo が
  // "external-session-digest" になり applied-loop と接頭辞を共有しないため、
  // そもそもこの除外判定に掛からない）。既知の制約として残す。
  if (!run.repo || normalizeRepoKey(run.repo) !== "applied-loop") return true;
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
  /** 集計対象（外部セッションのみ、呼び出し側でフィルタ済み想定） */
  harnessRuns: HarnessRunLike[];
  /**
   * 時間窓の重なり判定にのみ使う全セッション（除外セッションも含む）。省略時は harnessRuns と同じ。
   * 除外セッションが最も特定的だった時刻は「どこにも帰属させない」ためにここへ渡す。
   */
  allRuns?: HarnessRunLike[];
  captures: CaptureLike[];
  gatesAnswered: GateAnsweredLike[];
  devEvents: DevEventLike[];
  goalLinks: GoalLinkLike[];
  requirementLinks: RequirementLinkLike[];
  /** normalizeRepoKey された repo をキーとする領域の解決結果 */
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
    allRuns,
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
  /** 帰属を認めてよいセッション（＝集計対象の外部セッション） */
  const externalSessionIds = new Set(resolvedRuns.map((r) => r.sessionId));
  /** 時間窓判定の母集団。除外セッションも含むので「最も特定的」の判定が正しくなる */
  const resolvedAllRuns = (allRuns ?? harnessRuns).filter(
    (r): r is HarnessRunLike & { repo: string } => Boolean(r.repo),
  );

  const groups: SessionDigestByRepo[] = [];
  function findOrCreateGroup(repo: string): SessionDigestByRepo {
    const existing = groups.find((g) => repoKeysMatch(g.repo, repo));
    if (existing) {
      // Canonicalize: if existing group has a different repo name, adopt the shorter
      // (parent) name and re-resolve region if needed
      if (existing.repo !== repo) {
        const shorter = existing.repo.length < repo.length ? existing.repo : repo;
        if (existing.repo !== shorter) {
          existing.repo = shorter;
          // Re-resolve region using the new canonical repo name
          const newRegion = regionByRepo[normalizeRepoKey(shorter)];
          // Only overwrite if lookup produces a non-null value
          if (newRegion !== null && newRegion !== undefined) {
            existing.region = newRegion;
          }
        }
      }
      return existing;
    }
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
    const repo = gate.repo;
    const g = groups.find((g) => repoKeysMatch(g.repo, repo));
    if (g) g.gateAnsweredCount += 1;
  }

  attributeByTimeWindow(
    groups,
    resolvedAllRuns,
    externalSessionIds,
    captures,
    goalLinks,
    requirementLinks,
  );

  return {
    dateKey,
    sessionCount: resolvedRuns.length,
    repoCount: groups.length,
    byRepo: groups.sort((a, b) => b.sessionCount - a.sessionCount),
    unresolvedRepoSessionCount,
  };
}

/**
 * repo を持たない Capture/GoalLink/RequirementLink を、時間窓が最も短い（＝最も特定的な）
 * セッションへ単一帰属させる。`runs` には除外セッションも含める——除外セッションが勝った時刻は
 * 「より遠い外部セッションへ付け替える」のではなく、どこにも帰属させないのが正しい挙動のため。
 */
function attributeByTimeWindow(
  groups: SessionDigestByRepo[],
  runs: (HarnessRunLike & { repo: string })[],
  externalSessionIds: Set<string>,
  captures: CaptureLike[],
  goalLinks: GoalLinkLike[],
  requirementLinks: RequirementLinkLike[],
): void {
  function findBestRun(timestamp: Date): (HarnessRunLike & { repo: string }) | null {
    let best: (HarnessRunLike & { repo: string }) | null = null;
    let bestDuration = Infinity;
    for (const run of runs) {
      // Window check: timestamp must be >= startedAt and either endedAt is null (open session)
      // or timestamp <= endedAt (closed session)
      if (timestamp < run.startedAt) continue;
      if (run.endedAt && timestamp > run.endedAt) continue;

      // Calculate duration: Infinity for open sessions (endedAt === null),
      // so closed sessions (bounded duration) win tie-breaks
      const duration = run.endedAt
        ? run.endedAt.getTime() - run.startedAt.getTime()
        : Infinity;

      if (duration <= bestDuration) {
        best = run;
        bestDuration = duration;
      }
    }
    return best;
  }

  function groupForRun(run: HarnessRunLike & { repo: string }): SessionDigestByRepo | undefined {
    // 除外セッションが最も特定的だった → どこにも帰属させない（外部セッションへ付け替えない）
    if (!externalSessionIds.has(run.sessionId)) return undefined;
    return groups.find((g) => repoKeysMatch(g.repo, run.repo));
  }

  for (const c of captures) {
    const run = findBestRun(c.capturedAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (!g) continue;
    g.captureCount += 1;
    if (g.captureSamples.length < 3) g.captureSamples.push(c.title);
  }

  for (const gl of goalLinks) {
    const run = findBestRun(gl.createdAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (g) g.goalLinkCount += 1;
  }

  for (const rl of requirementLinks) {
    const run = findBestRun(rl.createdAt);
    if (!run) continue;
    const g = groupForRun(run);
    if (g) g.requirementLinkCount += 1;
  }
}
