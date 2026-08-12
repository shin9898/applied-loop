export type NikkiChapterBrief = {
  index: number;
  title: string;
  /** 「やったこと」要約 1〜2文（既存の oneLiner / action から整形済み） */
  summary: string;
};

export type NikkiDay = {
  dateKey: string;
  chapterCount: number;
  materialCount: number;
  title?: string;
  lead?: string | null;
  lines?: string[];
  chapters?: NikkiChapterBrief[];
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
