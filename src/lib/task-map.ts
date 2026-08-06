import { prisma } from "@/lib/db";
import { dateKeyJST } from "@/lib/date";

export type TaskRelatedType = "entry" | "misconception" | "gate";

export type TaskRelatedItem = {
  type: TaskRelatedType;
  id: string;
  reason?: string;
};

export type TaskMapping = {
  task: string;
  related: TaskRelatedItem[];
};

export type SaveTaskMappingsResult = {
  dateKey: string;
  savedCount: number;
  droppedIds: string[];
  warnings: string[];
};

function isRelatedType(v: unknown): v is TaskRelatedType {
  return v === "entry" || v === "misconception" || v === "gate";
}

export {
  pickTaskMapDisplay,
  type TaskMapDisplaySource,
} from "@/lib/task-map-display";

/** mappings JSON を寛容にパース。不正要素は落とす。 */
export function parseTaskMappings(raw: unknown): {
  mappings: TaskMapping[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) {
    return { mappings: [], warnings: ["mappings は配列である必要があります。"] };
  }
  const mappings: TaskMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      warnings.push("不正なマッピング要素をスキップしました。");
      continue;
    }
    const task =
      typeof (item as { task?: unknown }).task === "string"
        ? (item as { task: string }).task.trim()
        : "";
    if (!task) {
      warnings.push("task が空の要素をスキップしました。");
      continue;
    }
    const relatedRaw = (item as { related?: unknown }).related;
    const related: TaskRelatedItem[] = [];
    if (Array.isArray(relatedRaw)) {
      for (const r of relatedRaw) {
        if (!r || typeof r !== "object") continue;
        const type = (r as { type?: unknown }).type;
        const id = (r as { id?: unknown }).id;
        const reason = (r as { reason?: unknown }).reason;
        if (!isRelatedType(type) || typeof id !== "string" || !id.trim()) {
          warnings.push(`関連項目の type/id が不正です (task: ${task})。`);
          continue;
        }
        related.push({
          type,
          id: id.trim(),
          reason: typeof reason === "string" ? reason.trim() : undefined,
        });
      }
    }
    mappings.push({ task, related });
  }
  return { mappings, warnings };
}

/**
 * related の id が実在するか検証し、存在しないものは除外する。
 */
export async function filterExistingRelated(
  mappings: TaskMapping[]
): Promise<{ mappings: TaskMapping[]; droppedIds: string[] }> {
  const entryIds = new Set<string>();
  const miscIds = new Set<string>();
  const gateIds = new Set<string>();
  for (const m of mappings) {
    for (const r of m.related) {
      if (r.type === "entry") entryIds.add(r.id);
      else if (r.type === "misconception") miscIds.add(r.id);
      else gateIds.add(r.id);
    }
  }

  const [entries, misconceptions, gates] = await Promise.all([
    entryIds.size === 0
      ? Promise.resolve([] as { id: string }[])
      : prisma.entry.findMany({
          where: { id: { in: [...entryIds] } },
          select: { id: true },
        }),
    miscIds.size === 0
      ? Promise.resolve([] as { id: string }[])
      : prisma.misconception.findMany({
          where: { id: { in: [...miscIds] } },
          select: { id: true },
        }),
    gateIds.size === 0
      ? Promise.resolve([] as { id: string }[])
      : prisma.gate.findMany({
          where: { id: { in: [...gateIds] } },
          select: { id: true },
        }),
  ]);

  const exists = {
    entry: new Set(entries.map((e) => e.id)),
    misconception: new Set(misconceptions.map((m) => m.id)),
    gate: new Set(gates.map((g) => g.id)),
  };

  const droppedIds: string[] = [];
  const filtered = mappings.map((m) => ({
    task: m.task,
    related: m.related.filter((r) => {
      if (exists[r.type].has(r.id)) return true;
      droppedIds.push(`${r.type}:${r.id}`);
      return false;
    }),
  }));

  return { mappings: filtered, droppedIds };
}

/**
 * DailyTaskMap を upsert 保存する (ADR-0013 §1)。
 * dateKey 省略時は今日 (JST)。存在しない related id は除外して警告。
 */
export async function saveTaskMappings(input: {
  dateKey?: string | null;
  mappings: unknown;
}): Promise<SaveTaskMappingsResult> {
  const dateKey =
    input.dateKey?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateKey.trim())
      ? input.dateKey.trim()
      : dateKeyJST();

  const parsed = parseTaskMappings(input.mappings);
  const { mappings, droppedIds } = await filterExistingRelated(parsed.mappings);
  const warnings = [...parsed.warnings];
  if (droppedIds.length > 0) {
    warnings.push(
      `存在しない id を除外しました: ${droppedIds.join(", ")}`
    );
  }

  await prisma.dailyTaskMap.upsert({
    where: { dateKey },
    create: {
      dateKey,
      mappings: JSON.stringify(mappings),
    },
    update: {
      mappings: JSON.stringify(mappings),
    },
  });

  return {
    dateKey,
    savedCount: mappings.length,
    droppedIds,
    warnings,
  };
}

/** ダッシュボード表示用に related のタイトルを解決する。 */
export async function resolveTaskMapForDisplay(dateKey: string): Promise<{
  dateKey: string;
  tasks: {
    task: string;
    related: {
      type: TaskRelatedType;
      id: string;
      reason?: string;
      title: string;
      href: string;
    }[];
  }[];
} | null> {
  const row = await prisma.dailyTaskMap.findUnique({ where: { dateKey } });
  if (!row) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(row.mappings);
  } catch {
    return null;
  }
  const { mappings } = parseTaskMappings(raw);
  if (mappings.length === 0) return null;

  const entryIds = mappings.flatMap((m) =>
    m.related.filter((r) => r.type === "entry").map((r) => r.id)
  );
  const miscIds = mappings.flatMap((m) =>
    m.related.filter((r) => r.type === "misconception").map((r) => r.id)
  );
  const gateIds = mappings.flatMap((m) =>
    m.related.filter((r) => r.type === "gate").map((r) => r.id)
  );

  const [entries, misconceptions, gates] = await Promise.all([
    entryIds.length === 0
      ? Promise.resolve([] as { id: string; title: string }[])
      : prisma.entry.findMany({
          where: { id: { in: entryIds } },
          select: { id: true, title: true },
        }),
    miscIds.length === 0
      ? Promise.resolve([] as { id: string; concept: string }[])
      : prisma.misconception.findMany({
          where: { id: { in: miscIds } },
          select: { id: true, concept: true },
        }),
    gateIds.length === 0
      ? Promise.resolve([] as { id: string; question: string }[])
      : prisma.gate.findMany({
          where: { id: { in: gateIds } },
          select: { id: true, question: true },
        }),
  ]);

  const titles = {
    entry: new Map(entries.map((e) => [e.id, e.title])),
    misconception: new Map(misconceptions.map((m) => [m.id, m.concept])),
    gate: new Map(gates.map((g) => [g.id, g.question])),
  } as const;

  const hrefFor = (type: TaskRelatedType, id: string): string => {
    switch (type) {
      case "entry":
        return `/entries/${id}`;
      case "misconception":
        return `/zukan/${id}`;
      case "gate":
        return `/gates/${id}`;
    }
  };

  const typeLabel = (type: TaskRelatedType): string => {
    switch (type) {
      case "entry":
        return "学び";
      case "misconception":
        return "誤解";
      case "gate":
        return "理解チェック";
    }
  };

  const tasks = mappings.map((m) => ({
    task: m.task,
    related: m.related
      .map((r) => {
        const title = titles[r.type].get(r.id);
        if (!title) return null;
        return {
          type: r.type,
          id: r.id,
          reason: r.reason,
          title: `${typeLabel(r.type)}: ${title}`,
          href: hrefFor(r.type, r.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  }));

  return { dateKey, tasks };
}
