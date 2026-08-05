import { after } from "next/server";
import { prisma } from "@/lib/db";
import { runHeadlessLLM, parseLLMJson, HeadlessLLMError } from "@/lib/headless-llm";
import { parseRubricResult } from "@/lib/gate-resources";

const MIN_GRADED_GATES = 10;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const CACHE_ID = "default";
const TOP_N = 3;

export type WeaknessAspect = {
  aspect: string;
  missRate: number;
  sampleCount: number;
  relatedMisconceptions: Array<{ id: string; concept: string }>;
};

export type WeaknessReport = {
  gradedCount: number;
  aspects: WeaknessAspect[];
  computedAt: string; // ISO
};

type ClusterResult = {
  clusters?: Array<{ canonical?: string; members?: string[] }>;
};

type AspectAgg = {
  rawAspects: Set<string>;
  miss: number;
  total: number;
  misconceptionIds: Set<string>;
};

/** 採点済みかつ rubricResult があるゲート数 */
export async function countGradedWithRubric(): Promise<number> {
  return prisma.gate.count({
    where: {
      status: { in: ["passed", "failed"] },
      rubricResult: { not: null },
    },
  });
}

function isStale(computedAt: Date): boolean {
  return Date.now() - computedAt.getTime() > CACHE_TTL_MS;
}

function parseCachedReport(raw: string): WeaknessReport | null {
  try {
    const parsed = JSON.parse(raw) as WeaknessReport;
    if (!parsed || !Array.isArray(parsed.aspects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * ダッシュボード用。採点 10 件未満は null。
 * キャッシュが古いときは after() で再計算を起動し、既存キャッシュがあればそれを返す。
 */
export async function getWeaknessPatternsForDashboard(): Promise<WeaknessAspect[] | null> {
  const gradedCount = await countGradedWithRubric();
  if (gradedCount < MIN_GRADED_GATES) return null;

  const cache = await prisma.weaknessPatternCache.findUnique({
    where: { id: CACHE_ID },
  });
  const report = cache ? parseCachedReport(cache.resultJson) : null;
  const stale = !cache || isStale(cache.computedAt);

  if (stale) {
    after(() => {
      recomputeWeaknessPatterns().catch((e) =>
        console.error("[weakness] recompute failed:", e)
      );
    });
  }

  if (!report || report.aspects.length === 0) return null;
  return report.aspects.slice(0, TOP_N);
}

/** 観点名だけを LLM に渡しクラスタリングする (コード・回答は送らない) */
async function clusterAspects(
  aspects: string[]
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  if (aspects.length === 0) return mapping;
  if (aspects.length === 1) {
    mapping.set(aspects[0], aspects[0]);
    return mapping;
  }

  const prompt = [
    "以下は理解度ゲート採点の観点ラベル一覧。表記揺れを統合し、意味が同じものを1つの canonical にまとめよ。",
    "canonical は短い日本語ラベル。members は入力に含まれる元ラベルのみ。",
    "コードや回答は渡していない。ラベルの意味だけでクラスタリングせよ。",
    'JSON のみ: {"clusters":[{"canonical":"...","members":["..."]}]}',
    "",
    "<aspects>",
    JSON.stringify(aspects),
    "</aspects>",
  ].join("\n");

  try {
    const parsed = parseLLMJson<ClusterResult>(await runHeadlessLLM(prompt));
    for (const c of parsed?.clusters ?? []) {
      const canonical =
        typeof c.canonical === "string" && c.canonical.trim()
          ? c.canonical.trim()
          : null;
      if (!canonical || !Array.isArray(c.members)) continue;
      for (const m of c.members) {
        if (typeof m === "string" && m.trim()) {
          mapping.set(m.trim(), canonical);
        }
      }
    }
  } catch (e) {
    if (e instanceof HeadlessLLMError) {
      console.warn(`[weakness] clustering LLM failed: ${e.message}`);
    } else {
      console.warn("[weakness] clustering failed:", e);
    }
  }

  // マッピング漏れは自身を canonical に
  for (const a of aspects) {
    if (!mapping.has(a)) mapping.set(a, a);
  }
  return mapping;
}

export async function recomputeWeaknessPatterns(): Promise<WeaknessReport | null> {
  const gates = await prisma.gate.findMany({
    where: {
      status: { in: ["passed", "failed"] },
      rubricResult: { not: null },
    },
    select: {
      id: true,
      rubricResult: true,
      misconceptionId: true,
      status: true,
    },
  });

  if (gates.length < MIN_GRADED_GATES) return null;

  // raw aspect → 集計 (正規化前)
  type RawAgg = {
    miss: number;
    total: number;
    misconceptionIds: Set<string>;
  };
  const raw = new Map<string, RawAgg>();
  const allAspects = new Set<string>();

  for (const g of gates) {
    const items = parseRubricResult(g.rubricResult);
    for (const item of items) {
      const aspect = item.aspect.trim();
      if (!aspect) continue;
      allAspects.add(aspect);
      const agg = raw.get(aspect) ?? {
        miss: 0,
        total: 0,
        misconceptionIds: new Set<string>(),
      };
      agg.total += 1;
      // score 0/1 = 未達 (欠落 or 部分的)
      if (item.score <= 1) agg.miss += 1;
      if (g.misconceptionId) agg.misconceptionIds.add(g.misconceptionId);
      raw.set(aspect, agg);
    }
  }

  const aspectList = [...allAspects];
  const clusters = await clusterAspects(aspectList);

  // canonical に集約
  const byCanonical = new Map<string, AspectAgg>();
  for (const [aspect, agg] of raw) {
    const canonical = clusters.get(aspect) ?? aspect;
    const cur = byCanonical.get(canonical) ?? {
      rawAspects: new Set<string>(),
      miss: 0,
      total: 0,
      misconceptionIds: new Set<string>(),
    };
    cur.rawAspects.add(aspect);
    cur.miss += agg.miss;
    cur.total += agg.total;
    for (const id of agg.misconceptionIds) cur.misconceptionIds.add(id);
    byCanonical.set(canonical, cur);
  }

  // open/regressed の誤解だけ導線に使う
  const openMisconceptions = await prisma.misconception.findMany({
    where: { status: { in: ["open", "regressed"] } },
    select: { id: true, concept: true, firstGateId: true },
  });
  const openById = new Map(openMisconceptions.map((m) => [m.id, m]));

  // firstGate の rubric にも紐付け (misconceptionId が null の初回失敗ゲート向け)
  const firstGateIds = openMisconceptions
    .map((m) => m.firstGateId)
    .filter((id): id is string => !!id);
  const firstGates =
    firstGateIds.length > 0
      ? await prisma.gate.findMany({
          where: { id: { in: firstGateIds } },
          select: { id: true, rubricResult: true },
        })
      : [];
  const firstGateAspects = new Map<string, Set<string>>();
  for (const g of firstGates) {
    const aspects = new Set(
      parseRubricResult(g.rubricResult)
        .map((r) => clusters.get(r.aspect.trim()) ?? r.aspect.trim())
        .filter(Boolean)
    );
    firstGateAspects.set(g.id, aspects);
  }

  const aspects: WeaknessAspect[] = [...byCanonical.entries()]
    .filter(([, agg]) => agg.total > 0)
    .map(([aspect, agg]) => {
      const related = new Map<string, { id: string; concept: string }>();
      for (const mid of agg.misconceptionIds) {
        const m = openById.get(mid);
        if (m) related.set(m.id, { id: m.id, concept: m.concept });
      }
      for (const m of openMisconceptions) {
        if (!m.firstGateId) continue;
        const aspectsOfGate = firstGateAspects.get(m.firstGateId);
        if (aspectsOfGate?.has(aspect)) {
          related.set(m.id, { id: m.id, concept: m.concept });
        }
      }
      return {
        aspect,
        missRate: agg.miss / agg.total,
        sampleCount: agg.total,
        relatedMisconceptions: [...related.values()].slice(0, 3),
      };
    })
    .sort((a, b) => b.missRate - a.missRate || b.sampleCount - a.sampleCount);

  const report: WeaknessReport = {
    gradedCount: gates.length,
    aspects,
    computedAt: new Date().toISOString(),
  };

  await prisma.weaknessPatternCache.upsert({
    where: { id: CACHE_ID },
    create: {
      id: CACHE_ID,
      resultJson: JSON.stringify(report),
      gradedCount: gates.length,
      computedAt: new Date(),
    },
    update: {
      resultJson: JSON.stringify(report),
      gradedCount: gates.length,
      computedAt: new Date(),
    },
  });

  return report;
}
