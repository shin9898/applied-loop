export type NikkiDay = {
  dateKey: string;
  chapterCount: number;
  materialCount: number;
  title?: string;
  lead?: string | null;
  /** その日の大枠を1つにまとめた冒険者日記文（全章に触れる） */
  overview?: string;
  lines?: string[];
};

export type NikkiMonth = {
  monthKey: string;
  label: string;
  days: NikkiDay[];
};

export function groupNikkiMonths(days: NikkiDay[]): NikkiMonth[] {
  const map = new Map<string, NikkiDay[]>();
  for (const d of days) {
    const monthKey = d.dateKey.slice(0, 7);
    const list = map.get(monthKey);
    if (list) list.push(d);
    else map.set(monthKey, [d]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, monthDays]) => {
      const [y, m] = monthKey.split("-");
      return {
        monthKey,
        label: `${y}年${Number(m)}月`,
        days: monthDays,
      };
    });
}
