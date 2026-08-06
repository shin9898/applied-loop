import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST } from "@/lib/date";
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";
import { isTutorialGateSubmitted } from "@/lib/tutorial-seed";
import {
  mcpTouchedRecently,
  readTutorialState,
} from "@/lib/tutorial-state";

export type SetupCheckId =
  | "app"
  | "mcp_token"
  | "terminal_env"
  | "terminal_up"
  | "git_hook"
  | "first_gate"
  | "first_learning"
  | "tutorial_sample"
  | "mcp_touch"
  | "tutorial_done";

export type SetupCheck = {
  id: SetupCheckId;
  /** 天の声寄りの短いラベル */
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
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
  /** 初心者チュートリアル完了 */
  tutorialReady: boolean;
  tutorialGateId: string;
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
export async function loadSetupDiagnosis(): Promise<SetupDiagnosis> {
  const mcpToken = Boolean(process.env.MCP_TOKEN?.trim());
  const terminalEnv = process.env.ENABLE_TERMINAL === "true" && mcpToken;
  const terminalUp = terminalEnv
    ? await probePort("127.0.0.1", 3101)
    : false;

  const hookBody = join(homedir(), ".applied-loop", "hooks", "post-commit");
  const gitHook = existsSync(hookBody);
  const tutorialState = readTutorialState();
  const mcpRecent = mcpTouchedRecently();
  const sampleSubmitted = await isTutorialGateSubmitted();
  const llmStepDone = Boolean(tutorialState.llmStepDone) || mcpRecent;
  const tutorialReady = Boolean(
    mcpToken &&
      sampleSubmitted &&
      tutorialState.llmTrack &&
      llmStepDone &&
      (tutorialState.completedAt ||
        gitHook ||
        tutorialState.hookSkipped),
  );

  const now = new Date();
  const todayKey = dateKeyJST(now);
  const y = new Date(dayStartJST(now).getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dateKeyJST(y);

  const [gateCount, learningCount, todayMap, yesterdayMap] = await Promise.all([
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
  ]);

  const checks: SetupCheck[] = [
    {
      id: "app",
      label: "ぼうけんのしょは開いておる",
      ok: true,
      required: true,
      detail: "この画面が見えておる——書はすでにそなたの前にある",
      howTo: "`npm run dev:all`（または `npm run dev -- -p 3100`）",
      plain: "Next.js アプリが http://localhost:3100 で動いている状態。",
    },
    {
      id: "mcp_token",
      label: "合言葉（MCP_TOKEN）がある",
      ok: mcpToken,
      required: true,
      detail: mcpToken
        ? "合言葉は .env に刻まれておる"
        : "合言葉がない。賢者ともじゅもんとも、扉が開かぬぞ",
      howTo:
        ".env に `MCP_TOKEN=<長い乱数>` を書き、サーバーを再起動する",
      plain:
        "API・MCP・アプリ内じゅもんの共通パスワード。無いと外部 LLM もじゅもんも認証に失敗する。",
    },
    {
      id: "tutorial_sample",
      label: "サンプルしれんを提出した",
      ok: sampleSubmitted,
      required: false,
      detail: sampleSubmitted
        ? "最初の1勝——提出まで届いておる"
        : "まだサンプルしれんが未提出。Web の『たたかう』で提出せよ",
      howTo: `/setup の案内から『たたかう』→ 提出する（gate: ${TUTORIAL_GATE_ID}）`,
      plain:
        "MCP なしで、理解度チェックに自分の言葉を書いた体験。採点は後からでよい。",
    },
    {
      id: "mcp_touch",
      label: "MCP（またはじゅもん）が通った",
      ok: mcpRecent || Boolean(tutorialState.llmStepDone),
      required: false,
      detail: mcpRecent
        ? "最近、MCP の扉が開いた記録がある"
        : tutorialState.llmStepDone
          ? "コピペ手順を「できた」と記した"
          : "まだ LLM 経由の操作記録がない",
      howTo: "じゅんびの貼る文をチャットへ。または『できた』を押す",
      plain: "本運用の入口。朝の要約やしれん回答が LLM から届く状態。",
    },
    {
      id: "tutorial_done",
      label: "はじめのチュートリアルを終えた",
      ok: tutorialReady,
      required: false,
      detail: tutorialReady
        ? "最短チュートリアルは完了しておる"
        : "じゅんびのウィザードを順に進めよ",
      howTo: "/setup（じゅんび）のいまやる1手に従う",
      plain: "Web 1勝 → LLM を1回呼ぶ、まで。hook は任意。",
    },
    {
      id: "terminal_env",
      label: "じゅもんの祭壇が許されておる",
      ok: terminalEnv,
      required: false,
      detail: terminalEnv
        ? "ENABLE_TERMINAL=true —— 画面内でじゅもんをとなえられる"
        : "画面内のじゅもんはまだ封じられておる（外の賢者だけで進むならそれでもよい）",
      howTo: ".env に `ENABLE_TERMINAL=true` を足し、`npm run dev:all`",
      plain:
        "ON にすると UI から Claude/Codex を開ける。OFF でも Cursor 等の外部 MCP だけで使える。",
    },
    {
      id: "terminal_up",
      label: "じゅもんの火が灯っておる（:3101）",
      ok: terminalUp,
      required: false,
      detail: terminalUp
        ? "祭壇は応えておる（WS :3101）"
        : "じゅもんを使うなら、火を灯せ——`npm run dev:all`",
      howTo: "`npm run dev:all`（ちず :3100 とじゅもん :3101）",
      plain:
        "terminal-server がポート 3101 で待っているか。無いと『じゅもんをとなえる』が接続エラーになる。",
    },
    {
      id: "git_hook",
      label: "足跡を拾う鉤（git hook）",
      ok: gitHook,
      required: false,
      detail: gitHook
        ? "鉤は ~/.applied-loop/hooks にかかっておる"
        : "鉤がまだない。コミットからしれんの種が生えぬぞ（今は飛ばしてよい）",
      howTo: "`./scripts/setup-git-hook.sh /path/to/your-repo`",
      plain:
        "git commit 後にイベントが送られ、理解度ゲート（しれん）候補が自動で増える。",
    },
    {
      id: "first_gate",
      label: "しれんの気配がある",
      ok: gateCount > 0,
      required: false,
      detail:
        gateCount > 0
          ? `しれん ${gateCount} 件が待つ`
          : "まだしれんがない。じゅんびでサンプルを用意せよ",
      howTo: "/setup を開く（サンプル seed）または hook 後にコミット",
      plain:
        "データベースに Gate が1件以上ある。ホームの『たたかう』や /gates で解ける。",
    },
    {
      id: "first_learning",
      label: "学びの足跡がある",
      ok: learningCount > 0,
      required: false,
      detail:
        learningCount > 0
          ? `足跡 ${learningCount} 件`
          : "まだ学びが落ちておらぬ。サンプルまたはじゅもんで拾わせよ",
      howTo: "/setup のサンプル seed、または capture_learning_candidate",
      plain:
        "Entry または Capture が1件以上。にっき／受信箱に学びが並び始める。",
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
    tutorialReady,
    tutorialGateId: TUTORIAL_GATE_ID,
  };
}
