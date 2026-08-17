/**
 * B6-1 / Fable G7: 採点 CLI の dry-run（認証まで見る）。
 * 成功は1時間、失敗は5分キャッシュ（setup 診断のたびに LLM を叩かない）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  HeadlessLLMError,
  probeGradingCli,
  runHeadlessLLM,
} from "@/lib/headless-llm";

export type GradingProbeResult = {
  ok: boolean;
  provider: "claude" | "codex" | "none";
  detail: string;
  howTo: string;
  /** true = 実際に LLM を呼んだ（またはそのキャッシュ） */
  dryRun: boolean;
};

export type GradingProbeCacheRow = {
  at: number;
  result: GradingProbeResult;
};

const CACHE_PATH = join(homedir(), ".applied-loop", "grading-probe-cache.json");
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

function readCacheFrom(path: string): GradingProbeCacheRow | null {
  try {
    if (!existsSync(path)) return null;
    const row = JSON.parse(readFileSync(path, "utf8")) as GradingProbeCacheRow;
    if (!row?.at || !row?.result) return null;
    return row;
  } catch {
    return null;
  }
}

function readCache(): GradingProbeCacheRow | null {
  return readCacheFrom(CACHE_PATH);
}

function writeCache(result: GradingProbeResult): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const row: GradingProbeCacheRow = { at: Date.now(), result };
    writeFileSync(CACHE_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[grading-probe] cache write failed:", e);
  }
}

/** テスト・`/setup` 表示用: live probe を呼ばずキャッシュだけ読む */
export function readGradingProbeCache(
  cachePath: string = CACHE_PATH,
): GradingProbeCacheRow | null {
  return readCacheFrom(cachePath);
}

export function formatCheckedLabel(elapsedMs: number): string {
  if (elapsedMs < 60_000) return "たった今確認";
  const min = Math.floor(elapsedMs / 60_000);
  if (min < 60) return `${min}分前に確認`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前に確認`;
  const day = Math.floor(hr / 24);
  return `${day}日前に確認`;
}

const UNCHECKED_GRADING_RESULT: GradingProbeResult = {
  ok: false,
  provider: "none",
  detail: "まだ確認しておらぬ",
  howTo: "下のボタンで賢者に伺いを立てよ",
  dryRun: false,
};

/**
 * `/setup` の通常表示用: live probe を呼ばず、直近のキャッシュ結果 + 鮮度ラベルを返す。
 * キャッシュが無ければ「未確認」を表す既定値を返す。
 */
export function cachedGradingProbeResult(
  cachePath: string = CACHE_PATH,
): GradingProbeResult {
  const cached = readGradingProbeCache(cachePath);
  if (!cached) return UNCHECKED_GRADING_RESULT;
  return {
    ...cached.result,
    detail: `${cached.result.detail}（${formatCheckedLabel(Date.now() - cached.at)}）`,
  };
}

/** PATH のみ（ホーム等）。dryRun=false */
export function probeGradingPathOnly(): GradingProbeResult {
  const p = probeGradingCli();
  return { ...p, dryRun: false };
}

/**
 * 極小プロンプトで疎通。キャッシュヒット時は LLM を呼ばない。
 * setup 診断でのみ使うこと。
 */
export async function probeGradingCliLive(opts?: {
  /** true でキャッシュの読み取りだけをスキップし、必ず実際に呼ぶ（書き込みは従来通り行う） */
  force?: boolean;
}): Promise<GradingProbeResult> {
  const pathProbe = probeGradingCli();
  if (!pathProbe.ok) {
    return { ...pathProbe, dryRun: false };
  }

  if (!opts?.force) {
    const cached = readCache();
    if (cached) {
      const ttl = cached.result.ok ? OK_TTL_MS : FAIL_TTL_MS;
      if (Date.now() - cached.at < ttl) {
        return {
          ...cached.result,
          detail: `${cached.result.detail}（キャッシュ）`,
        };
      }
    }
  }

  try {
    const reply = await runHeadlessLLM(
      'Reply with exactly the two letters OK and nothing else.',
    );
    const ok = /\bOK\b/i.test(reply.trim());
    const result: GradingProbeResult = {
      ok,
      provider: pathProbe.provider,
      detail: ok
        ? `dry-run OK — ${pathProbe.detail}`
        : `dry-run 応答が想定外: ${reply.trim().slice(0, 80)}`,
      howTo: ok
        ? pathProbe.howTo
        : "CLI は見えるが応答がおかしい。`claude` / `codex` で対話ログインを確認",
      dryRun: true,
    };
    writeCache(result);
    return result;
  } catch (e) {
    const kind = e instanceof HeadlessLLMError ? e.kind : "unknown";
    const msg = e instanceof Error ? e.message : String(e);
    const result: GradingProbeResult = {
      ok: false,
      provider: pathProbe.provider,
      detail: `dry-run 失敗 (${kind}): ${msg}`,
      howTo:
        kind === "auth"
          ? "`claude` または `codex` で再ログインしてから /setup を開き直せ"
          : pathProbe.howTo,
      dryRun: true,
    };
    writeCache(result);
    return result;
  }
}
