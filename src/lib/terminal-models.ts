/**
 * アプリ内じゅもん (ADR-0015) の CLI サービス＋モデル選択肢。
 * 起動前に選ばせてから pty を開く（開いてからのモデル変更は再起動）。
 *
 * プリセットは CLI が受け付ける値（エイリアス or フル ID）。
 * ラベルには「いま何世代か」を併記する（エイリアスは提供側で差し替わる）。
 * 更新目安: `codex debug models` / Claude Code model-config を見て見直す。
 */

export type TerminalCmd = "claude" | "codex";

export type TerminalModelOption = {
  id: string;
  /** UI 表示（世代が分かる文言） */
  label: string;
  /** CLI に渡す値。null ならモデルフラグなし（CLI 既定） */
  value: string | null;
};

/**
 * Claude: エイリアスは Anthropic API 上で最新へ追従する。
 * 2026-08 時点: sonnet→Sonnet 5 / opus→Opus 5 / fable→Fable 5。
 * ピン留めはフル ID（claude-opus-4-8 など）。
 */
export const TERMINAL_MODEL_OPTIONS: Record<
  TerminalCmd,
  TerminalModelOption[]
> = {
  claude: [
    { id: "default", label: "CLI既定（settings）", value: null },
    { id: "sonnet", label: "Sonnet（最新 → いま 5）", value: "sonnet" },
    { id: "opus", label: "Opus（最新 → いま 5）", value: "opus" },
    { id: "fable", label: "Fable 5（最上位）", value: "fable" },
    { id: "haiku", label: "Haiku（最新 → いま 4.5）", value: "haiku" },
    { id: "opus-1m", label: "Opus 1M（最新 + 長文脈）", value: "opus[1m]" },
    {
      id: "claude-sonnet-5",
      label: "Sonnet 5（ピン）",
      value: "claude-sonnet-5",
    },
    { id: "claude-opus-5", label: "Opus 5（ピン）", value: "claude-opus-5" },
    {
      id: "claude-opus-4-8",
      label: "Opus 4.8（ピン）",
      value: "claude-opus-4-8",
    },
    {
      id: "claude-sonnet-4-6",
      label: "Sonnet 4.6（ピン）",
      value: "claude-sonnet-4-6",
    },
  ],
  /**
   * Codex: 2026-08 時点の `codex debug models`（codex-cli 0.146）より。
   * o3 / 旧 gpt-5 単独はカタログ外。カスタムで任意 ID 可。
   */
  codex: [
    { id: "default", label: "CLI既定（config.toml）", value: null },
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol（frontier）",
      value: "gpt-5.6-sol",
    },
    {
      id: "gpt-5.6-terra",
      label: "GPT-5.6 Terra（standard）",
      value: "gpt-5.6-terra",
    },
    {
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna（fast）",
      value: "gpt-5.6-luna",
    },
    { id: "gpt-5.5", label: "GPT-5.5", value: "gpt-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4", value: "gpt-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
    { id: "gpt-5.2", label: "GPT-5.2", value: "gpt-5.2" },
  ],
};

const STORAGE_KEY = "atlas-jumon-cli-v1";

export type JumonCliPrefs = {
  cmd: TerminalCmd;
  /** プリセット id、または custom */
  modelId: string;
  /** modelId=custom のとき、またはプリセットの value */
  modelValue: string | null;
};

export function defaultJumonPrefs(defaultCmd: TerminalCmd = "codex"): JumonCliPrefs {
  return { cmd: defaultCmd, modelId: "default", modelValue: null };
}

export function loadJumonPrefs(defaultCmd: TerminalCmd = "codex"): JumonCliPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultJumonPrefs(defaultCmd);
    const v = JSON.parse(raw) as Partial<JumonCliPrefs>;
    const cmd = v.cmd === "claude" || v.cmd === "codex" ? v.cmd : defaultCmd;
    const modelId = typeof v.modelId === "string" ? v.modelId : "default";
    const modelValue =
      typeof v.modelValue === "string" && v.modelValue.trim()
        ? v.modelValue.trim()
        : null;

    // 古いプリセット id（o3 等）はカスタムへ落とさず、値があれば custom として残す
    const known = TERMINAL_MODEL_OPTIONS[cmd].some((o) => o.id === modelId);
    if (!known && modelId !== "custom") {
      if (modelValue) {
        return { cmd, modelId: "custom", modelValue };
      }
      return defaultJumonPrefs(cmd);
    }

    return {
      cmd,
      modelId,
      modelValue: modelId === "default" ? null : modelValue,
    };
  } catch {
    return defaultJumonPrefs(defaultCmd);
  }
}

export function saveJumonPrefs(prefs: JumonCliPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** node-pty に渡す argv（コマンド名を除く） */
export function cliArgsForModel(
  cmd: TerminalCmd,
  modelValue: string | null | undefined,
): string[] {
  const m = modelValue?.trim();
  if (!m) return [];
  if (cmd === "claude") return ["--model", m];
  if (cmd === "codex") return ["-m", m];
  return [];
}

export function resolveModelValue(
  cmd: TerminalCmd,
  modelId: string,
  customValue?: string | null,
): string | null {
  if (modelId === "custom") {
    const c = customValue?.trim();
    return c || null;
  }
  const hit = TERMINAL_MODEL_OPTIONS[cmd].find((o) => o.id === modelId);
  return hit?.value ?? null;
}
