const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86400000;

/** JST 基準の日付キー ("2026-08-01")。サーバー TZ (UTC の Vercel 等) 非依存。 */
export function dateKeyJST(d: Date = new Date()): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の当日 00:00 に相当する瞬間。CheckIn の日次一意キーに使う。 */
export function dayStartJST(d: Date = new Date()): Date {
  return new Date(`${dateKeyJST(d)}T00:00:00+09:00`);
}

/** JST の曜日 (0=日 … 6=土)。サーバー TZ 非依存。 */
export function dayOfWeekJST(d: Date = new Date()): number {
  return new Date(d.getTime() + JST_OFFSET_MS).getUTCDay();
}

/** JST 週の月曜 00:00 (週初)。 */
export function weekStartJST(d: Date = new Date()): Date {
  const start = dayStartJST(d);
  const dow = dayOfWeekJST(d);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return new Date(start.getTime() + mondayOffset * DAY_MS);
}

/** JST 基準の ISO 週キー ("2026-W31")。月曜始まり。 */
export function weekKeyJST(d: Date = new Date()): string {
  const monday = weekStartJST(d);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const isoYear = Number(dateKeyJST(thursday).slice(0, 4));
  const jan4 = new Date(`${isoYear}-01-04T00:00:00+09:00`);
  const week1Monday = weekStartJST(jan4);
  const week =
    Math.round((monday.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** JST の今週レンジ [start, end)。end は翌月曜 00:00。 */
export function weekRangeJST(d: Date = new Date()): {
  start: Date;
  end: Date;
  weekKey: string;
} {
  const start = weekStartJST(d);
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS),
    weekKey: weekKeyJST(d),
  };
}

/** 短い表示用 ("8/1")。JST 基準。 */
export function shortDateJST(d: Date): string {
  const key = dateKeyJST(d);
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}
