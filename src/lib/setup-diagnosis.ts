import net from "node:net";
import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST } from "@/lib/date";
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";
import { isTutorialGateSubmitted } from "@/lib/tutorial-seed";
import {
  buildMcpClientSnippets,
  getMcpEndpointInfo,
  probeReachableMcpUrl,
  type McpClientSnippets,
  type McpEndpointInfo,
} from "@/lib/mcp-endpoint";
import {
  mcpCountsForLlmStep,
  mcpTouchedRecently,
  readTutorialState,
} from "@/lib/tutorial-state";
import { recentGenFailures } from "@/lib/gate";
import {
  hookBodyInstalled,
  probeWatchedRepos,
  repoLabel,
  summarizeWatched,
  type WatchedRepoStatus,
} from "@/lib/watched-repos";

export type SetupCheckId =
  | "app"
  | "mcp_token"
  | "terminal_env"
  | "terminal_up"
  | "git_hook"
  | "grading_cli"
  | "first_gate"
  | "first_learning"
  | "tutorial_sample"
  | "mcp_touch"
  | "tutorial_done"
  | "cloud_mcp";

export type SetupCheck = {
  id: SetupCheckId;
  /** 天の声寄りの短いラベル */
  label: string;
  ok: boolean;
  required: boolean;
  /** plain だけでは分からない実データ（件数・接続状況等）がある項目のみ */
  detail?: string;
  /** 具体コマンド・操作（手引） */
  howTo: string;
  /** 機能として何が起きるか（平易） */
  plain: string;
};

export type SetupDiagnosis = {
  checks: SetupCheck[];
  readyRequired: number;
  totalRequired: number;
  /** 必須項目がすべて OK */
  essentialsReady: boolean;
  /** 次に手を付ける必須／推奨ステップ */
  nextCheckId: SetupCheckId | null;
  todayTaskMapped: boolean;
  yesterdayTaskMapped: boolean;
  /** サンプルしれん提出済み */
  tutorialSampleSubmitted: boolean;
  /** 直近に MCP 疎通あり */
  mcpRecent: boolean;
  /** 直近の MCP 認証成功時刻 (ISO)。Cloud ウィザードの疎通検知用 */
  mcpLastAt: string | null;
  /** 初心者チュートリアル完了 */
  tutorialReady: boolean;
  tutorialGateId: string;
  /** MCP URL（local + Reachable の Dual） */
  mcpEndpoint: McpEndpointInfo;
  /** 手元 Desktop / CLI 向け（常に localhost） */
  localMcpSnippets: McpClientSnippets;
  /**
   * Cloud / 外部クライアント向け。
   * Reachable 未設定時は local と同じ（トンネル前のプレースホルダ）。
   */
  mcpSnippets: McpClientSnippets;
  /** Reachable URL の簡易疎通（未設定は n/a） */
  reachableProbe: "ok" | "fail" | "n/a";
  /** git hook 本体が ~/.applied-loop にあるか */
  gitHookInstalled: boolean;
  /** 監視登録した repo と接続状態（リポジトリ粒度） */
  watchedRepos: WatchedRepoStatus[];
  /** 直近24h のしれん生成失敗 */
  genFailures: { auth: number; other: number };
};

function probePort(host: string, port: number, ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    socket.on("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

/** ホーム／道案内用のセットアップ診断 */
export async function loadSetupDiagnosis(opts?: {
  /** /setup のみ true。採点 CLI を dry-run する（G7） */
  gradingDryRun?: boolean;
  /** /setup のみ true。live probe を呼ばず、直近のキャッシュ結果を表示する */
  gradingFromCache?: boolean;
}): Promise<SetupDiagnosis> {
  const mcpEndpoint = getMcpEndpointInfo();
  const mcpToken = mcpEndpoint.tokenConfigured;
  const localMcpSnippets = buildMcpClientSnippets({
    mcpUrl: mcpEndpoint.localMcpUrl,
    token: process.env.MCP_TOKEN,
  });
  const mcpSnippets = buildMcpClientSnippets({
    mcpUrl: mcpEndpoint.reachableMcpUrl ?? mcpEndpoint.localMcpUrl,
    token: process.env.MCP_TOKEN,
  });
  const reachableProbe = await probeReachableMcpUrl(
    mcpEndpoint.reachableMcpUrl,
  );
  const terminalEnv = process.env.ENABLE_TERMINAL === "true" && mcpToken;
  const terminalUp = terminalEnv
    ? await probePort("127.0.0.1", 3101)
    : false;

  const gitHook = hookBodyInstalled();
  const watchedRepos = probeWatchedRepos();
  const watchedSummary = summarizeWatched(watchedRepos);
  const tutorialState = readTutorialState();
  const mcpRecent = mcpTouchedRecently();
  const sampleSubmitted = await isTutorialGateSubmitted();
  const llmStepDone = mcpCountsForLlmStep(tutorialState);
  const tutorialReady = Boolean(
    mcpToken &&
      sampleSubmitted &&
      tutorialState.llmTrack &&
      llmStepDone &&
      (tutorialState.completedAt ||
        watchedSummary.anyConnected ||
        tutorialState.hookSkipped ||
        // 移行猶予: 旧「鉤本体だけ」完了も認める
        gitHook),
  );

  const now = new Date();
  const todayKey = dateKeyJST(now);
  const y = new Date(dayStartJST(now).getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dateKeyJST(y);

  const grading = opts?.gradingDryRun
    ? await (await import("@/lib/grading-probe")).probeGradingCliLive()
    : opts?.gradingFromCache
      ? (await import("@/lib/grading-probe")).cachedGradingProbeResult()
      : (await import("@/lib/grading-probe")).probeGradingPathOnly();
  const [gateCount, learningCount, todayMap, yesterdayMap, genFailures] =
    await Promise.all([
      prisma.gate.count(),
      Promise.all([
        prisma.entry.count(),
        prisma.capture.count(),
      ]).then(([e, c]) => e + c),
      prisma.dailyTaskMap.findUnique({
        where: { dateKey: todayKey },
        select: { id: true },
      }),
      prisma.dailyTaskMap.findUnique({
        where: { dateKey: yesterdayKey },
        select: { id: true },
      }),
      recentGenFailures(),
    ]);

  const checks: SetupCheck[] = [
    {
      id: "app",
      label: "ぼうけんのしょは開いておる",
      ok: true,
      required: true,
      howTo: "`npm run dev:all`（または `npm run dev -- -p 3100`）",
      plain: "Next.js アプリが http://localhost:3100 で動いている状態。",
    },
    {
      id: "mcp_token",
      label: "合言葉（MCP_TOKEN）がある",
      ok: mcpToken,
      required: true,
      howTo:
        "`npm run setup` で自動生成（弱い／空の TOKEN も書き戻す）。その後 `npm run dev:all` で再起動",
      plain:
        "API・MCP・アプリ内じゅもんの共通パスワード。無いと外部 LLM もじゅもんも認証に失敗する。",
    },
    {
      id: "tutorial_sample",
      label: "サンプルしれんを提出した",
      ok: sampleSubmitted,
      required: false,
      howTo: `/setup の案内から『たたかう』→ 提出する（gate: ${TUTORIAL_GATE_ID}）`,
      plain:
        "MCP なしで、理解度チェックに自分の言葉を書いた体験。採点は後からでよい。",
    },
    {
      id: "mcp_touch",
      label: "MCP（またはじゅもん）が通った",
      ok: mcpRecent || Boolean(tutorialState.llmStepDone),
      required: false,
      howTo: "じゅんびで LLM を選んでから貼る文をチャットへ。または『できた』",
      plain: "本運用の入口。選択より前の疎通だけではクリアにならない。",
    },
    {
      id: "tutorial_done",
      label: "はじめのチュートリアルを終えた",
      ok: tutorialReady,
      required: false,
      howTo: "/setup（じゅんび）のいまやる1手に従う",
      plain: "Web 1勝 → LLM を1回呼ぶ、まで。hook は任意。",
    },
    {
      id: "terminal_env",
      label: "じゅもんの祭壇が許されておる",
      ok: terminalEnv,
      required: false,
      howTo: ".env に `ENABLE_TERMINAL=true` を足し、`npm run dev:all`",
      plain:
        "ON にすると UI から Claude/Codex を開ける。OFF でも Cursor 等の外部 MCP だけで使える。",
    },
    {
      id: "terminal_up",
      label: "じゅもんの火が灯っておる（:3101）",
      ok: terminalUp,
      required: false,
      howTo: "`npm run dev:all`（ちず :3100 とじゅもん :3101）",
      plain:
        "terminal-server がポート 3101 で待っているか。無いと『じゅもんをとなえる』が接続エラーになる。",
    },
    {
      id: "cloud_mcp",
      label: "Cloud の生成AIから届く MCP URL",
      ok:
        !mcpEndpoint.reachable ||
        (mcpEndpoint.reachable && mcpToken && reachableProbe !== "fail"),
      required: false,
      detail: !mcpEndpoint.reachable
        ? `Desktop 用は ${mcpEndpoint.localMcpUrl}。Cloud には届かぬ——青い任意カードへ`
        : !mcpToken
          ? `URL はあるが合言葉がない（${mcpEndpoint.reachableBaseUrl}）`
          : reachableProbe === "fail"
            ? `Reachable が応答しない（古いトンネルの可能性）: ${mcpEndpoint.reachableMcpUrl}。Desktop は ${mcpEndpoint.localMcpUrl} のまま`
            : `Reachable: ${mcpEndpoint.reachableMcpUrl}（Desktop は ${mcpEndpoint.localMcpUrl}）`,
      howTo:
        "/setup『Cloud の生成AIからも同じループ』ウィザード（選ぶ→トンネル→登録→疎通）。Desktop の mcp.json には localhost だけ書く。または `npm run mcp:cloud-config`",
      plain:
        "手元 AI は常に localhost。Cloud Agent など別ホストだけ Reachable（トンネル）を使う。Desktop 設定にトンネル URL を書かない（ADR-0018）。",
    },
    {
      id: "git_hook",
      label: "足跡を拾う鉤（監視リポジトリ）",
      ok: watchedSummary.anyConnected,
      required: false,
      detail: (() => {
        if (watchedSummary.total === 0) {
          return gitHook
            ? "鉤本体はあるが、監視リポジトリが未選択。仕事 repo を選ばないと学びは自動では溜まらぬ"
            : "監視リポジトリ未選択。選んで鉤をかけぬ限り、コミットからしれんは増えぬ（request_gate は別経路）";
        }
        const lines = watchedRepos.map((r) => {
          const name = repoLabel(r);
          if (!r.isGit) return `${name}: 未接続（git ではない）`;
          return r.connected ? `${name}: 監視中` : `${name}: 未接続（鉤なし）`;
        });
        return `登録 ${watchedSummary.total} / 監視中 ${watchedSummary.connected} — ${lines.join(" · ")}`;
      })(),
      howTo:
        "/setup の『監視リポジトリ』でパスを追加し『鉤をかける』。または `./scripts/setup-git-hook.sh /path/to/repo`",
      plain:
        "選んだリポジトリへの git commit だけがしれんの種になる。GitHub の PR 作成だけでは溜まらない。Cloud 作業が主なら request_gate か、今は飛ばしてもよい。",
    },
    {
      id: "grading_cli",
      label: "採点の賢者（claude/codex CLI）",
      ok: grading.ok,
      required: false,
      detail:
        !grading.ok && genFailures.auth + genFailures.other > 0
          ? `${grading.detail}（直近の生成失敗: auth ${genFailures.auth} / other ${genFailures.other}）`
          : grading.detail,
      howTo: grading.howTo,
      plain:
        "提出後の採点はヘッドレス LLM（claude または codex）。無い／認証切れだと保留になり、CLI が戻ると自動再採点を試す。認証まで確認したいときは下のボタンで賢者に伺いを立てよ。",
    },
    {
      id: "first_gate",
      label: "しれんの気配がある",
      ok: gateCount > 0,
      required: false,
      detail: gateCount > 0 ? `しれん ${gateCount} 件が待つ` : undefined,
      howTo: "/setup を開く（サンプル seed）または hook 後にコミット",
      plain:
        "しれんが1件以上ある。ホームの『たたかう』や /gates で解ける。",
    },
    {
      id: "first_learning",
      label: "学びの足跡がある",
      ok: learningCount > 0,
      required: false,
      detail: learningCount > 0 ? `足跡 ${learningCount} 件` : undefined,
      howTo: "/setup のサンプル seed、または capture_learning_candidate",
      plain:
        "にっきまたは受信箱の候補が1件以上。学びが並び始める。",
    },
  ];

  const required = checks.filter((c) => c.required);
  const readyRequired = required.filter((c) => c.ok).length;
  const essentialsReady = required.every((c) => c.ok);
  const next =
    checks.find((c) => c.required && !c.ok) ??
    checks.find((c) => !c.required && !c.ok && c.id === "tutorial_sample") ??
    checks.find((c) => !c.required && !c.ok && c.id === "mcp_touch") ??
    checks.find((c) => !c.required && !c.ok && c.id === "tutorial_done") ??
    checks.find((c) => !c.required && !c.ok) ??
    null;

  return {
    checks,
    readyRequired,
    totalRequired: required.length,
    essentialsReady,
    nextCheckId: next?.id ?? null,
    todayTaskMapped: !!todayMap,
    yesterdayTaskMapped: !!yesterdayMap,
    tutorialSampleSubmitted: sampleSubmitted,
    mcpRecent,
    mcpLastAt: tutorialState.mcpLastAt ?? null,
    tutorialReady,
    tutorialGateId: TUTORIAL_GATE_ID,
    mcpEndpoint,
    localMcpSnippets,
    mcpSnippets,
    reachableProbe,
    gitHookInstalled: gitHook || watchedSummary.anyConnected,
    watchedRepos,
    genFailures,
  };
}
