/**
 * クライアントでも使える純関数（DB 非依存）。
 * task-map.ts は prisma を引くので Client Component から import しないこと。
 */

export type TaskMapDisplaySource = "today" | "yesterday" | "none";

/**
 * ホーム司令塔「任務」タブ用。今日が空なら昨日を控えとして使う。
 */
export function pickTaskMapDisplay<T extends { tasks: readonly unknown[] }>(
  today: T | null | undefined,
  yesterday: T | null | undefined,
): { map: T | null; source: TaskMapDisplaySource } {
  if (today && today.tasks.length > 0) {
    return { map: today, source: "today" };
  }
  if (yesterday && yesterday.tasks.length > 0) {
    return { map: yesterday, source: "yesterday" };
  }
  return { map: null, source: "none" };
}
