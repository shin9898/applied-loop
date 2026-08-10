/**
 * ホームの単一プライマリ CTA（B3-2 / ADR-0020 C3-3）。
 * どの状態でも「いま押すボタン」は1個。
 */

import type { TextbookGuidance } from "@/lib/textbook-guidance";

export type HomeCtaKind =
  | "setup"
  | "textbook"
  | "fight"
  | "hook"
  | "wait";

export type HomeCta = {
  kind: HomeCtaKind;
  href: string;
  label: string;
  title: string;
  body: string;
};

export function resolveHomeCta(input: {
  essentialsReady: boolean;
  tutorialSampleSubmitted: boolean;
  tutorialReady: boolean;
  pendingGateId: string | null;
  pendingGateTitle?: string | null;
  gitHookInstalled: boolean;
  /** 昨日 Mastery / きょうのしょ からの導線（tutorial 後・しれんより優先） */
  textbookGuidance?: TextbookGuidance | null;
}): HomeCta {
  if (!input.essentialsReady) {
    return {
      kind: "setup",
      href: "/setup",
      label: "じゅんびへ",
      title: "まずじゅんびを整える",
      body: "合言葉（MCP_TOKEN）など、必須の支度がまだ足りぬ。じゅんび画面で✓にするのじゃ。",
    };
  }

  if (!input.tutorialSampleSubmitted || !input.tutorialReady) {
    return {
      kind: "setup",
      href: "/setup",
      label: "じゅんびへ",
      title: input.tutorialSampleSubmitted
        ? "チュートリアルのつぎの一手"
        : "サンプルしれんを1問提出する",
      body: input.tutorialSampleSubmitted
        ? "じゅんびで LLM を選び、貼る文を1回呼ぶのじゃ。"
        : "Web のたたかうで、サンプルしれんに自分の言葉を書いて提出せよ。",
    };
  }

  // C3-3: Mastery 導線は pending しれんより先（日次ループが本線）
  if (input.textbookGuidance) {
    const g = input.textbookGuidance;
    return {
      kind: "textbook",
      href: g.href,
      label: g.label,
      title: g.title,
      body: g.body,
    };
  }

  if (input.pendingGateId) {
    return {
      kind: "fight",
      href: `/gates/${input.pendingGateId}`,
      label: "たたかう",
      title: input.pendingGateTitle?.trim() || "つぎのしれん",
      body: "たたかう画面で問い全文を読み、自分の言葉でこたえるのじゃ。",
    };
  }

  if (!input.gitHookInstalled) {
    return {
      kind: "hook",
      href: "/setup#watched-repos",
      label: "監視を入れる",
      title: "監視リポジトリがまだない",
      body: "じゅんびで仕事 repo を選び鉤をかけると、その commit からしれんが増える。",
    };
  }

  return {
    kind: "wait",
    href: "/retro",
    label: "きょうのしょ",
    title: "いま挑めるしれんはない",
    body: "監視はかかっておる。夜はきょうのしょで材料を圧縮し、Mastery で翌日を決めよ。",
  };
}
