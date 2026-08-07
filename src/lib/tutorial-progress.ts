/**
 * チュートリアル・ウィザードの進行計算。
 */
import type { SetupDiagnosis } from "@/lib/setup-diagnosis";
import type { TutorialLlmTrack } from "@/lib/tutorial-constants";
import { TUTORIAL_GATE_ID } from "@/lib/tutorial-constants";
import { isTutorialGateSubmitted } from "@/lib/tutorial-seed";
import {
  mcpCountsForLlmStep,
  mcpTouchedRecently,
  readTutorialState,
  writeTutorialState,
  type TutorialState,
} from "@/lib/tutorial-state";

export type TutorialStepId =
  | "token"
  | "sample_gate"
  | "llm_pick"
  | "llm_call"
  | "hook"
  | "done";

export type TutorialProgress = {
  steps: {
    id: TutorialStepId;
    label: string;
    plain: string;
    done: boolean;
    optional?: boolean;
  }[];
  currentStepId: TutorialStepId;
  /** 初心者チュートリアル完了（本運用の hook までは必須にしない） */
  tutorialReady: boolean;
  tutorialGateId: string;
  llmTrack: TutorialLlmTrack | null;
  state: TutorialState;
  mcpRecent: boolean;
  sampleSubmitted: boolean;
};

export type TutorialProgressInput = {
  tokenOk: boolean;
  sampleSubmitted: boolean;
  llmTrack: TutorialLlmTrack | null;
  llmStepDone: boolean;
  hookOk: boolean;
  hookSkipped: boolean;
  completedAt: string | null | undefined;
};

/** 純関数: 分岐判定（B4-5）。副作用なし */
export function computeTutorialProgress(input: TutorialProgressInput): {
  steps: TutorialProgress["steps"];
  currentStepId: TutorialStepId;
  tutorialReady: boolean;
  shouldPersistCompletedAt: boolean;
} {
  const {
    tokenOk,
    sampleSubmitted,
    llmTrack,
    llmStepDone,
    hookOk,
    hookSkipped,
    completedAt,
  } = input;

  const steps: TutorialProgress["steps"] = [
    {
      id: "token",
      label: "合言葉（MCP_TOKEN）を用意する",
      plain: ".env に共有トークンを書き、サーバーを再起動する。",
      done: tokenOk,
    },
    {
      id: "sample_gate",
      label: "サンプルしれんを1問提出する",
      plain: "Web の『たたかう』で自分の言葉を書いて提出。合格待ちでよい。",
      done: sampleSubmitted,
    },
    {
      id: "llm_pick",
      label: "自分の LLM を選ぶ（つなぐ道）",
      plain:
        "Claude Code / Cursor / Codex / じゅもん。ここで選んだ側に Applied Loop をつなぐ。",
      done: Boolean(llmTrack),
    },
    {
      id: "llm_call",
      label: "自分の LLM に MCP をつなぐ（貼る1回）",
      plain:
        "用意した文を選んだ LLM に貼る。疎通できれば接続完了（ツール名は覚えなくてよい）。",
      done: llmStepDone,
    },
    {
      id: "hook",
      label: "（任意）監視リポジトリを選ぶ",
      plain:
        "commit 供給の対象 repo を選び鉤をかける。未選択なら自動では溜まらない。Cloud 主なら飛ばしてよい。",
      done: hookOk || hookSkipped,
      optional: true,
    },
    {
      id: "done",
      label: "チュートリアル完了",
      plain: "本運用は朝の要約 → しれん → 学びの記録。供給は監視中 repo の commit か request_gate。",
      done: Boolean(completedAt),
    },
  ];

  let tutorialReady =
    tokenOk &&
    sampleSubmitted &&
    Boolean(llmTrack) &&
    llmStepDone &&
    (Boolean(completedAt) || hookOk || hookSkipped);

  let currentStepId: TutorialStepId = "done";
  for (const s of steps) {
    if (s.id === "done") continue;
    if (!s.done) {
      currentStepId = s.id;
      break;
    }
  }
  if (
    currentStepId === "done" &&
    tokenOk &&
    sampleSubmitted &&
    llmTrack &&
    llmStepDone
  ) {
    currentStepId = completedAt ? "done" : "hook";
    if (hookOk || hookSkipped) currentStepId = "done";
  }

  const shouldPersistCompletedAt =
    tutorialReady && !completedAt && currentStepId === "done";

  if (shouldPersistCompletedAt) {
    const doneStep = steps.find((s) => s.id === "done");
    if (doneStep) doneStep.done = true;
  }

  tutorialReady =
    tutorialReady ||
    Boolean(completedAt && tokenOk && sampleSubmitted && llmStepDone);

  return {
    steps,
    currentStepId,
    tutorialReady,
    shouldPersistCompletedAt,
  };
}

export async function loadTutorialProgress(
  diagnosis: SetupDiagnosis,
): Promise<TutorialProgress> {
  const state = readTutorialState();
  const sampleSubmitted = await isTutorialGateSubmitted();
  const mcpRecent = mcpTouchedRecently();
  const llmStepDone = mcpCountsForLlmStep(state);
  const tokenOk = diagnosis.checks.find((c) => c.id === "mcp_token")?.ok ?? false;
  const hookOk = diagnosis.checks.find((c) => c.id === "git_hook")?.ok ?? false;
  const llmTrack = state.llmTrack ?? null;

  const computed = computeTutorialProgress({
    tokenOk,
    sampleSubmitted,
    llmTrack,
    llmStepDone,
    hookOk,
    hookSkipped: Boolean(state.hookSkipped),
    completedAt: state.completedAt,
  });

  let stateOut = state;
  if (computed.shouldPersistCompletedAt) {
    stateOut = writeTutorialState({
      completedAt: new Date().toISOString(),
    });
  }

  return {
    steps: computed.steps,
    currentStepId: computed.currentStepId,
    tutorialReady: computed.tutorialReady,
    tutorialGateId: TUTORIAL_GATE_ID,
    llmTrack,
    state: stateOut,
    mcpRecent,
    sampleSubmitted,
  };
}
