/**
 * しれん空状態の出し分け（B2-2 / B7-3）。
 */

export type GatesSupplyKind =
  | "has_items"
  | "all_clear"
  | "no_hook"
  | "gen_failed_auth"
  | "gen_failed_other"
  | "waiting_commit";

export type GatesSupplyState = {
  kind: GatesSupplyKind;
  title: string;
  body: string;
  href?: string;
  cta?: string;
};

export function resolveGatesSupplyState(input: {
  itemCount: number;
  everHadGate: boolean;
  gitHookInstalled: boolean;
  genFailures: { auth: number; other: number };
}): GatesSupplyState {
  if (input.itemCount > 0) {
    return {
      kind: "has_items",
      title: "",
      body: "",
    };
  }

  if (input.everHadGate) {
    return {
      kind: "all_clear",
      title: "しれんはすべて CLEAR のようじゃ",
      body: "次のコミットで種が生えれば、またここに並ぶ。ずかんで過去のつまずきを見返せ。",
      href: "/zukan",
      cta: "ずかんを見る",
    };
  }

  if (!input.gitHookInstalled) {
    return {
      kind: "no_hook",
      title: "監視リポジトリがない",
      body: "じゅんびで repo を選び鉤をかけると、その commit からしれんが増える。request_gate でも供給できる。",
      href: "/setup#watched-repos",
      cta: "監視を入れる",
    };
  }

  if (input.genFailures.auth > 0) {
    return {
      kind: "gen_failed_auth",
      title: "しれん生成が認証で止まっておる",
      body: `直近24hで認証失敗 ${input.genFailures.auth} 件。claude / codex にログインし直し、コミットし直すか npm run regrade を試せ。`,
      href: "/setup",
      cta: "じゅんびで診断",
    };
  }

  if (input.genFailures.other > 0) {
    return {
      kind: "gen_failed_other",
      title: "しれん生成が失敗しておる",
      body: `直近24hで生成失敗 ${input.genFailures.other} 件。ログを確認し、コミットし直すか環境を見直せ。`,
      href: "/setup",
      cta: "じゅんびで診断",
    };
  }

  return {
    kind: "waiting_commit",
    title: "まだしれんが生えておらぬ",
    body: "鉤はかかっておる。自分の repo でコミットすると種が拾われる。サンプルはじゅんびから。",
    href: "/setup",
    cta: "じゅんびへ",
  };
}
