/**
 * Living Atlas の棚ラベル。
 * ばしょ（repo / domain）× つまずき系統で一覧を整理する。
 */

export type SystemKind =
  | "cache"
  | "harness"
  | "design"
  | "ops"
  | "knowledge"
  | "verification"
  | "premise"
  | "other";

export type PlaceKind = {
  key: string;
  label: string;
};

const SYSTEM_LABELS: Record<SystemKind, string> = {
  cache: "キャッシュ",
  harness: "ハーネス",
  design: "設計判断",
  ops: "運用",
  knowledge: "知識",
  verification: "確認",
  premise: "前提",
  other: "その他",
};

export function systemLabel(kind: SystemKind): string {
  return SYSTEM_LABELS[kind];
}

export const UNKNOWN_PLACE_KEY = "place:unknown";
export const UNKNOWN_PLACE_LABEL = "未特定（霧）";

export function isUnknownPlace(place: PlaceKind): boolean {
  return (
    place.key === UNKNOWN_PLACE_KEY ||
    place.label === UNKNOWN_PLACE_LABEL ||
    place.label === "ばしょ不明"
  );
}

/** repo / domain から「ばしょ」キーを作る */
export function placeFrom(repo?: string | null, domain?: string | null): PlaceKind {
  const r = repo?.trim();
  if (r) {
    const short = r.includes("/") ? r.split("/").pop()! : r;
    return { key: `repo:${r}`, label: short };
  }
  const d = domain?.trim();
  if (d) {
    return { key: `domain:${d}`, label: domainDisplay(d) };
  }
  return { key: UNKNOWN_PLACE_KEY, label: UNKNOWN_PLACE_LABEL };
}

export function domainDisplay(domain: string): string {
  const map: Record<string, string> = {
    harness: "ハーネス領",
    product: "プロダクト領",
    ops: "運用領",
    design: "設計領",
  };
  return map[domain] ?? domain;
}

/**
 * テキスト手がかり + rootCause から系統を推定。
 * rootCause があればそれを優先しつつ、キャッシュ等の語があれば上書き。
 */
export function classifySystem(input: {
  text?: string | null;
  domain?: string | null;
  rootCause?: string | null;
  targetConcept?: string | null;
}): SystemKind {
  const blob = [input.text, input.domain, input.targetConcept]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/cache|prompt.?cache|キャッシュ|prefix/.test(blob)) return "cache";
  if (/harness|フック|hook|観測|telemetry/.test(blob)) return "harness";
  if (/設計|design|trade.?off|アーキ|api.?設計/.test(blob)) return "design";
  if (/運用|ops|deploy|リリース|oncall/.test(blob)) return "ops";

  const rc = input.rootCause?.trim().toLowerCase();
  if (rc === "knowledge") return "knowledge";
  if (rc === "verification") return "verification";
  if (rc === "premise") return "premise";

  if (input.domain) {
    const d = input.domain.toLowerCase();
    if (d.includes("harness") || d.includes("フック")) return "harness";
    if (d.includes("設計") || d.includes("design")) return "design";
    if (d.includes("運用") || d.includes("ops")) return "ops";
  }

  return "other";
}

/** 一覧カード用の短い見出し（全文は詳細へ） */
export function shortTitle(
  full: string,
  preferred?: string | null,
  max = 40,
): string {
  const pref = preferred?.trim();
  if (pref) {
    return pref.length > max ? `${pref.slice(0, max - 1)}…` : pref;
  }
  const q = full.trim().replace(/\s+/g, " ");
  if (q.length <= max) return q;
  return `${q.slice(0, max - 1)}…`;
}

export function groupByPlaceAndSystem<T>(
  items: T[],
  getPlace: (item: T) => PlaceKind,
  getSystem: (item: T) => SystemKind,
): { place: PlaceKind; system: SystemKind; systemLabel: string; items: T[] }[] {
  const map = new Map<
    string,
    { place: PlaceKind; system: SystemKind; items: T[] }
  >();
  for (const item of items) {
    const place = getPlace(item);
    const system = getSystem(item);
    const key = `${place.key}::${system}`;
    const cur = map.get(key);
    if (cur) cur.items.push(item);
    else map.set(key, { place, system, items: [item] });
  }
  return [...map.values()]
    .sort((a, b) => {
      const au = isUnknownPlace(a.place) ? 1 : 0;
      const bu = isUnknownPlace(b.place) ? 1 : 0;
      if (au !== bu) return au - bu;
      const pc = a.place.label.localeCompare(b.place.label, "ja");
      if (pc !== 0) return pc;
      return systemLabel(a.system).localeCompare(systemLabel(b.system), "ja");
    })
    .map((g) => ({
      ...g,
      systemLabel: systemLabel(g.system),
    }));
}
