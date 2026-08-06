"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addWatchedRepoAction,
  installWatchedReposAction,
  removeWatchedRepoAction,
} from "@/lib/actions";

export type WatchedRepoRow = {
  path: string;
  label?: string;
  isGit: boolean;
  connected: boolean;
};

function labelOf(r: WatchedRepoRow): string {
  if (r.label?.trim()) return r.label.trim();
  const parts = r.path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? r.path;
}

/** 会話で監視設定するときの貼る文（フル LLM ウィザードは不要） */
const WATCH_REPOS_PASTE = [
  "Applied Loop の MCP で watch_repos を使ってください。",
  "まず action=list で現状を見せてください。",
  "監視したい git リポジトリのパス（例: ~/Desktop/triplethree/triple-onboarding）を私が指定したら、",
  "action=add で登録し鉤をかけてください。",
  "外すときだけ action=remove を使ってください。",
].join("\n");

function CopyPaste({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? "コピーした" : "貼る文をコピー"}
    </button>
  );
}

/**
 * じゅんび: 供給対象リポジトリを選んで鉤をかける。
 * 「仕事していれば溜まる」誤解を防ぐための明示登録 UI。
 */
export function AtlasWatchedReposPanel({
  repos,
}: {
  repos: WatchedRepoRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  return (
    <div
      id="watched-repos"
      className="scroll-mt-24 space-y-2 border-t-2 border-[#002070] pt-3"
    >
      <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
        ◆ 監視リポジトリ（供給の対象）
      </p>
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        ここに入れたリポジトリへの{" "}
        <span className="text-[#f7f3d9]">git commit</span>{" "}
        だけがしれんの種になる。GitHub の PR
        作成や、未登録 repo での作業は自動では溜まらない。
      </p>

      {repos.length === 0 ? (
        <p className="m-0 border-[2px] border-[#e84848] bg-[#000c4a] px-2.5 py-2 text-[12px] text-[#f7f3d9]">
          まだ監視中のリポジトリはない。下にパスを入れて追加せよ（例:
          ~/Desktop/triplethree/triple-onboarding）。
        </p>
      ) : (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {repos.map((r) => (
            <li
              key={r.path}
              className="flex flex-wrap items-start justify-between gap-2 border-[2px] border-[#002070] bg-[#000c4a] px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f7f3d9]">
                  {labelOf(r)}
                  <span
                    className={`ml-2 ${
                      r.connected ? "text-[#3ecf5a]" : "text-[#e84848]"
                    }`}
                  >
                    {r.connected
                      ? "監視中"
                      : r.isGit
                        ? "未接続"
                        : "git ではない"}
                  </span>
                </p>
                <p className="mt-0.5 mb-0 break-all font-mono text-[10px] text-[#9a9470]">
                  {r.path}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                className="dq-btn dq-btn-ghost shrink-0 !px-2 !py-1 text-[7px]"
                onClick={() =>
                  start(async () => {
                    const res = await removeWatchedRepoAction(r.path);
                    setMessage(
                      res.ok
                        ? `外した: ${labelOf(r)}`
                        : res.error,
                    );
                    refresh();
                  })
                }
              >
                外す
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-[11px] text-[#9ec0ff]">
          リポジトリのパス
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/Desktop/triplethree/triple-onboarding"
            className="mt-1 w-full border-[2px] border-white bg-[#000814] px-2 py-1.5 font-mono text-[12px] text-[#f7f3d9] outline-none"
            disabled={pending}
          />
        </label>
        <button
          type="button"
          disabled={pending || !path.trim()}
          className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
          onClick={() =>
            start(async () => {
              const res = await addWatchedRepoAction(path);
              setMessage(res.ok ? "リストに追加した。続けて鉤をかけよ。" : res.error);
              if (res.ok) setPath("");
              refresh();
            })
          }
        >
          リストに追加
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || repos.length === 0}
          className="dq-btn !px-3 !py-2 text-[8px]"
          onClick={() =>
            start(async () => {
              const res = await installWatchedReposAction();
              setMessage(
                res.ok
                  ? "鉤をかけた。この repo への commit が供給になる。"
                  : res.error,
              );
              refresh();
            })
          }
        >
          登録分に鉤をかける
        </button>
        <button
          type="button"
          disabled={pending || !path.trim()}
          className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
          onClick={() =>
            start(async () => {
              const res = await installWatchedReposAction({
                paths: [path.trim()],
              });
              setMessage(
                res.ok
                  ? "追加して鉤をかけた。"
                  : res.error,
              );
              if (res.ok) setPath("");
              refresh();
            })
          }
        >
          このパスを追加して鉤をかける
        </button>
      </div>

      {message ? (
        <p className="m-0 whitespace-pre-wrap text-[11px] leading-relaxed text-[#9ec0ff]">
          {message}
        </p>
      ) : null}

      <div className="grid gap-2 border-[2px] border-[#002070] bg-[#000c4a] p-2.5">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          LLM で設定する（貼る）
        </p>
        <p className="m-0 text-[11px] leading-relaxed text-[#c9c3a0]">
          じゅもん／Claude／Cursor に貼ると watch_repos で一覧・追加できる。UI
          から直接 LLM を起動するウィザードは不要（MCP が本体）。
        </p>
        <pre className="m-0 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-[#f7f3d9]">
          {WATCH_REPOS_PASTE}
        </pre>
        <CopyPaste text={WATCH_REPOS_PASTE} />
      </div>
    </div>
  );
}
