/**
 * ホームの単一プライマリ CTA（B3-2）。
 * どの状態でも「いま押すボタン」は1個。
 */

export type HomeCtaKind = "setup" | "fight" | "hook" | "wait";

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
      href: "/setup#git-hook",
      label: "鉤を入れる",
      title: "しれんの種を拾う鉤がまだない",
      body: "自分の repo に git hook を入れると、コミットからしれんが増える。じゅんびの鉤ステップへ。",
    };
  }

  return {
    kind: "wait",
    href: "/gates",
    label: "しれんを見る",
    title: "いま挑めるしれんはない",
    body: "鉤はかかっておる。次のコミットを待つ、またはしれん一覧で CLEAR 済みを見返せ。",
  };
}
