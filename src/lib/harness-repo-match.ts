/**
 * 観測リポジトリ（パス）と HarnessRun.repo（短い名前）の突合。
 * worktree 名（triple-onboarding-ui-remaining）も basename プレフィックスで親に寄せる。
 */

import { basename } from "node:path";

export type WatchedRepoRef = {
  path: string;
  label?: string;
};

export function watchedDisplayName(w: WatchedRepoRef): string {
  const label = w.label?.trim();
  if (label) return label;
  return basename(w.path.replace(/\/$/, "")) || w.path;
}

/** harness repo 文字列がこの監視エントリに属するか */
export function harnessRepoMatchesWatched(
  harnessRepo: string,
  w: WatchedRepoRef,
): boolean {
  const h = harnessRepo.trim().toLowerCase();
  if (!h) return false;
  const base = basename(w.path.replace(/\/$/, "")).toLowerCase();
  const label = (w.label?.trim() || "").toLowerCase();
  if (label && h === label) return true;
  if (h === base) return true;
  // worktree / 枝ディレクトリ: "{basename}-..." or "{basename}_..."
  if (base.length >= 2 && (h.startsWith(`${base}-`) || h.startsWith(`${base}_`))) {
    return true;
  }
  return false;
}

export function findWatchedForHarnessRepo(
  harnessRepo: string,
  watched: WatchedRepoRef[],
): WatchedRepoRef | null {
  for (const w of watched) {
    if (harnessRepoMatchesWatched(harnessRepo, w)) return w;
  }
  return null;
}

/**
 * repo 名の接頭辞一致（`{basename}-...`）では拾えない worktree 用のフォールバック。
 * 共有 worktree プール（例: `~/Desktop/triplethree/worktrees/<task>`）のように、
 * worktree ディレクトリ名が親 repo 名と無関係でも、git の toplevel 絶対パスは
 * 監視パスのサブディレクトリになっているため、絶対パスで拾う（2026-08-14 実データ確認）。
 */
export function repoPathIsUnderWatched(
  repoPath: string | null | undefined,
  w: WatchedRepoRef,
): boolean {
  if (!repoPath) return false;
  const watchedPath = w.path.replace(/\/$/, "");
  return repoPath === watchedPath || repoPath.startsWith(`${watchedPath}/`);
}

export function findWatchedForRepoPath(
  repoPath: string | null | undefined,
  watched: WatchedRepoRef[],
): WatchedRepoRef | null {
  if (!repoPath) return null;
  for (const w of watched) {
    if (repoPathIsUnderWatched(repoPath, w)) return w;
  }
  return null;
}

/** 監視エントリに紐づく計測行を選ぶ（完全一致を優先、なければプレフィックス一致の先頭） */
export function pickRateForWatched<T extends { repo: string }>(
  w: WatchedRepoRef,
  rates: T[],
): T | null {
  const base = basename(w.path.replace(/\/$/, "")).toLowerCase();
  const label = (w.label?.trim() || "").toLowerCase();
  const exact = rates.find((r) => {
    const h = r.repo.trim().toLowerCase();
    return h === base || (label && h === label);
  });
  if (exact) return exact;
  return (
    rates.find((r) => harnessRepoMatchesWatched(r.repo, w)) ?? null
  );
}
