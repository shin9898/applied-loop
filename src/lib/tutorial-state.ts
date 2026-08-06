/**
 * チュートリアル進行の永続化（~/.applied-loop/tutorial-state.json）。
 * DB を増やさず、MCP 疎通時刻や LLM 道の選択を残す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TutorialLlmTrack } from "@/lib/tutorial-constants";
import { recordActivationOnce } from "@/lib/activation-funnel";

export type TutorialState = {
  llmTrack?: TutorialLlmTrack | null;
  /** LLM 道を選んだ時刻 (ISO)。これより前の MCP 疎通は「貼る」完了に使わない */
  llmTrackAt?: string | null;
  /** 直近の MCP 認証成功時刻 (ISO) */
  mcpLastAt?: string | null;
  /** コピペステップを「できた」と自己申告、または選択後の MCP 疎通で完了 */
  llmStepDone?: boolean;
  hookSkipped?: boolean;
  completedAt?: string | null;
};

const STATE_PATH = join(homedir(), ".applied-loop", "tutorial-state.json");

export function tutorialStatePath(): string {
  return STATE_PATH;
}

export function readTutorialState(): TutorialState {
  try {
    if (!existsSync(STATE_PATH)) return {};
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as TutorialState;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeTutorialState(patch: Partial<TutorialState>): TutorialState {
  const next = { ...readTutorialState(), ...patch };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** LLM 選択後に発生した MCP 疎通か（貼るステップの完了判定） */
export function mcpCountsForLlmStep(state: TutorialState = readTutorialState()): boolean {
  if (state.llmStepDone) return true;
  if (!state.llmTrack || !state.llmTrackAt || !state.mcpLastAt) return false;
  const pick = Date.parse(state.llmTrackAt);
  const mcp = Date.parse(state.mcpLastAt);
  if (Number.isNaN(pick) || Number.isNaN(mcp)) return false;
  return mcp >= pick;
}

/** MCP 疎通を記録（認証成功時）。LLM 選択より後なら貼るステップも完了にする */
export function touchMcpActivity(): void {
  const now = new Date().toISOString();
  const state = readTutorialState();
  const patch: Partial<TutorialState> = { mcpLastAt: now };
  if (state.llmTrack && state.llmTrackAt) {
    const pick = Date.parse(state.llmTrackAt);
    if (!Number.isNaN(pick) && Date.parse(now) >= pick) {
      patch.llmStepDone = true;
    }
  }
  writeTutorialState(patch);
  recordActivationOnce("mcp_touched");
}

/** @deprecated 選択前の疎通まで含めてしまうので、貼る完了判定には mcpCountsForLlmStep を使う */
export function mcpTouchedRecently(withinMs = 7 * 24 * 60 * 60 * 1000): boolean {
  const at = readTutorialState().mcpLastAt;
  if (!at) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= withinMs;
}
