/**
 * 根因分類 → 次にやるべき一手 (ADR-0011)。
 * UI / MCP / デブリーフで共通利用。
 */
import type { GradePayload } from "@/lib/grade-payload";

export type RootCauseNext = {
  cause: NonNullable<GradePayload["rootCause"]>;
  label: string;
  focus: string;
  actions: { label: string; href: string; reason: string }[];
};

export function rootCauseNextSteps(
  cause: GradePayload["rootCause"] | null | undefined,
): RootCauseNext | null {
  if (cause === "knowledge") {
    return {
      cause,
      label: "知識不足",
      focus: "インプットを足してから、同じ概念でもう一度説明できるか試せ。",
      actions: [
        {
          label: "にっきで学びを拾う",
          href: "/entries",
          reason: "足りない知識を Entry として残す",
        },
        {
          label: "ずかんで同系統を見る",
          href: "/zukan",
          reason: "似たつまずきの解消パターンを見る",
        },
      ],
    };
  }
  if (cause === "verification") {
    return {
      cause,
      label: "確認不足",
      focus: "AI / ハーネス出力を鵜呑みにしていた。観測と処方で検証手順を直せ。",
      actions: [
        {
          label: "どうぐ（処方）を見る",
          href: "/harness",
          reason: "cache / harness の観測から確認手順を補強",
        },
        {
          label: "原理（プロンプトキャッシュ）",
          href: "/harness/concepts/prompt-cache",
          reason: "確認すべき境界を言語化する",
        },
      ],
    };
  }
  if (cause === "premise") {
    return {
      cause,
      label: "前提の誤認",
      focus: "状況理解がズレていた。要件・前提を明示してから再挑戦せよ。",
      actions: [
        {
          label: "ようけんを見る",
          href: "/requirements",
          reason: "委譲要件と理解ゲートの対応を確認",
        },
        {
          label: "もくひょう（KDI）",
          href: "/goals",
          reason: "今の焦点ドメインと前提が合っているか見る",
        },
      ],
    };
  }
  return null;
}

export function formatRootCauseNextMarkdown(
  cause: GradePayload["rootCause"] | null | undefined,
): string | null {
  const n = rootCauseNextSteps(cause);
  if (!n) return null;
  return [
    `## 根因: ${n.label}`,
    n.focus,
    "",
    "### 次の一手",
    ...n.actions.map((a) => `- ${a.label}: ${a.reason} (${a.href})`),
  ].join("\n");
}
