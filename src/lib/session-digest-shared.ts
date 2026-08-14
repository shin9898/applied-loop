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

/** セッションの実測時間がこれ未満なら、ターン数に関わらずログの異常値とみなす。
 *  複数ターンの人間の対話が数秒未満に収まるのは物理的にありえないため */
const IMPLAUSIBLE_DURATION_MS = 10 * 1000;

/**
 * 実測時間が {@link IMPLAUSIBLE_DURATION_MS} 未満（例: 実測1ミリ秒）のセッションは、
 * `turns` の値に関わらず収集側のログ異常値とみなす。実データで `sessionId
 * "privacy-probe-session"`（診断用と思われる疑似レコード）が `turns=2` かつ
 * 実測1ミリ秒で `isExternalSession` の cron 判定をすり抜けて表示され、さらに
 * `buildSessionDigest` の時間窓アトリビューションで「最も特定的な窓」として
 * 実在の18分セッションより優先され、正当な学びの帰属を奪う実害が確認された。
 * このため `isExternalSession`（cron/じゅもん判定）とは別軸の独立した判定として、
 * `buildSessionDigest` が集計対象・時間窓判定の母集団の両方から完全に除く。
 */
export function isImplausibleSession(run: {
  startedAt?: Date;
  endedAt?: Date | null;
}): boolean {
  if (!run.startedAt || !run.endedAt) return false;
  const durationMs = run.endedAt.getTime() - run.startedAt.getTime();
  return durationMs < IMPLAUSIBLE_DURATION_MS;
}

/**
 * v1ヒューリスティック（design doc「外部セッションの定義」）:
 * - `turns` が極端に少なく（< 2）かつセッション時間が5分未満のセッションは launchd
 *   定期便相当とみなし除外する。時間が不明（進行中セッション等）な場合や、低ターン数
 *   でも長時間動いたセッション（fire-and-forget 型のエージェント実行等）は除外しない。
 *   実データ計測で `turns < 2` 単体は「実質的な」セッション（5分以上・ツール呼び出し
 *   10件以上）の73%を誤って落とすことが判明したための修正（`HarnessRun.turns` は
 *   人間の会話ターンのみを数えており、長時間の自律実行やヘッドレス実行では低いまま
 *   になりうる）
 * - applied-loop 自身の repo で、かつ tools が mcp__applied-loop__* のみ
 *   （他のツール呼び出しが皆無）なら、アプリ内じゅもん（埋め込みターミナル）
 *   由来と判定して除外する
 */
export function isExternalSession(run: {
  repo: string | null;
  tools: string | null;
  turns?: number;
  startedAt?: Date;
  endedAt?: Date | null;
}): boolean {
  const durationMs =
    run.startedAt && run.endedAt
      ? run.endedAt.getTime() - run.startedAt.getTime()
      : null;

  if (typeof run.turns === "number" && run.turns < 2) {
    // duration が不明（進行中セッション等）な場合は「短い」と決めつけず除外しない。
    // 5分未満かつ低ターン数のみを cron 定期便相当として除外する
    if (durationMs !== null && durationMs < 5 * 60 * 1000) return false;
  }
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
    harnessRuns: rawHarnessRuns,
    allRuns: rawAllRuns,
    captures,
    gatesAnswered,
    devEvents,
    goalLinks,
    requirementLinks,
    regionByRepo,
  } = input;

  // 異常値セッション（実測時間が極端に短い等、収集ログの不整合）は集計対象からも
  // 時間窓判定の母集団からも完全に除く。isExternalSession の cron 除外セッションとは
  // 異なり、「最も特定的な窓」の候補にすらなってはいけないデータのため
  const harnessRuns = rawHarnessRuns.filter((r) => !isImplausibleSession(r));
  const allRuns = rawAllRuns?.filter((r) => !isImplausibleSession(r));

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
 * セッション終了後、学び等の反映がこの猶予時間内に起きた場合はそのセッションの
 * 窓内とみなす。実データで「セッション終了3分後に Capture が発生し無帰属になる」
 * 事象が確認されたための緩和（学びの記録は事後処理のため、セッション終了と
 * 完全に同時にはならない）
 */
const ATTRIBUTION_GRACE_MS = 10 * 60 * 1000;

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
      // or timestamp <= endedAt + ATTRIBUTION_GRACE_MS (closed session, with grace period)
      if (timestamp < run.startedAt) continue;
      if (
        run.endedAt &&
        timestamp.getTime() > run.endedAt.getTime() + ATTRIBUTION_GRACE_MS
      ) {
        continue;
      }

      // Calculate duration: Infinity for open sessions (endedAt === null),
      // so closed sessions (bounded duration) win tie-breaks. Duration is the
      // session's ACTUAL span, not grace-extended, so a short session still
      // wins the tie-break over a longer session whose grace period also
      // happens to cover the same timestamp.
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
