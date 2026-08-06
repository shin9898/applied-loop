/**
 * バトル「ヒント」用。答えや LLM 解説は出さず、採点観点だけ示す。
 */

export function formatRubricHint(criteria: string[] | null | undefined): string {
  const items = (criteria ?? [])
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .slice(0, 3);
  if (items.length === 0) {
    return [
      "このしれんには観点ヒントがまだ無い。",
      "吹き出しの『手がかり』があればそこを開き、無ければ問いの境界（何と比べて何を守るか）を自分で切り分けてみよ。",
    ].join("");
  }
  const lines = items.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    "採点観点（答えそのものではない）:",
    lines,
    "上の観点を自分の言葉で触れればよいぞ。手がかりリンクがあれば合わせて見よ。",
  ].join("\n");
}
