/**
 * Cloud Reachable MCP の薄いステップウィザード（任意）。
 * UI は「いまやる1手」だけ。LLM は最後の疎通確認に限定。
 */
import type { CloudMcpClient } from "@/lib/cloud-mcp-guide";
import {
  CLOUD_MCP_CLIENT_LABELS,
  CLOUD_MCP_TUNNEL_STEPS,
  cloudMcpClientGuides,
  cloudMcpVerifyPrompt,
} from "@/lib/cloud-mcp-guide";

export type CloudWizardStepId =
  | "pick"
  | "tunnel"
  | "register"
  | "verify"
  | "done";

export const CLOUD_WIZARD_STEP_ORDER: CloudWizardStepId[] = [
  "pick",
  "tunnel",
  "register",
  "verify",
  "done",
];

export const CLOUD_WIZARD_STEP_LABELS: Record<CloudWizardStepId, string> = {
  pick: "選ぶ",
  tunnel: "トンネル",
  register: "登録",
  verify: "疎通",
  done: "完了",
};

export const CLOUD_WIZARD_STORAGE_KEY = "atlas-cloud-mcp-wizard-v1";

export type CloudWizardPersisted = {
  client: CloudMcpClient | null;
  /** 現在フォーカスしているステップ */
  step: CloudWizardStepId;
  /** register で「登録した」を押した時刻 */
  registeredAt?: string | null;
  /** verify ステップに入った時刻（これ以降の MCP 疎通を成功候補にする） */
  verifyEnteredAt?: string | null;
  /** 疎通成功（自己申告 or MCP 検知） */
  verifiedAt?: string | null;
};

export function defaultCloudWizardState(): CloudWizardPersisted {
  return { client: null, step: "pick" };
}

export function parseCloudWizardState(raw: unknown): CloudWizardPersisted {
  if (!raw || typeof raw !== "object") return defaultCloudWizardState();
  const o = raw as Record<string, unknown>;
  const client =
    o.client === "cursor" || o.client === "claude" || o.client === "codex"
      ? o.client
      : null;
  const step = CLOUD_WIZARD_STEP_ORDER.includes(o.step as CloudWizardStepId)
    ? (o.step as CloudWizardStepId)
    : "pick";
  return {
    client,
    step,
    registeredAt: typeof o.registeredAt === "string" ? o.registeredAt : null,
    verifyEnteredAt:
      typeof o.verifyEnteredAt === "string" ? o.verifyEnteredAt : null,
    verifiedAt: typeof o.verifiedAt === "string" ? o.verifiedAt : null,
  };
}

/** トンネルが Cloud 用として足りるか（診断） */
export function cloudTunnelReady(opts: {
  reachable: boolean;
  tokenConfigured: boolean;
}): boolean {
  return opts.reachable && opts.tokenConfigured;
}

/** verify 開始以降に MCP 認証成功があったか */
export function cloudVerifyDetected(opts: {
  verifyEnteredAt?: string | null;
  mcpLastAt?: string | null;
  verifiedAt?: string | null;
}): boolean {
  if (opts.verifiedAt) return true;
  if (!opts.verifyEnteredAt || !opts.mcpLastAt) return false;
  const start = Date.parse(opts.verifyEnteredAt);
  const mcp = Date.parse(opts.mcpLastAt);
  if (Number.isNaN(start) || Number.isNaN(mcp)) return false;
  return mcp >= start;
}

export function cloudWizardCanAdvance(
  step: CloudWizardStepId,
  state: CloudWizardPersisted,
  tunnel: { reachable: boolean; tokenConfigured: boolean },
  mcpLastAt?: string | null,
): boolean {
  switch (step) {
    case "pick":
      return state.client != null;
    case "tunnel":
      return cloudTunnelReady(tunnel);
    case "register":
      return Boolean(state.registeredAt);
    case "verify":
      return cloudVerifyDetected({
        verifyEnteredAt: state.verifyEnteredAt,
        mcpLastAt,
        verifiedAt: state.verifiedAt,
      });
    case "done":
      return true;
    default:
      return false;
  }
}

export function nextCloudWizardStep(
  step: CloudWizardStepId,
): CloudWizardStepId | null {
  const i = CLOUD_WIZARD_STEP_ORDER.indexOf(step);
  if (i < 0 || i >= CLOUD_WIZARD_STEP_ORDER.length - 1) return null;
  return CLOUD_WIZARD_STEP_ORDER[i + 1] ?? null;
}

export function prevCloudWizardStep(
  step: CloudWizardStepId,
): CloudWizardStepId | null {
  const i = CLOUD_WIZARD_STEP_ORDER.indexOf(step);
  if (i <= 0) return null;
  return CLOUD_WIZARD_STEP_ORDER[i - 1] ?? null;
}

export {
  CLOUD_MCP_CLIENT_LABELS,
  CLOUD_MCP_TUNNEL_STEPS,
  cloudMcpClientGuides,
  cloudMcpVerifyPrompt,
};
export type { CloudMcpClient };
