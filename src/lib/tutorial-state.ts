/**
 * チュートリアル進行の永続化（~/.applied-loop/tutorial-state.json）。
 * DB を増やさず、MCP 疎通時刻や LLM 道の選択を残す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TutorialLlmTrack } from "@/lib/tutorial-constants";

export type TutorialState = {
  llmTrack?: TutorialLlmTrack | null;
  /** 直近の MCP 認証成功時刻 (ISO) */
  mcpLastAt?: string | null;
  /** コピペステップを「できた」と自己申告、または MCP 疎通で完了 */
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

/** MCP 疎通を記録（認証成功時） */
export function touchMcpActivity(): void {
  writeTutorialState({ mcpLastAt: new Date().toISOString() });
}

/** 直近 withinMs 以内に MCP 呼び出しがあったか */
export function mcpTouchedRecently(withinMs = 7 * 24 * 60 * 60 * 1000): boolean {
  const at = readTutorialState().mcpLastAt;
  if (!at) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= withinMs;
}
