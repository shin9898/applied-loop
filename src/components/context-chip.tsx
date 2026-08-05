export type ContextChipKind = "repo" | "domain" | "goal";

const KIND_STYLE: Record<
  ContextChipKind,
  { bg: string; dot: string; text: string }
> = {
  repo: {
    bg: "bg-[#3D5A8012]",
    dot: "bg-[#3D5A80]",
    text: "text-[#3D5A80]",
  },
  domain: {
    bg: "bg-[#6D4C9012]",
    dot: "bg-[#6D4C90]",
    text: "text-[#6D4C90]",
  },
  goal: {
    bg: "bg-[#4A7C5912]",
    dot: "bg-[#4A7C59]",
    text: "text-[#4A7C59]",
  },
};

/** 出自ラベル (repo / 分野 / 目標) の色分けチップ */
export function ContextChip({
  kind,
  label,
}: {
  kind: ContextChipKind;
  label: string;
}) {
  const style = KIND_STYLE[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-bold ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}

export function ContextChipRow({
  repo,
  domain,
  goal,
}: {
  repo?: string | null;
  domain?: string | null;
  goal?: string | null;
}) {
  if (!repo && !domain && !goal) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {repo && <ContextChip kind="repo" label={repo} />}
      {domain && <ContextChip kind="domain" label={domain} />}
      {goal && <ContextChip kind="goal" label={goal} />}
    </div>
  );
}
