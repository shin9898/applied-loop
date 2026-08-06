/**
 * 供給対象リポジトリ（git hook）の登録と接続状態。
 * ~/.applied-loop/watched-repos.json に永続化。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const HOOK_MARKER = "# applied-loop-hook";

export type WatchedRepo = {
  path: string;
  /** 表示用。未指定なら basename */
  label?: string;
  addedAt: string;
};

export type WatchedRepoStatus = WatchedRepo & {
  /** .git がある */
  isGit: boolean;
  /** post-commit に applied-loop marker がある */
  connected: boolean;
  /** 鉤本体 ~/.applied-loop/hooks/post-commit */
  hookBodyPresent: boolean;
};

type Store = { repos: WatchedRepo[] };

const STORE_PATH = join(homedir(), ".applied-loop", "watched-repos.json");
const HOOK_BODY = join(homedir(), ".applied-loop", "hooks", "post-commit");

export function watchedReposPath(): string {
  return STORE_PATH;
}

export function hookBodyPath(): string {
  return HOOK_BODY;
}

export function hookBodyInstalled(): boolean {
  return existsSync(HOOK_BODY);
}

function readStore(): Store {
  try {
    if (!existsSync(STORE_PATH)) return { repos: [] };
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
    if (!raw || !Array.isArray(raw.repos)) return { repos: [] };
    const repos = raw.repos
      .filter(
        (r): r is WatchedRepo =>
          !!r &&
          typeof r === "object" &&
          typeof r.path === "string" &&
          r.path.trim().length > 0,
      )
      .map((r) => ({
        path: resolve(r.path.trim()),
        label: typeof r.label === "string" ? r.label : undefined,
        addedAt:
          typeof r.addedAt === "string" && r.addedAt
            ? r.addedAt
            : new Date().toISOString(),
      }));
    return { repos };
  } catch {
    return { repos: [] };
  }
}

function writeStore(store: Store): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function listWatchedRepos(): WatchedRepo[] {
  return readStore().repos;
}

/** git 絶対 dir。失敗時 null */
export function resolveGitDir(repoPath: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", repoPath, "rev-parse", "--absolute-git-dir"],
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function isRepoHookConnected(repoPath: string): boolean {
  const gitDir = resolveGitDir(repoPath);
  if (!gitDir) return false;
  const hookFile = join(gitDir, "hooks", "post-commit");
  if (!existsSync(hookFile)) return false;
  try {
    const text = readFileSync(hookFile, "utf8");
    return text.includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

export function probeWatchedRepos(
  repos: WatchedRepo[] = listWatchedRepos(),
): WatchedRepoStatus[] {
  const body = hookBodyInstalled();
  return repos.map((r) => {
    const gitDir = resolveGitDir(r.path);
    return {
      ...r,
      isGit: !!gitDir,
      connected: !!gitDir && isRepoHookConnected(r.path),
      hookBodyPresent: body,
    };
  });
}

export function normalizeRepoPathInput(raw: string): string | null {
  const t = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!t) return null;
  const expanded = t.startsWith("~/")
    ? join(homedir(), t.slice(2))
    : t === "~"
      ? homedir()
      : t;
  const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
  return abs;
}

export function addWatchedRepo(input: {
  path: string;
  label?: string;
}): { ok: true; repo: WatchedRepo } | { ok: false; error: string } {
  const path = normalizeRepoPathInput(input.path);
  if (!path) return { ok: false, error: "パスが空です" };
  if (!existsSync(path)) {
    return { ok: false, error: `ディレクトリが無い: ${path}` };
  }
  if (!resolveGitDir(path)) {
    return { ok: false, error: `git リポジトリではない: ${path}` };
  }
  const store = readStore();
  if (store.repos.some((r) => r.path === path)) {
    return {
      ok: true,
      repo: store.repos.find((r) => r.path === path)!,
    };
  }
  const repo: WatchedRepo = {
    path,
    label: input.label?.trim() || undefined,
    addedAt: new Date().toISOString(),
  };
  store.repos.push(repo);
  writeStore(store);
  return { ok: true, repo };
}

export function removeWatchedRepo(pathRaw: string): {
  ok: true;
  removed: boolean;
} | { ok: false; error: string } {
  const path = normalizeRepoPathInput(pathRaw);
  if (!path) return { ok: false, error: "パスが空です" };
  const store = readStore();
  const next = store.repos.filter((r) => r.path !== path);
  const removed = next.length !== store.repos.length;
  writeStore({ repos: next });
  return { ok: true, removed };
}

/** 鉤本体＋指定 repo に marker を入れる（setup-git-hook.sh） */
export function installHooksForRepos(paths: string[]): {
  ok: boolean;
  output: string;
  error?: string;
} {
  const abs = paths
    .map((p) => normalizeRepoPathInput(p))
    .filter((p): p is string => !!p);
  if (abs.length === 0) {
    return { ok: false, output: "", error: "リポジトリが無い" };
  }
  const script = join(process.cwd(), "scripts", "setup-git-hook.sh");
  if (!existsSync(script)) {
    return {
      ok: false,
      output: "",
      error: `setup-git-hook.sh が見つからない（cwd=${process.cwd()}）`,
    };
  }
  try {
    const output = execFileSync("sh", [script, ...abs], {
      encoding: "utf8",
      timeout: 30_000,
      cwd: process.cwd(),
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
      error: err.message ?? "install failed",
    };
  }
}

/** post-commit から applied-loop 行だけ外す（登録リストからの削除とは別） */
export function disconnectRepoHook(pathRaw: string): {
  ok: boolean;
  error?: string;
} {
  const path = normalizeRepoPathInput(pathRaw);
  if (!path) return { ok: false, error: "パスが空です" };
  const gitDir = resolveGitDir(path);
  if (!gitDir) return { ok: false, error: "git リポジトリではない" };
  const hookFile = join(gitDir, "hooks", "post-commit");
  if (!existsSync(hookFile)) return { ok: true };
  try {
    const lines = readFileSync(hookFile, "utf8").split("\n");
    const next = lines.filter((line) => !line.includes(HOOK_MARKER));
    if (next.length === lines.length) return { ok: true };
    // 中身が shebang だけならファイル削除でもよいが、他 hook と共存するので残す
    const body = next.join("\n").replace(/\n+$/, "\n");
    writeFileSync(hookFile, body.startsWith("#!") ? body : `#!/bin/sh\n${body}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "disconnect failed" };
  }
}

export function summarizeWatched(
  statuses: WatchedRepoStatus[] = probeWatchedRepos(),
): {
  total: number;
  connected: number;
  disconnected: number;
  anyConnected: boolean;
} {
  const connected = statuses.filter((s) => s.connected).length;
  return {
    total: statuses.length,
    connected,
    disconnected: statuses.length - connected,
    anyConnected: connected > 0,
  };
}

export function repoLabel(r: WatchedRepo): string {
  if (r.label?.trim()) return r.label.trim();
  const parts = r.path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? r.path;
}
