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

export async function loadTutorialProgress(
  diagnosis: SetupDiagnosis,
): Promise<TutorialProgress> {
  const state = readTutorialState();
  const sampleSubmitted = await isTutorialGateSubmitted();
  const mcpRecent = mcpTouchedRecently();
  // 貼る完了: 自己申告 or「LLM選択より後」の MCP 疎通のみ（既存疎通では飛ばさない）
  const llmStepDone = mcpCountsForLlmStep(state);
  const tokenOk = diagnosis.checks.find((c) => c.id === "mcp_token")?.ok ?? false;
  const hookOk = diagnosis.checks.find((c) => c.id === "git_hook")?.ok ?? false;
  const llmTrack = state.llmTrack ?? null;

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
      label: "使う LLM を選ぶ",
      plain: "Claude Code / Cursor / Codex / じゅもん、のどれか。",
      done: Boolean(llmTrack),
    },
    {
      id: "llm_call",
      label: "貼るだけで1回呼ぶ",
      plain: "用意した文をチャットに貼る。MCP 疎通か「できた」で完了。",
      done: llmStepDone,
    },
    {
      id: "hook",
      label: "（任意）git hook でしれんを増やす",
      plain: "今は飛ばしてよい。毎日の自動生成用。",
      done: hookOk || Boolean(state.hookSkipped),
      optional: true,
    },
    {
      id: "done",
      label: "チュートリアル完了",
      plain: "本運用は朝の要約 → しれん → 学びの記録。",
      done: Boolean(state.completedAt),
    },
  ];

  let tutorialReady =
    tokenOk &&
    sampleSubmitted &&
    Boolean(llmTrack) &&
    llmStepDone &&
    (Boolean(state.completedAt) ||
      hookOk ||
      Boolean(state.hookSkipped));

  // completedAt が無くてもコアが揃えば current は done 扱いへ
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
    currentStepId = state.completedAt ? "done" : "hook";
    if (hookOk || state.hookSkipped) currentStepId = "done";
  }

  // hook 既存などで完了相当なのに completedAt が無い場合は書き留める
  let stateOut = state;
  if (tutorialReady && !state.completedAt && currentStepId === "done") {
    stateOut = writeTutorialState({
      completedAt: new Date().toISOString(),
    });
    const doneStep = steps.find((s) => s.id === "done");
    if (doneStep) doneStep.done = true;
  }

  return {
    steps,
    currentStepId,
    tutorialReady:
      tutorialReady ||
      Boolean(
        stateOut.completedAt && tokenOk && sampleSubmitted && llmStepDone,
      ),
    tutorialGateId: TUTORIAL_GATE_ID,
    llmTrack,
    state: stateOut,
    mcpRecent,
    sampleSubmitted,
  };
}
