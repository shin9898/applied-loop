/**
 * しれん を「系統ごとの ダンジョン」に組み替える ビューモデル。
 *
 * データは既存の `loadGateList()` の GateListItem をそのまま使う（新しい取得は足さない）。
 * ここでやるのは並べ替えと呼び名づけだけ：
 *   - 系統（classifySystem の SystemKind）= ひとつの ダンジョン
 *   - 未クリア 0 件の系統は「せいふく ずみ」（封印）
 *   - 道のりは 足あと（CLEAR）→ いま ここ（先頭の未クリア）→ ? ? ?（それ以降）
 *   - 再出題（kind = sr_review）は 最深部の「ぬし」へ沈める
 */
import { isUnknownPlace, placeFrom, systemLabel, type SystemKind } from "@/lib/atlas-taxonomy";
import { enemyForGate, type EnemyDef } from "./atlas-enemies";
import type { GateListItem } from "./atlas-gates-list";

export const DUNGEON_SYSTEMS: SystemKind[] = [
  "cache",
  "harness",
  "design",
  "knowledge",
  "verification",
  "premise",
  "ops",
  "other",
];

/** 系統ごとの 呼び名と ふぜい（機能＝系統ラベルは別に併記する） */
const LORE: Record<SystemKind, { name: string; flavor: string }> = {
  cache: {
    name: "いみキャッシュの迷宮",
    flavor: "同じ名を 二度 信じた者が 迷いこむ。",
  },
  harness: {
    name: "フックの坑道",
    flavor: "観測の届かぬ坑道。掘るほどに 静かになる。",
  },
  design: {
    name: "トレードオフの塔",
    flavor: "登るたび、何かを 捨てねば 先へ進めぬ。",
  },
  knowledge: {
    name: "しらずの書庫",
    flavor: "読まずに 閉じた本が、夜ごと 歩き出す。",
  },
  verification: {
    name: "うのみの沼",
    flavor: "足元を 確かめぬ者から 沈んでゆく。",
  },
  premise: {
    name: "きりの回廊",
    flavor: "置き忘れた 前提が、そのまま 佇んでおる。",
  },
  ops: {
    name: "リリースの火口",
    flavor: "手順を 飛ばした夜だけ 火が入る。",
  },
  other: {
    name: "なまえなき洞",
    flavor: "まだ 名の つかぬ つまずきが 潜む。",
  },
};

export type DungeonFloorState = "clear" | "now" | "locked";

export type DungeonFloor = {
  gate: GateListItem;
  /** B1F, B2F, … */
  floorLabel: string;
  state: DungeonFloorState;
  /** 再出題（一度たおしたが また現れた） */
  boss: boolean;
  /** ばしょ未特定（霧から来た） */
  fog: boolean;
  enemy: EnemyDef;
  /** 「未提出 ・ 12日前に生まれた」等 */
  meta: string;
  /** たたかえる状態か（採点中は false） */
  canFight: boolean;
};

export type Dungeon = {
  system: SystemKind;
  name: string;
  flavor: string;
  label: string;
  enemy: EnemyDef;
  floors: DungeonFloor[];
  remaining: number;
  cleared: number;
  total: number;
  /** 未クリア 0 = 封印済み */
  sealed: boolean;
  /** 代表的な ばしょ（最頻） */
  placeLabel: string | null;
  /** 未クリアで最も古いものの経過日数 */
  oldestDays: number | null;
  /** 最深部に ぬし（再出題）がいるか */
  hasBoss: boolean;
  /** いま挑む 1 体 */
  nowFloor: DungeonFloor | null;
};

export function isSystemKind(value: string): value is SystemKind {
  return (DUNGEON_SYSTEMS as string[]).includes(value);
}

function isCleared(status: GateListItem["status"]): boolean {
  return status === "passed";
}

function daysAgo(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Math.floor((now.getTime() - t) / 86_400_000);
  return diff < 0 ? 0 : diff;
}

function whenLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "きょう";
  if (days === 1) return "きのう";
  return `${days}日前`;
}

function statusWord(status: GateListItem["status"]): string {
  switch (status) {
    case "pending":
      return "未提出";
    case "grading":
      return "採点中";
    case "grading_failed":
      return "保留（採点が落ちた）";
    case "failed":
      return "miss（再挑戦）";
    case "passed":
      return "CLEAR";
    case "parked":
      return "あとまわし";
  }
}

/** 再出現（boss）時の一言。retry は「負けて再挑戦」、sr_review は「たおしたが再出題」で意味が逆なので出し分ける */
function bossReturnPhrase(item: GateListItem): string {
  return item.kind === "retry"
    ? "一度は退けられたが、もう一度挑む"
    : "一度たおしたが また現れた";
}

function floorMeta(
  item: GateListItem,
  cleared: boolean,
  boss: boolean,
  fog: boolean,
  now: Date,
  duplicateCount: number,
): string {
  const born = whenLabel(daysAgo(item.createdAt, now));
  const parts: string[] = [];
  if (cleared) {
    const graded = whenLabel(daysAgo(item.gradedAt ?? item.createdAt, now));
    parts.push(graded ? `CLEAR ・ ${graded}` : "CLEAR");
  } else {
    parts.push(statusWord(item.status));
    if (born) parts.push(`${born}に生まれた`);
    if (boss) parts.push(bossReturnPhrase(item));
  }
  if (fog) parts.push("ばしょ未特定（霧から）");
  if (item.placeLabel && !fog) parts.push(item.placeLabel);
  if (duplicateCount > 1) parts.push(`同じ誤解が計${duplicateCount}件`);
  return parts.join(" ・ ");
}

function byCreatedAsc(a: GateListItem, b: GateListItem): number {
  const at = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
  return at - bt;
}

function representativePlace(items: GateListItem[]): string | null {
  const tally = new Map<string, number>();
  for (const it of items) {
    const place = placeFrom(it.repo, it.domain);
    if (isUnknownPlace(place)) continue;
    tally.set(place.label, (tally.get(place.label) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [label, n] of tally) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

/** 系統ごとに ダンジョン化する。挑めるものが多い順、次に 古い順 */
export function buildDungeons(items: GateListItem[], now = new Date()): Dungeon[] {
  // しれん重複の見える化: 同一 misconceptionId を持つ Gate の総数（系統をまたいで数える）
  const misconceptionCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.misconceptionId) continue;
    misconceptionCounts.set(
      item.misconceptionId,
      (misconceptionCounts.get(item.misconceptionId) ?? 0) + 1,
    );
  }

  const bySystem = new Map<SystemKind, GateListItem[]>();
  for (const item of items) {
    const key = item.system ?? "other";
    const cur = bySystem.get(key);
    if (cur) cur.push(item);
    else bySystem.set(key, [item]);
  }

  const dungeons: Dungeon[] = [];
  for (const [system, group] of bySystem) {
    const lore = LORE[system] ?? LORE.other;
    const clearedItems = group.filter((i) => isCleared(i.status)).sort(byCreatedAsc);
    const remainingItems = group.filter((i) => !isCleared(i.status));
    const isBoss = (i: GateListItem) =>
      i.kind === "sr_review" || i.kind === "retry";
    // 再出題（ぬし）は最深部へ沈める。それ以外は古い順＝上から順に片づける
    remainingItems.sort((a, b) => {
      const ab = isBoss(a) ? 1 : 0;
      const bb = isBoss(b) ? 1 : 0;
      if (ab !== bb) return ab - bb;
      return byCreatedAsc(a, b);
    });

    const ordered = [...clearedItems, ...remainingItems];
    let nowTaken = false;
    const floors: DungeonFloor[] = ordered.map((gate, index) => {
      const cleared = isCleared(gate.status);
      let state: DungeonFloorState = "clear";
      if (!cleared) {
        state = nowTaken ? "locked" : "now";
        nowTaken = true;
      }
      const fog = isUnknownPlace(placeFrom(gate.repo, gate.domain));
      const boss = !cleared && isBoss(gate);
      const duplicateCount = gate.misconceptionId
        ? (misconceptionCounts.get(gate.misconceptionId) ?? 0)
        : 0;
      return {
        gate,
        floorLabel: `B${index + 1}F`,
        state,
        boss,
        fog,
        enemy: enemyForGate({
          system: gate.system,
          domain: gate.domain,
          text: gate.question,
        }),
        meta: floorMeta(gate, cleared, boss, fog, now, duplicateCount),
        canFight:
          gate.status === "pending" ||
          gate.status === "failed" ||
          gate.status === "grading_failed",
      };
    });

    const oldest = remainingItems
      .map((i) => daysAgo(i.createdAt, now))
      .filter((d): d is number => d !== null)
      .sort((a, b) => b - a)[0];

    dungeons.push({
      system,
      name: lore.name,
      flavor: lore.flavor,
      label: systemLabel(system),
      enemy: enemyForGate({
        system,
        domain: group[0]?.domain ?? null,
        text: group[0]?.question ?? null,
      }),
      floors,
      remaining: remainingItems.length,
      cleared: clearedItems.length,
      total: ordered.length,
      sealed: remainingItems.length === 0,
      placeLabel: representativePlace(group),
      oldestDays: oldest ?? null,
      hasBoss: remainingItems.some(isBoss),
      nowFloor: floors.find((f) => f.state === "now") ?? null,
    });
  }

  return dungeons.sort((a, b) => {
    if (a.sealed !== b.sealed) return a.sealed ? 1 : -1;
    if (a.remaining !== b.remaining) return b.remaining - a.remaining;
    const ao = a.oldestDays ?? -1;
    const bo = b.oldestDays ?? -1;
    if (ao !== bo) return bo - ao;
    return a.name.localeCompare(b.name, "ja");
  });
}

export function findDungeon(
  dungeons: Dungeon[],
  system: SystemKind,
): Dungeon | null {
  return dungeons.find((d) => d.system === system) ?? null;
}

/** ダンジョン内で「この 1 体の 次」に挑むまもの */
export function nextFloorAfter(
  dungeon: Dungeon,
  currentGateId: string,
): DungeonFloor | null {
  const rest = dungeon.floors.filter(
    (f) => f.state !== "clear" && f.gate.id !== currentGateId,
  );
  return rest[0] ?? null;
}

export function dungeonHref(system: SystemKind): string {
  return `/gates?d=${system}`;
}

export function battleHref(gateId: string, system?: SystemKind | null): string {
  return system ? `/gates/${gateId}?d=${system}` : `/gates/${gateId}`;
}
