"use client";

import { useMemo, useState } from "react";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import {
  ACTION_LABEL,
  buildInboxTriageContext,
  COMMANDS,
  type FumiAction,
  type InboxOverlapCandidate,
} from "./ukebako-view";

/**
 * /inbox/[id] 専用の単独完結じゅもん（gates/[id] と同じ「画面ごとに別の扉」パターン）。
 * 一覧（AtlasUkebakoFumi）の picks state とは独立。
 */
export function AtlasInboxTriage({
  wsToken,
  captureId,
  captureTitle,
  overlapCandidates = [],
}: {
  wsToken: string | null;
  captureId: string;
  captureTitle: string;
  /** しれん重複ガード (ADR-0021) が判定待ちのまま残している候補 */
  overlapCandidates?: InboxOverlapCandidate[];
}) {
  const [pick, setPick] = useState<FumiAction | null>(null);
  const context = useMemo(
    () => buildInboxTriageContext(captureId, captureTitle, pick, overlapCandidates),
    [captureId, captureTitle, pick, overlapCandidates],
  );

  return (
    <>
      <div className="uke-cmd">
        <p className="uke-cmd__title">しわけ</p>
        <ul className="uke-cmd__list">
          {COMMANDS.map((c) => (
            <li key={c.action}>
              <button
                type="button"
                onClick={() =>
                  setPick((prev) => (prev === c.action ? null : c.action))
                }
                aria-pressed={pick === c.action}
                className={`uke-cmd__btn ${pick === c.action ? "is-sel" : ""} ${
                  c.drop ? "is-drop" : ""
                }`.trim()}
              >
                <i />
                <span className="uke-cmd__key">{c.key}</span>
                <span className="uke-cmd__desc">{c.desc}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="uke-cmd__note">
          <i className="uke-mk uke-mk--dust" />
          ここは 受付。えらぶだけで 台帳は 変わらぬ。手を うごかすのは{" "}
          <b>じゅもん（MCP triage_inbox）</b> じゃ。
        </p>
      </div>
      {wsToken ? (
        <AtlasAssist
          wsToken={wsToken}
          intent="triage"
          context={context}
          title="じゅもんで しわける"
          blurb={
            pick
              ? `えらんだ「${ACTION_LABEL[pick]}」を 賢者に わたす。となえよ。`
              : "ふみを ひらいて えらび、実行は じゅもんに たのめ。"
          }
        />
      ) : (
        <AtlasAssistUnavailable />
      )}
    </>
  );
}
