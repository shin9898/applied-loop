/**
 * Activation ファネル（B9-1 / B9-2 / Fable G8）。
 * 正本7点: setup→サンプル提出→MCP疎通→初供給→初回答→初判定→ずかん閲覧
 * ~/.applied-loop/activation-events.jsonl に追記し、スクリプトで集計する。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 合否に使う正本7点（Fable B9-1） */
export const ACTIVATION_STEPS = [
  "setup_opened",
  "sample_submitted",
  "mcp_touched",
  "first_supply",
  "first_answer",
  "first_verdict",
  "zukan_viewed",
] as const;

/** 補助イベント（集計の7点には入れないが記録はする） */
export const ACTIVATION_EXTRA_STEPS = [
  "sample_started",
  "hook_installed",
  "first_complete",
] as const;

export type ActivationStep =
  | (typeof ACTIVATION_STEPS)[number]
  | (typeof ACTIVATION_EXTRA_STEPS)[number];

export type ActivationEvent = {
  step: ActivationStep;
  at: string;
  meta?: Record<string, string | number | boolean | null>;
};

const EVENTS_PATH = join(homedir(), ".applied-loop", "activation-events.jsonl");

const ALL_STEPS = new Set<string>([
  ...ACTIVATION_STEPS,
  ...ACTIVATION_EXTRA_STEPS,
]);

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
          if (!row?.step || !row?.at || !ALL_STEPS.has(row.step)) return [];
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
    step: (typeof ACTIVATION_STEPS)[number];
    count: number;
    firstAt: string | null;
  }[];
  /** setup_opened → first_complete（補助）または zukan_viewed の所要（分） */
  firstCompleteMinutes: number | null;
  completed: boolean;
  missing: (typeof ACTIVATION_STEPS)[number][];
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
  const zukan = steps.find((s) => s.step === "zukan_viewed")?.firstAt;
  const completeExtra = events.find((e) => e.step === "first_complete")?.at;
  const end = zukan ?? completeExtra ?? null;
  let firstCompleteMinutes: number | null = null;
  if (setup && end) {
    const ms = Date.parse(end) - Date.parse(setup);
    if (!Number.isNaN(ms) && ms >= 0) {
      firstCompleteMinutes = Math.round(ms / 60000);
    }
  }
  const missing = steps.filter((s) => s.count === 0).map((s) => s.step);
  return {
    steps,
    firstCompleteMinutes,
    completed: missing.length === 0,
    missing,
  };
}

/** 初回完走補助: サンプル提出＋MCP疎通＋初判定 */
export function maybeRecordFirstComplete(flags: {
  sampleSubmitted: boolean;
  mcpTouched: boolean;
  hasVerdict: boolean;
}): void {
  if (!flags.sampleSubmitted || !flags.mcpTouched || !flags.hasVerdict) return;
  recordActivationOnce("first_complete");
}
