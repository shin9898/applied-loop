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

type CacheRow = {
  at: number;
  result: GradingProbeResult;
};

const CACHE_PATH = join(homedir(), ".applied-loop", "grading-probe-cache.json");
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

function readCache(): CacheRow | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const row = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheRow;
    if (!row?.at || !row?.result) return null;
    return row;
  } catch {
    return null;
  }
}

function writeCache(result: GradingProbeResult): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const row: CacheRow = { at: Date.now(), result };
    writeFileSync(CACHE_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[grading-probe] cache write failed:", e);
  }
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
export async function probeGradingCliLive(): Promise<GradingProbeResult> {
  const pathProbe = probeGradingCli();
  if (!pathProbe.ok) {
    return { ...pathProbe, dryRun: false };
  }

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
