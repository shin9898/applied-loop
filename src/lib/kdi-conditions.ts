/** KDI 文字列をクリア条件の行に分割 */
export function kdiConditions(kdi?: string | null): string[] {
  if (!kdi?.trim()) return [];
  return kdi
    .split(/\n|[;；]|・|(?<=。)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
