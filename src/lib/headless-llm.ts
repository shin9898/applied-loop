import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** ヘッドレス CLI で BYO-LLM を呼ぶ。ユーザーの信頼済みプロバイダ境界内のみ。
 *  プロバイダは HEADLESS_LLM_PROVIDER で切替: "claude" | "codex" | "auto" (default)。
 *  auto は claude を優先し、認証切れ/未インストール/利用枠枯渇時は codex にフォールバック。
 *  両方失敗したら両方の理由を連結して投げる。
 *
 *  GUI / Cursor 起動の Next は PATH に ~/.local/bin が無いことがあるため、
 *  よくある絶対パスを先に試し、exec 時は PATH を補強する。
 */

export class HeadlessLLMError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "quota" | "spawn" | "timeout" | "unknown"
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 120_000;

const HOME = homedir();

/** Next / launchd でも CLI を見つけられるよう PATH を補強 */
function enrichedPath(): string {
  const extras = [
    path.join(HOME, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(HOME, ".npm-global", "bin"),
  ];
  const cur = process.env.PATH ?? "";
  const parts = [...extras, ...cur.split(path.delimiter)].filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 名前または絶対パス候補から実行ファイルを解決。見つからなければ null */
function resolveCli(
  name: "claude" | "codex",
  envKey: string,
  candidates: string[],
): string | null {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;

  for (const c of candidates) {
    if (c && isExecutable(c)) return c;
  }

  // PATH 上 (補強後) を which 相当で走査
  for (const dir of enrichedPath().split(path.delimiter)) {
    const full = path.join(dir, name);
    if (isExecutable(full)) return full;
  }
  return null;
}

function claudeBin(): string | null {
  return resolveCli("claude", "HEADLESS_CLAUDE_BIN", [
    path.join(HOME, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]);
}

function codexBin(): string | null {
  return resolveCli("codex", "HEADLESS_CODEX_BIN", [
    "/opt/homebrew/bin/codex",
    path.join(HOME, ".local", "bin", "codex"),
    "/usr/local/bin/codex",
  ]);
}

function execEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: enrichedPath() };
}

/** stdout のイベント配列から type:"result" の応答を取り出す。
 *  見つからなければ null。claude CLI は exit 1 でも stdout に JSON を出すため
 *  exit code より先にこちらで判定する */
function extractClaudeResult(stdout: string): { result: string; isError: boolean } | null {
  try {
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const resultItem = items.find(
      (it) => it && typeof it === "object" && it.type === "result"
    );
    if (resultItem) {
      return {
        result: String(resultItem.result ?? ""),
        isError: !!resultItem.is_error,
      };
    }
    const single = parsed as { result?: unknown };
    if (!Array.isArray(parsed) && typeof single.result === "string") {
      return { result: single.result, isError: false };
    }
  } catch {
    // JSON でなければ null
  }
  return null;
}

function isAuthMessage(text: string): boolean {
  return /failed to authenticate|OAuth session expired|not logged in|unauthorized/i.test(
    text
  );
}

function isQuotaMessage(text: string): boolean {
  return /rate.?limit|usage limit|spend limit|quota|weekly limit|monthly (?:spend )?limit|hit your org/i.test(
    text
  );
}

function classifyClaudeFailure(text: string): HeadlessLLMError["kind"] {
  if (isAuthMessage(text)) return "auth";
  if (isQuotaMessage(text)) return "quota";
  return "unknown";
}

/** auto フォールバック対象: 認証・未インストール・利用枠 */
function isFallbackable(e: HeadlessLLMError): boolean {
  return e.kind === "auth" || e.kind === "spawn" || e.kind === "quota";
}

function runClaude(prompt: string): Promise<string> {
  const bin = claudeBin();
  if (!bin) {
    return Promise.reject(
      new HeadlessLLMError(
        "claude CLI が見つかりません (PATH に ~/.local/bin 等が無い可能性)",
        "spawn",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      ["-p", prompt, "--output-format", "json"],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: execEnv() },
      (error, stdout, stderr) => {
        // exit code より先に stdout の result を見る (exit 1 でも JSON が出る)
        const extracted = extractClaudeResult(stdout);
        if (extracted) {
          if (extracted.isError) {
            return reject(
              new HeadlessLLMError(
                `claude CLI がエラーを返しました: ${extracted.result.slice(0, 200)}`,
                classifyClaudeFailure(extracted.result)
              )
            );
          }
          return resolve(extracted.result);
        }
        if (error) {
          if (error.killed) {
            return reject(new HeadlessLLMError("LLM 呼び出しがタイムアウトしました", "timeout"));
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return reject(new HeadlessLLMError("claude CLI が見つかりません", "spawn"));
          }
          const msg = `${stderr}\n${error.message}`;
          return reject(
            new HeadlessLLMError(
              `claude CLI 失敗: ${msg.slice(0, 300)}`,
              classifyClaudeFailure(msg)
            )
          );
        }
        resolve(stdout.trim());
      }
    );
    child.stdin?.end();
  });
}

/** ~/.codex/config.toml の既定モデルが古い CLI と噛み合わないことがある */
function isCodexModelTooNewMessage(text: string): boolean {
  return /requires a newer version of Codex|Model metadata for .* not found|invalid_request_error/i.test(
    text,
  );
}

class CodexModelCompatError extends HeadlessLLMError {
  constructor(detail: string) {
    super(`codex モデルが CLI と非互換: ${detail.slice(0, 200)}`, "unknown");
    this.name = "CodexModelCompatError";
  }
}

/**
 * prompt は argv ではなく stdin (`-`) 経由。採点プロンプトが長く ARG_MAX /
 * 「Reading additional input from stdin」の空パイプ問題を避ける。
 */
function runCodexOnce(prompt: string, model: string): Promise<string> {
  const bin = codexBin();
  if (!bin) {
    return Promise.reject(
      new HeadlessLLMError(
        "codex CLI が見つかりません (PATH に /opt/homebrew/bin 等が無い可能性)",
        "spawn",
      ),
    );
  }

  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "-m",
    model,
    "-", // prompt from stdin
  ];

  return new Promise((resolve, reject) => {
    // 出題・採点は読み取り専用で十分。応答テキストは stdout の末尾付近に出る
    const child = execFile(
      bin,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: execEnv() },
      (error, stdout, stderr) => {
        const combined = `${stdout}\n${stderr}\n${error?.message ?? ""}`;
        // exit 0 でも usage limit を stdout に出して終わることがある
        if (isQuotaMessage(combined)) {
          return reject(
            new HeadlessLLMError("codex のレート制限 / 利用枠に達しています", "quota")
          );
        }
        if (isCodexModelTooNewMessage(combined)) {
          return reject(new CodexModelCompatError(combined));
        }
        if (error) {
          if (error.killed) {
            return reject(new HeadlessLLMError("codex 呼び出しがタイムアウトしました", "timeout"));
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return reject(new HeadlessLLMError("codex CLI が見つかりません", "spawn"));
          }
          if (isAuthMessage(combined)) {
            return reject(new HeadlessLLMError("codex の認証が切れています", "auth"));
          }
          return reject(
            new HeadlessLLMError(`codex CLI 失敗: ${combined.slice(0, 300)}`, "unknown")
          );
        }
        resolve(stdout.trim());
      }
    );
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/**
 * HEADLESS_CODEX_MODEL があればそれを使う。未指定時は gpt-5.4
 * （config の gpt-5.6-sol は CLI v0.142 系で拒否されるため）。
 * それでもモデル非互換なら gpt-5.4 で1回リトライ。
 */
async function runCodex(prompt: string): Promise<string> {
  const fallbackModel = "gpt-5.4";
  const preferred =
    process.env.HEADLESS_CODEX_MODEL?.trim() || fallbackModel;
  try {
    return await runCodexOnce(prompt, preferred);
  } catch (e) {
    if (e instanceof CodexModelCompatError && preferred !== fallbackModel) {
      console.warn(
        `[headless-llm] codex モデル ${preferred} が CLI と非互換のため ${fallbackModel} で再試行`,
      );
      return runCodexOnce(prompt, fallbackModel);
    }
    throw e;
  }
}

/** プロバイダ選択つきのヘッドレス LLM 呼び出し */
export async function runHeadlessLLM(prompt: string): Promise<string> {
  const provider = (process.env.HEADLESS_LLM_PROVIDER ?? "auto").toLowerCase();
  if (provider === "codex") return runCodex(prompt);
  if (provider === "claude") return runClaude(prompt);

  try {
    return await runClaude(prompt);
  } catch (e) {
    if (e instanceof HeadlessLLMError && isFallbackable(e)) {
      console.warn(
        `[headless-llm] claude が使えないため codex にフォールバック: ${e.message}`
      );
      try {
        return await runCodex(prompt);
      } catch (e2) {
        if (e2 instanceof HeadlessLLMError) {
          throw new HeadlessLLMError(
            `claude: ${e.message} / codex: ${e2.message}`,
            e2.kind === "unknown" ? e.kind : e2.kind
          );
        }
        throw e2;
      }
    }
    throw e;
  }
}

/** LLM 応答から JSON オブジェクトを寛容に抽出する (コードフェンス・前後の説明文を許容) */
export function parseLLMJson<T>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
