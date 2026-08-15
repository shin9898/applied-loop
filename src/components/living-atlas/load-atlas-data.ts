/**
 * Data loaders for Living Atlas pages.
 * Prisma + existing lib helpers → Atlas component props.
 */
import { prisma } from "@/lib/db";
import { resolvedGrowthStats } from "@/lib/heatmap";
import { recordStreak } from "@/lib/stats";
import { weeklyEvidenceCounts } from "@/lib/goal";
import { repoCacheReadRates } from "@/lib/harness-stats";
import { listMaterialCaptureHealth } from "@/lib/daily-textbook";
import {
  findWatchedForHarnessRepo,
  findWatchedForRepoPath,
  pickRateForWatched,
  repoPathIsUnderWatched,
  watchedDisplayName,
} from "@/lib/harness-repo-match";
import { listWatchedRepos } from "@/lib/watched-repos";
import {
  nextRequirementCandidates,
  recentlyUnderstoodRequirements,
} from "@/lib/requirement";
import { buildGateDebrief } from "@/lib/grade-payload";
import {
  classifySystem,
  domainDisplay,
  placeFrom,
  shortTitle,
  systemLabel,
  type SystemKind,
} from "@/lib/atlas-taxonomy";
import {
  adventurerLevelFromResolved,
  starsFromCount,
  type SystemStar,
} from "@/lib/atlas-level";
import { enrichMissingGateDomains } from "@/lib/place-enrich";
import { buildSessionDigestForDate } from "@/lib/session-digest";
import { dayStartJST, dateKeyJST } from "@/lib/date";
import type { AtlasDashboardProps } from "./atlas-dashboard";
import type { ZukanItem } from "./atlas-zukan";
import type { GateListItem } from "./atlas-gates-list";
import type { HarnessRepo } from "./atlas-harness";
import type { GoalItem } from "./atlas-goals";
import type { EntryItem } from "./atlas-entries";
import type { UkebakoBoard } from "./ukebako-view";
import type { RequirementItem } from "./atlas-requirements";

const GOAL_EVIDENCE_TARGET = 3;

function mapGateStatus(status: string): GateListItem["status"] {
  if (status === "pending") return "pending";
  if (status === "parked") return "parked";
  if (status === "answered" || status === "grading") return "grading";
  if (status === "grading_failed") return "grading_failed";
  if (status === "passed" || status === "self_graded_pass") return "passed";
  return "failed";
}

function domainLabel(domain: string | null | undefined): string {
  if (!domain) return "未解明帯";
  return domainDisplay(domain);
}

function mapInitialVerdict(
  status: string,
): "pass" | "retry" | "grading_failed" | null {
  if (status === "passed" || status === "self_graded_pass") return "pass";
  if (status === "grading_failed") return "grading_failed";
  if (status === "failed" || status === "self_graded_fail") {
    return "retry";
  }
  return null;
}

function harnessHealth(
  declineRatio: number,
  thisWeekRate: number,
  insufficientThisWeek?: boolean,
): HarnessRepo["health"] {
  if (insufficientThisWeek) return "ok";
  if (declineRatio >= 0.25 || thisWeekRate < 0.15) return "bad";
  if (declineRatio >= 0.1 || thisWeekRate < 0.35) return "warn";
  return "ok";
}

const HOME_STAR_SYSTEMS: SystemKind[] = [
  "cache",
  "harness",
  "design",
  "knowledge",
  "verification",
  "premise",
];

async function loadSystemStars(): Promise<SystemStar[]> {
  const [gates, misc] = await Promise.all([
    prisma.gate.findMany({
      where: { status: { in: ["passed", "self_graded_pass"] } },
      take: 100,
      select: { domain: true, question: true, targetConcept: true },
      orderBy: { gradedAt: "desc" },
    }),
    prisma.misconception.findMany({
      where: { status: "resolved" },
      take: 80,
      select: { concept: true, rootCause: true },
      orderBy: { resolvedAt: "desc" },
    }),
  ]);

  const counts = new Map<SystemKind, number>();
  for (const kind of HOME_STAR_SYSTEMS) counts.set(kind, 0);

  for (const g of gates) {
    const s = classifySystem({
      text: g.question,
      domain: g.domain,
      targetConcept: g.targetConcept,
    });
    if (!counts.has(s)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const m of misc) {
    const s = classifySystem({
      text: m.concept,
      rootCause: m.rootCause,
    });
    if (!counts.has(s)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  return HOME_STAR_SYSTEMS.map((key) => {
    const count = counts.get(key) ?? 0;
    return {
      key,
      label: systemLabel(key),
      count,
      stars: starsFromCount(count),
    };
  }).filter((s) => s.count > 0 || ["cache", "harness", "design", "knowledge"].includes(s.key));
}

export async function loadHomeProps(): Promise<AtlasDashboardProps> {
  const now = new Date();
  // briefing を呼ばない日でも due 再出題を消化 (ADR-0006)
  const { scheduleDueGates } = await import("@/lib/gate");
  await scheduleDueGates().catch((e) =>
    console.error("[home] scheduleDueGates failed:", e),
  );

  const { getWeaknessPatternsForDashboard } = await import("@/lib/weakness");

  const { loadTextbookGuidanceForToday } = await import(
    "@/lib/textbook-guidance"
  );

  const [
    growth,
    streakDays,
    pendingGate,
    pendingGateCount,
    pendingCaptureCount,
    openMisconceptionCount,
    weakRepos,
    systemStars,
    weaknesses,
    textbookGuide,
    sessionDigest,
  ] = await Promise.all([
    resolvedGrowthStats(now),
    recordStreak(now),
    prisma.gate.findFirst({
      where: {
        status: "pending",
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { repo: true, summary: true } },
      },
    }),
    prisma.gate.count({
      where: {
        status: "pending",
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
      },
    }),
    prisma.capture.count({ where: { status: "pending" } }),
    prisma.misconception.count({
      where: { status: { in: ["open", "regressed"] } },
    }),
    repoCacheReadRates(now, { take: 1 }),
    loadSystemStars(),
    getWeaknessPatternsForDashboard(),
    loadTextbookGuidanceForToday(dateKeyJST(now)),
    buildSessionDigestForDate(dateKeyJST(now)),
  ]);

  const todos: { title: string; meta: string; href?: string; cta?: string }[] =
    [];
  if (textbookGuide.guidance) {
    todos.push({
      title: `① ${textbookGuide.guidance.title}`,
      meta: textbookGuide.guidance.label,
      href: textbookGuide.guidance.href,
      cta: textbookGuide.guidance.label,
    });
  }
  if (pendingGate) {
    todos.push({
      title: `${todos.length === 0 ? "①" : "②"} 未クリアゲートを1つ解く`,
      meta: "『たたかう』→ じゅもん（LLM）で回答",
      href: `/gates/${pendingGate.id}`,
      cta: "しれんへ",
    });
  }
  if (pendingCaptureCount > 0) {
    todos.push({
      title: "② 受信箱の学びを仕分ける",
      meta: `にっき → 未仕分け ${pendingCaptureCount} 件`,
      href: "/entries",
      cta: "うけばこへ",
    });
  }
  if (weaknesses && weaknesses.length > 0) {
    todos.push({
      title: `③ よわい観点「${weaknesses[0].aspect}」を意識して解く`,
      meta: `欠落率 ${Math.round(weaknesses[0].missRate * 100)}%`,
      href: "/gates",
      cta: "しれんへ",
    });
  } else if (weakRepos[0]) {
    todos.push({
      title: "③ 弱ってる repo の処方を見る",
      meta: `どうぐ → ${weakRepos[0].repo}`,
      href: "/harness",
      cta: "どうぐへ",
    });
  } else if (openMisconceptionCount > 0) {
    todos.push({
      title: "③ ずかんで未解明を見返す",
      meta: `開いているつまずき ${openMisconceptionCount} 件`,
      href: "/zukan",
      cta: "ずかんへ",
    });
  }
  if (todos.length === 0) {
    todos.push({
      title: "いま出題待ちのしれんはない",
      meta: "学びを capture するか、どうぐを点検せよ",
    });
  }

  const place = pendingGate
    ? placeFrom(pendingGate.event?.repo, pendingGate.domain)
    : null;
  const system = pendingGate
    ? classifySystem({
        text: pendingGate.question,
        domain: pendingGate.domain,
        targetConcept: pendingGate.targetConcept,
      })
    : null;

  const adventurer = adventurerLevelFromResolved(growth.totalResolved);

  return {
    resolvedTotal: growth.totalResolved,
    thisWeekDelta: growth.thisWeekDelta,
    streakDays,
    adventurer,
    systemStars,
    weaknesses,
    pendingGate: pendingGate
      ? {
          id: pendingGate.id,
          question: pendingGate.question,
          title: shortTitle(
            pendingGate.question,
            pendingGate.targetConcept ?? pendingGate.contextSummary,
          ),
          context: place?.label,
          domain: pendingGate.domain,
          system: system ? systemLabel(system) : undefined,
          systemKey: system ?? undefined,
          tags: pendingGate.targetConcept
            ? [pendingGate.targetConcept]
            : undefined,
        }
      : null,
    pendingGateCount,
    todos,
    textbookGuidance: textbookGuide.guidance,
    sessionDigest,
  };
}

export async function loadZukanDetail(id: string): Promise<{
  id: string;
  concept: string;
  status: "clear" | "open" | "fog";
  rootCause: string | null;
  system: SystemKind;
  repo: string | null;
  domain: string | null;
  gateId: string | null;
  gateQuestion: string | null;
  createdAt: Date;
} | null> {
  if (!id) return null;
  const m = await prisma.misconception.findUnique({
    where: { id },
    include: {
      gates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          domain: true,
          question: true,
          targetConcept: true,
          event: { select: { repo: true } },
        },
      },
    },
  });
  if (!m) return null;
  const gate = m.gates[0];
  const status =
    m.status === "resolved" ? ("clear" as const) : m.status === "regressed" ? ("fog" as const) : ("open" as const);
  const system = classifySystem({
    text: m.concept,
    domain: gate?.domain,
    rootCause: m.rootCause,
    targetConcept: gate?.targetConcept,
  });
  return {
    id: m.id,
    concept: m.concept,
    status,
    rootCause: m.rootCause,
    system,
    repo: gate?.event?.repo ?? null,
    domain: gate?.domain ?? null,
    gateId: gate?.id ?? null,
    gateQuestion: gate?.question ?? null,
    createdAt: m.createdAt,
  };
}

export async function loadZukanItems(): Promise<ZukanItem[]> {
  await enrichMissingGateDomains({ take: 40 }).catch((e) =>
    console.error("[place-enrich] zukan enrich failed:", e),
  );
  const misconceptions = await prisma.misconception.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 80,
    include: {
      gates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          domain: true,
          question: true,
          targetConcept: true,
          event: { select: { repo: true } },
        },
      },
    },
  });

  return misconceptions.map((m) => {
    const gate = m.gates[0];
    const status: ZukanItem["status"] =
      m.status === "resolved" ? "clear" : m.status === "regressed" ? "fog" : "open";
    const place = placeFrom(gate?.event?.repo, gate?.domain);
    const system = classifySystem({
      text: m.concept,
      domain: gate?.domain,
      rootCause: m.rootCause,
      targetConcept: gate?.targetConcept,
    });
    return {
      id: m.id,
      title: shortTitle(m.concept, null, 48),
      placeLabel: place.label,
      repo: gate?.event?.repo ?? null,
      domain: gate?.domain ?? null,
      system,
      gateId: gate?.id ?? null,
      status,
      summary:
        status === "clear"
          ? "CLEAR済み"
          : status === "fog"
            ? "ふたたびもや"
            : "未クリア",
    };
  });
}

function mapGateRow(g: {
  id: string;
  question: string;
  status: string;
  domain: string | null;
  targetConcept: string | null;
  contextSummary: string | null;
  event: { repo: string } | null;
  kind?: string | null;
  createdAt?: Date | null;
  gradedAt?: Date | null;
}): GateListItem {
  const place = placeFrom(g.event?.repo, g.domain);
  const system = classifySystem({
    text: g.question,
    domain: g.domain,
    targetConcept: g.targetConcept,
  });
  return {
    id: g.id,
    title: shortTitle(g.question, g.targetConcept ?? g.contextSummary),
    question: g.question,
    status: mapGateStatus(g.status),
    repo: g.event?.repo ?? null,
    domain: g.domain,
    placeLabel: place.label,
    system,
    kind: g.kind ?? null,
    createdAt: g.createdAt ? g.createdAt.toISOString() : null,
    gradedAt: g.gradedAt ? g.gradedAt.toISOString() : null,
  };
}

export async function loadGateList(): Promise<{
  items: GateListItem[];
  parkedItems: GateListItem[];
  pendingBacklogCount: number;
}> {
  // 表示前に空 domain をヒューリスティックで埋める（霧帯を減らす）
  await enrichMissingGateDomains({ take: 60 }).catch((e) =>
    console.error("[place-enrich] gate list enrich failed:", e),
  );
  return queryGateList();
}

/**
 * enrich を挟まない軽い版。バトル画面が「つぎのまものへ」を組み立てるとき用
 * （一覧を開いた時点で enrich 済みなので、1 体ごとに走らせる必要はない）。
 */
export async function loadGateListLight(): Promise<{
  items: GateListItem[];
  parkedItems: GateListItem[];
  pendingBacklogCount: number;
}> {
  return queryGateList();
}

async function queryGateList(): Promise<{
  items: GateListItem[];
  parkedItems: GateListItem[];
  pendingBacklogCount: number;
}> {
  const now = new Date();
  const [active, history, parked, pendingBacklogCount] = await Promise.all([
    prisma.gate.findMany({
      where: {
        status: { in: ["pending", "answered", "grading", "grading_failed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { event: { select: { repo: true } } },
    }),
    prisma.gate.findMany({
      where: {
        status: {
          in: ["passed", "failed", "self_graded_pass", "self_graded_fail"],
        },
      },
      orderBy: { gradedAt: "desc" },
      take: 12,
      include: { event: { select: { repo: true } } },
    }),
    prisma.gate.findMany({
      where: { status: "parked" },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { event: { select: { repo: true } } },
    }),
    prisma.gate.count({ where: { status: "pending" } }),
  ]);

  const rows = [...active, ...history];
  const items = rows
    .filter((g) => {
      if (g.status !== "pending") return true;
      return !g.nextReviewAt || g.nextReviewAt <= now;
    })
    .map(mapGateRow);

  return {
    items,
    parkedItems: parked.map(mapGateRow),
    pendingBacklogCount,
  };
}

function harnessCriteria(
  health: HarnessRepo["health"],
  r: {
    thisWeekRate: number;
    lastWeekRate: number;
    declineRatio: number;
    insufficientThisWeek: boolean;
  },
): { criteria: string; uplift: string } {
  const pct = Math.round(r.thisWeekRate * 100);
  const last = Math.round(r.lastWeekRate * 100);
  if (r.insufficientThisWeek) {
    return {
      criteria: `判定: 安（暫定）。今週の有効観測が薄いため悪化扱いしない。先週 cache ${last}%。`,
      uplift: "同じ repo で継続セッションを回し、観測を溜めたうえで処方チェックリストを1つやれ。",
    };
  }
  if (health === "bad") {
    return {
      criteria: `判定: 危。前週比悪化≥25% または cache<15%（今週 ${pct}% / 先週 ${last}%）。`,
      uplift: "処方のチェックリストから安定プレフィックスを直せ。",
    };
  }
  if (health === "warn") {
    return {
      criteria: `判定: 注。前週比悪化≥10% または cache<35%（今週 ${pct}% / 先週 ${last}%）。`,
      uplift: "可変メモが先頭に混ざっていないか処方で確認し、1項目直せ。",
    };
  }
  return {
    criteria: `判定: 安。前週比悪化<10% かつ cache≥35%（今週 ${pct}% / 先週 ${last}%）。`,
    uplift:
      "問題なし＝維持ライン。80%超を狙うなら先頭のバイト安定と可変節の分離を処方で点検せよ。",
  };
}

function harnessNextAction(
  health: HarnessRepo["health"],
  repo: string,
): { label: string; href: string } {
  const prescriptionHref = `/harness/prescriptions/${encodeURIComponent(repo)}`;
  if (health === "bad") {
    return { label: "処方をひらく", href: prescriptionHref };
  }
  if (health === "warn") {
    return { label: "処方を確認", href: prescriptionHref };
  }
  // 良好でも「なぜ安か／どう上げるか」は処方詳細で見せる
  return { label: "見立てを見る", href: prescriptionHref };
}

type RateRow = Awaited<ReturnType<typeof repoCacheReadRates>>[number];

function mapMeasuredHarnessRepo(
  r: RateRow,
  tier: HarnessRepo["tier"],
  extras?: { commitCountToday?: number; id?: string; name?: string },
): HarnessRepo {
  const health = harnessHealth(
    r.declineRatio,
    r.thisWeekRate,
    r.insufficientThisWeek,
  );
  const pct = Math.round(r.thisWeekRate * 100);
  const { criteria, uplift } = harnessCriteria(health, r);
  const note = r.insufficientThisWeek
    ? `今週の LLM セッション計測はまだ薄い。先週 cache ${Math.round(r.lastWeekRate * 100)}%。`
    : health === "bad"
      ? `cache ${pct}%・低下ぎみ。処方を確認せよ。`
      : health === "warn"
        ? `cache ${pct}%。様子を見つつ処方を覗け。`
        : `cache ${pct}%。維持ラインはクリア。より良くする余地を処方で見よ。`;
  const name = extras?.name ?? r.repo;
  const next = harnessNextAction(health, r.repo);
  return {
    id: extras?.id ?? r.repo,
    name,
    health,
    note,
    tier,
    measured: true,
    commitCountToday: extras?.commitCountToday,
    criteria,
    uplift,
    prescriptionHref: `/harness/prescriptions/${encodeURIComponent(r.repo)}`,
    nextAction: next,
  };
}

function mapUnmeasuredWatchedRepo(input: {
  id: string;
  name: string;
  commitCountToday: number;
}): HarnessRepo {
  const commitNote =
    input.commitCountToday > 0
      ? `今日の commit ${input.commitCountToday} 件は観測済み。`
      : "今日の commit 観測はまだない。";
  return {
    id: input.id,
    name: input.name,
    health: "ok",
    note: `監視中・LLM セッション計測なし。${commitNote}`,
    tier: "watched",
    measured: false,
    commitCountToday: input.commitCountToday,
    criteria:
      "判定: 安（暫定）。git hook は監視中だが、HarnessRun の週次 cache レートがまだ無い。",
    uplift:
      "この repo でエージェント作業を回すと計測が溜まる。％は commit 量ではなく LLM セッション計測じゃ。",
    prescriptionHref: `/harness/prescriptions/${encodeURIComponent(input.name)}`,
    nextAction: { label: "見立てを見る", href: `/harness/prescriptions/${encodeURIComponent(input.name)}` },
  };
}

type DevEventCountRow = { repo: string; repoPath: string | null; count: number };

async function todayDevEventCountsByRepo(): Promise<DevEventCountRow[]> {
  const start = dayStartJST();
  const rows = await prisma.devEvent.groupBy({
    by: ["repo", "repoPath"],
    where: { receivedAt: { gte: start } },
    _count: { _all: true },
  });
  return rows.map((r) => ({
    repo: r.repo,
    repoPath: r.repoPath,
    count: r._count._all,
  }));
}

/**
 * repo 名の接頭辞一致（`{basename}-...`）で拾えない worktree も、`repoPath` が
 * 監視パス配下にあれば同じ repo として扱う。
 * 例: `~/Desktop/triplethree/worktrees/report-line-messaging-infra-20260805` のように
 * worktree ディレクトリ名が親 repo 名を接頭辞に持たない命名でも、gitのtoplevel絶対パスは
 * 監視パスのサブディレクトリになっているため拾える（2026-08-14、実データで取りこぼしを確認）
 */
function commitCountForWatched(
  w: { path: string; label?: string },
  counts: DevEventCountRow[],
): number {
  let total = 0;
  for (const { repo, repoPath, count } of counts) {
    const matchesByName = findWatchedForHarnessRepo(repo, [w]) !== null;
    const matchesByPath = !matchesByName && repoPathIsUnderWatched(repoPath, w);
    if (matchesByName || matchesByPath) total += count;
  }
  return total;
}

function sortByHealth(repos: HarnessRepo[]): HarnessRepo[] {
  const rank = { bad: 0, warn: 1, ok: 2 } as const;
  return [...repos].sort((a, b) => rank[a.health] - rank[b.health]);
}

/**
 * どうぐの repo 一覧。
 * 本線 = 監視リポジトリ（計測ゼロでも出す）。
 * 下段 = 観測外だが HarnessRun 計測がある「計測だけで見えた」。
 */
export async function loadHarnessRepos(): Promise<HarnessRepo[]> {
  const watched = listWatchedRepos();
  const [rates, commitCounts, recent] = await Promise.all([
    repoCacheReadRates(new Date(), { take: 40 }),
    todayDevEventCountsByRepo().catch(() => [] as DevEventCountRow[]),
    prisma.harnessRun.findMany({
      where: { repo: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 40,
      select: { repo: true },
    }),
  ]);

  const rateByRepo = new Map(rates.map((r) => [r.repo, r]));
  const measuredRepoNames = new Set<string>([
    ...rates.map((r) => r.repo),
    ...recent
      .map((r) => r.repo?.trim())
      .filter((n): n is string => !!n),
  ]);
  // repo 名の接頭辞一致で拾えない worktree を「未契約」に誤分類しないための
  // repoPath 逆引き（commitCounts にしか repoPath が無いため、HarnessRun 由来の
  // 名前しか無い repo はこの経路では救えない）
  const repoPathByName = new Map<string, string>();
  for (const { repo, repoPath } of commitCounts) {
    if (repoPath && !repoPathByName.has(repo)) repoPathByName.set(repo, repoPath);
  }
  const isCoveredByWatched = (repoName: string): boolean => {
    if (findWatchedForHarnessRepo(repoName, watched)) return true;
    return findWatchedForRepoPath(repoPathByName.get(repoName), watched) !== null;
  };

  const watchedRows: HarnessRepo[] = watched.map((w) => {
    const display = watchedDisplayName(w);
    const commits = commitCountForWatched(w, commitCounts);
    const rate = pickRateForWatched(w, rates);
    if (rate) {
      return mapMeasuredHarnessRepo(rate, "watched", {
        id: `watched:${w.path}`,
        name: display,
        commitCountToday: commits,
      });
    }
    return mapUnmeasuredWatchedRepo({
      id: `watched:${w.path}`,
      name: display,
      commitCountToday: commits,
    });
  });

  const discoveredRows: HarnessRepo[] = [];
  for (const repoName of measuredRepoNames) {
    if (isCoveredByWatched(repoName)) continue;
    const rate = rateByRepo.get(repoName);
    if (rate) {
      discoveredRows.push(mapMeasuredHarnessRepo(rate, "discovered"));
    } else {
      const next = harnessNextAction("ok", repoName);
      discoveredRows.push({
        id: `discovered:${repoName}`,
        name: repoName,
        health: "ok",
        note: "計測だけで見えた（未監視）。週次レートはまだ薄い。",
        tier: "discovered",
        measured: true,
        criteria: "判定: 安（暫定）。HarnessRun はあるが有効な週次レートが足りない。",
        uplift: "監視に入れるならどうぐ設定へ。％は commit 量ではなく LLM セッション計測じゃ。",
        prescriptionHref: `/harness/prescriptions/${encodeURIComponent(repoName)}`,
        nextAction: next,
      });
    }
    if (discoveredRows.length >= 12) break;
  }

  return [...sortByHealth(watchedRows), ...sortByHealth(discoveredRows)];
}

export type MaterialCaptureHealth = {
  days: { dateKey: string; materialCount: number; droppedCount: number }[];
  inboxPending: number;
  inboxExpired: number;
};

/**
 * どうぐの一次シグナル: ぼうけんのしょの核（ADR-0020）が
 * 材料（commit / セッション学び）を漏れなく拾えているか。
 */
export async function loadMaterialCaptureHealth(): Promise<MaterialCaptureHealth> {
  const [days, inboxPending, inboxExpired] = await Promise.all([
    listMaterialCaptureHealth(14),
    prisma.capture.count({ where: { status: "pending" } }),
    prisma.capture.count({ where: { status: "expired" } }),
  ]);
  return { days, inboxPending, inboxExpired };
}

function parseFocusDomains(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && !!x.trim());
  } catch {
    return [];
  }
}

function goalNextAction(input: {
  id: string;
  thin: boolean;
  evidenceCount: number;
  evidenceTarget: number;
  focusDomains: string[];
}): { label: string; href: string; reason: string } {
  // 証跡の「登録」はアプリUIではなく MCP。詳細ページに手順を置く（誤解防止）
  if (input.thin || input.evidenceCount === 0) {
    return {
      label: "証跡の残し方を見る",
      href: `/goals/${input.id}`,
      reason:
        "今週まだ証跡がない。登録は MCP（record_application 等）。にっきは棚であってフォームではないぞ。",
    };
  }
  if (input.evidenceCount < input.evidenceTarget) {
    return {
      label: "しれんでCLEARを積む",
      href: "/gates",
      reason: `証跡 ${input.evidenceCount}/${input.evidenceTarget}。CLEAR も証跡になる。手順は詳細でも確認できる。`,
    };
  }
  if (input.focusDomains.length > 0) {
    return {
      label: "ずかんで領を見返す",
      href: "/zukan",
      reason: `focus: ${input.focusDomains.slice(0, 2).join("・")}。つまずき棚を確認せよ。`,
    };
  }
  return {
    label: "詳細をひらく",
    href: `/goals/${input.id}`,
    reason: "証跡は足りておる。詳細で次の一手を決めよ。",
  };
}

export async function loadGoals(): Promise<GoalItem[]> {
  const goals = await prisma.goal.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
  });
  const counts = await Promise.all(
    goals.map((g) => weeklyEvidenceCounts(g.id)),
  );

  return goals.map((g, i) => {
    const c = counts[i]!;
    const evidenceCount =
      c.entries + c.applications + c.resolvedMisconceptions;
    const evidenceTarget = GOAL_EVIDENCE_TARGET;
    const thin = evidenceCount === 0;
    const focusDomains = parseFocusDomains(g.focusDomains);
    const nextAction = goalNextAction({
      id: g.id,
      thin,
      evidenceCount,
      evidenceTarget,
      focusDomains,
    });
    return {
      id: g.id,
      code: `G${i + 1}`,
      title: g.title,
      period: g.period,
      kdi: g.kdi,
      focusDomains,
      evidenceCount,
      evidenceTarget,
      thin,
      nextAction,
    };
  });
}

function entryDayKey(d: Date): string {
  return dateKeyJST(d);
}

function entryDayLabel(d: Date, now: Date): string {
  const key = dateKeyJST(d);
  const today = dateKeyJST(now);
  const yesterday = dateKeyJST(new Date(dayStartJST(now).getTime() - 86400000));
  if (key === today) return "きょう";
  if (key === yesterday) return "きのう";
  // 今週（月曜始まり簡易: 直近6日）
  const ageDays = Math.floor(
    (dayStartJST(now).getTime() - dayStartJST(d).getTime()) / 86400000,
  );
  if (ageDays >= 0 && ageDays < 7) return "今週";
  return key; // YYYY-MM-DD
}

export async function loadEntries(): Promise<EntryItem[]> {
  const now = new Date();
  const [entries, pendingCaptures] = await Promise.all([
    prisma.entry.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        applications: { select: { id: true, createdAt: true } },
      },
    }),
    prisma.capture.findMany({
      where: { status: "pending" },
      orderBy: [{ importanceScore: "desc" }, { capturedAt: "desc" }],
      take: 15,
      select: {
        id: true,
        title: true,
        note: true,
        sourceTool: true,
        sourceContext: true,
        capturedAt: true,
        importanceScore: true,
        triageReason: true,
      },
    }),
  ]);

  const pendingItems: EntryItem[] = pendingCaptures.map((c) => ({
    id: c.id,
    title: shortTitle(c.title, null, 48),
    source: c.sourceTool || "inbox",
    kind: "capture" as const,
    pending: true,
    placeLabel: "受信箱",
    system: "other" as SystemKind,
    at: c.capturedAt,
    dayKey: "inbox",
    dayLabel: "受信箱（未仕分け）",
    note: c.note,
    context: c.sourceContext,
    importance: c.importanceScore,
    triageReason: c.triageReason,
  }));

  const entryItems: EntryItem[] = entries.map((e) => {
    const system = classifySystem({
      text: `${e.title} ${e.note ?? ""}`,
      domain: e.domain,
    });
    // つかった きろく（Application）の最新日 = くらの「なじみ」の鮮度
    const lastUsedAt = e.applications.reduce<Date | undefined>(
      (max, a) => (!max || a.createdAt > max ? a.createdAt : max),
      undefined,
    );
    return {
      id: e.id,
      title: shortTitle(e.title, null, 48),
      source: e.source ?? e.kind,
      usedCount: e.applications.length,
      kind: "entry" as const,
      pending: false,
      placeLabel: placeFrom(null, e.domain).label,
      system,
      at: e.createdAt,
      dayKey: entryDayKey(e.createdAt),
      dayLabel: entryDayLabel(e.createdAt, now),
      note: e.note,
      lastUsedAt,
    };
  });

  return [...pendingItems, ...entryItems];
}

/** うけばこ下段（しれん / つかった きろく / 台帳）。一覧の EntryItem では出せない数だけ足す */
export async function loadUkebakoBoard(): Promise<UkebakoBoard> {
  const [
    experiments,
    applications,
    pending,
    expired,
    entryTotal,
    sleeping,
    applicationTotal,
    trialActive,
  ] = await Promise.all([
    prisma.experiment.findMany({
      where: { status: "active" },
      orderBy: { endDate: "asc" },
      take: 3,
      include: {
        entry: { select: { id: true, title: true } },
        checkIns: { select: { id: true } },
      },
    }),
    prisma.application.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { entry: { select: { id: true, title: true } } },
    }),
    prisma.capture.count({ where: { status: "pending" } }),
    prisma.capture.count({ where: { status: "expired" } }),
    prisma.entry.count(),
    prisma.entry.count({ where: { applications: { none: {} } } }),
    prisma.application.count(),
    prisma.experiment.count({ where: { status: "active" } }),
  ]);

  return {
    trials: experiments.map((x) => ({
      id: x.id,
      action: x.action,
      successMetric: x.successMetric,
      status: x.status,
      startDate: x.startDate,
      endDate: x.endDate,
      entryId: x.entry.id,
      entryTitle: shortTitle(x.entry.title, null, 44),
      checkInCount: x.checkIns.length,
    })),
    log: applications.map((a) => ({
      id: a.id,
      appliedTo: a.appliedTo,
      note: a.note,
      decisionChanged: a.decisionChanged,
      createdAt: a.createdAt,
      entryId: a.entry.id,
      entryTitle: shortTitle(a.entry.title, null, 44),
    })),
    stats: {
      pending,
      expired,
      entryTotal,
      sleeping,
      applicationTotal,
      trialActive,
    },
  };
}

export async function loadEntryDetail(id: string): Promise<{
  id: string;
  title: string;
  kind: string;
  source: string | null;
  note: string | null;
  domain: string | null;
  createdAt: Date;
  applicationCount: number;
  applications: { id: string; appliedTo: string; note: string; createdAt: Date }[];
  experiments: {
    id: string;
    action: string;
    status: string;
    startDate: Date;
    endDate: Date;
  }[];
} | null> {
  const entry = await prisma.entry.findUnique({
    where: { id },
    include: {
      applications: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, appliedTo: true, note: true, createdAt: true },
      },
      experiments: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, action: true, status: true, startDate: true, endDate: true },
      },
    },
  });
  if (!entry) return null;
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    source: entry.source,
    note: entry.note,
    domain: entry.domain,
    createdAt: entry.createdAt,
    applicationCount: entry.applications.length,
    applications: entry.applications,
    experiments: entry.experiments,
  };
}

export async function loadCaptureDetail(id: string): Promise<{
  id: string;
  title: string;
  note: string | null;
  status: string;
  sourceTool: string;
  sourceContext: string | null;
  capturedAt: Date;
  importanceScore: number | null;
  triageReason: string | null;
} | null> {
  return prisma.capture.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      note: true,
      status: true,
      sourceTool: true,
      sourceContext: true,
      capturedAt: true,
      importanceScore: true,
      triageReason: true,
    },
  });
}

export async function loadRequirements(): Promise<RequirementItem[]> {
  const now = new Date();
  const [nextOnes, understood] = await Promise.all([
    nextRequirementCandidates(8),
    recentlyUnderstoodRequirements(
      new Date(now.getTime() - 60 * 86400000),
      12,
    ),
  ]);

  const items: RequirementItem[] = [
    ...nextOnes.map((r) => ({
      id: r.id,
      title: shortTitle(r.title, null, 52),
      kind: "next" as const,
      system: classifySystem({ text: r.title }),
      nextGateId: r.approvedGates.find((g) => !g.passed)?.gateId ?? null,
      suggestedGateCount: r.suggestedGateCount,
    })),
    ...understood.map((r) => ({
      id: r.id,
      title: shortTitle(r.title, null, 52),
      kind: "understood" as const,
      system: classifySystem({ text: r.title }),
      nextGateId: null,
      suggestedGateCount: 0,
    })),
  ];

  if (items.length === 0) {
    const fallback = await prisma.requirement.findMany({
      where: { status: { in: ["active", "understood"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, status: true },
    });
    return fallback.map((r) => ({
      id: r.id,
      title: shortTitle(r.title, null, 52),
      kind: r.status === "understood" ? ("understood" as const) : ("next" as const),
      system: classifySystem({ text: r.title }),
      nextGateId: null,
      suggestedGateCount: 0,
    }));
  }

  return items;
}

export async function loadGateById(id: string): Promise<{
  id: string;
  question: string;
  domain?: string | null;
  contextSummary?: string | null;
  system: SystemKind;
  resources: { kind: string; label: string; href?: string | null }[];
  /** ヒント用の採点観点 */
  rubricCriteria: string[];
  initialVerdict: "pass" | "retry" | "grading_failed" | null;
  initialDebrief: ReturnType<typeof buildGateDebrief> | null;
  relatedEntryId: string | null;
  relatedInboxId: string | null;
  relatedMisconceptionId: string | null;
  /** B5-5: misconception.nextReviewAt の日付ラベル */
  nextReviewLabel: string | null;
} | null> {
  if (!id) return null;
  const gate = await prisma.gate.findUnique({
    where: { id },
    select: {
      id: true,
      question: true,
      domain: true,
      targetConcept: true,
      status: true,
      gradeNote: true,
      rubricResult: true,
      rubricCriteria: true,
      contextSummary: true,
      resources: true,
      misconceptionId: true,
      event: { select: { repoPath: true } },
      misconception: { select: { nextReviewAt: true } },
    },
  });
  if (!gate) return null;
  const initialVerdict = mapInitialVerdict(gate.status);
  const { parseGateResources, resolveResourceItems } = await import(
    "@/lib/gate-resources"
  );
  const { resolveGateFollowups } = await import("@/lib/gate-followups");
  const [resources, followups] = await Promise.all([
    resolveResourceItems(
      parseGateResources(gate.resources),
      gate.event?.repoPath,
    ),
    resolveGateFollowups(gate.id),
  ]);
  const { TUTORIAL_GATE_ID } = await import("@/lib/tutorial-constants");
  const debrief = initialVerdict
    ? buildGateDebrief(gate.gradeNote, gate.rubricResult, {
        rubricCriteriaJson: gate.rubricCriteria,
        ensureAspects:
          gate.id === TUTORIAL_GATE_ID && initialVerdict === "retry",
      })
    : null;
  const system = classifySystem({
    text: `${gate.question}\n${gate.contextSummary ?? ""}`,
    domain: gate.domain,
    targetConcept: gate.targetConcept,
    rootCause: debrief?.rootCause ?? null,
  });
  const nextAt = gate.misconception?.nextReviewAt;
  const nextReviewLabel = nextAt
    ? nextAt.toISOString().slice(0, 10)
    : null;
  let rubricCriteria: string[] = [];
  if (gate.rubricCriteria) {
    try {
      const parsed = JSON.parse(gate.rubricCriteria) as unknown;
      if (Array.isArray(parsed)) {
        rubricCriteria = parsed
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 3);
      }
    } catch {
      /* ignore */
    }
  }
  return {
    id: gate.id,
    question: gate.question,
    domain: gate.domain,
    contextSummary: gate.contextSummary,
    system,
    resources,
    rubricCriteria,
    initialVerdict,
    initialDebrief: debrief,
    relatedEntryId: followups.entryId,
    relatedInboxId: followups.inboxId,
    relatedMisconceptionId: followups.misconceptionId ?? gate.misconceptionId,
    nextReviewLabel,
  };
}

export async function loadStreakDays(): Promise<number> {
  return recordStreak(new Date());
}
