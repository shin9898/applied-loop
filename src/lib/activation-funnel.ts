/**
 * Activation ファネル（B9-1 / B9-2）。
 * ~/.applied-loop/activation-events.jsonl に追記し、スクリプトで集計する。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ACTIVATION_STEPS = [
  "setup_opened",
  "sample_started",
  "sample_submitted",
  "mcp_touched",
  "first_verdict",
  "hook_installed",
  "first_complete",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

export type ActivationEvent = {
  step: ActivationStep;
  at: string;
  meta?: Record<string, string | number | boolean | null>;
};

const EVENTS_PATH = join(homedir(), ".applied-loop", "activation-events.jsonl");

export function activationEventsPath(): string {
  return EVENTS_PATH;
}

export function recordActivation(
  step: ActivationStep,
  meta?: ActivationEvent["meta"],
): void {
  try {
    mkdirSync(dirname(EVENTS_PATH), { recursive: true });
    const row: ActivationEvent = {
      step,
      at: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    };
    appendFileSync(EVENTS_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[activation] record failed:", e);
  }
}

/** 初回のみ記録（同じ step が既にあればスキップ） */
export function recordActivationOnce(
  step: ActivationStep,
  meta?: ActivationEvent["meta"],
): void {
  const events = readActivationEvents();
  if (events.some((e) => e.step === step)) return;
  recordActivation(step, meta);
}

export function readActivationEvents(): ActivationEvent[] {
  try {
    if (!existsSync(EVENTS_PATH)) return [];
    return readFileSync(EVENTS_PATH, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as ActivationEvent;
          if (!row?.step || !row?.at) return [];
          return [row];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export type FunnelReport = {
  steps: {
    step: ActivationStep;
    count: number;
    firstAt: string | null;
  }[];
  /** setup_opened → first_complete の所要（分）。欠ける場合 null */
  firstCompleteMinutes: number | null;
  completed: boolean;
};

export function buildFunnelReport(
  events: ActivationEvent[] = readActivationEvents(),
): FunnelReport {
  const steps = ACTIVATION_STEPS.map((step) => {
    const hits = events.filter((e) => e.step === step);
    return {
      step,
      count: hits.length,
      firstAt: hits[0]?.at ?? null,
    };
  });
  const setup = steps.find((s) => s.step === "setup_opened")?.firstAt;
  const done = steps.find((s) => s.step === "first_complete")?.firstAt;
  let firstCompleteMinutes: number | null = null;
  if (setup && done) {
    const ms = Date.parse(done) - Date.parse(setup);
    if (!Number.isNaN(ms) && ms >= 0) {
      firstCompleteMinutes = Math.round(ms / 60000);
    }
  }
  return {
    steps,
    firstCompleteMinutes,
    completed: Boolean(done),
  };
}

/** 初回完走: サンプル提出＋MCP疎通＋（CLEAR or miss の初判定） */
export function maybeRecordFirstComplete(flags: {
  sampleSubmitted: boolean;
  mcpTouched: boolean;
  hasVerdict: boolean;
}): void {
  if (!flags.sampleSubmitted || !flags.mcpTouched || !flags.hasVerdict) return;
  recordActivationOnce("first_complete");
}
