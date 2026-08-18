"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { UkeSprite } from "./atlas-ukebako-sprites";
import {
  ACTION_LABEL,
  COMMANDS,
  groupFumi,
  type FumiAction,
  type FumiView,
} from "./ukebako-view";

const TIER_CLASS: Record<FumiView["tier"], string> = {
  stale: "uke-fumi--urgent",
  warn: "uke-fumi--warn",
  fresh: "",
};

const TIER_DUE_CLASS: Record<FumiView["tier"], string> = {
  stale: "is-danger",
  warn: "is-warn",
  fresh: "",
};

const GROUP_CLASS: Record<FumiView["tier"], string> = {
  stale: "uke-grp uke-grp--danger",
  warn: "uke-grp",
  fresh: "uke-grp uke-grp--dust",
};

function Pips({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="uke-pips" title={`じゅうようど ${value}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < value ? "on" : undefined} />
      ))}
    </span>
  );
}

/**
 * とどいた ふみ（未仕分け Capture）＋ じゅもん。
 *
 * アプリ側は「ひらく・よむ・えらぶ」だけ。accept/skip の実行は MCP の
 * `triage_inbox` が行う（ADR-0018 / アプリにフォームは増やさない）。
 * えらんだ結果は じゅもんの context に積んで賢者へ渡す。
 */
export function AtlasUkebakoFumi({
  fumi,
  expiredCount,
  wsToken,
  evidenceHint,
}: {
  fumi: FumiView[];
  expiredCount: number;
  wsToken: string | null;
  evidenceHint?: { goalId: string; goalTitle?: string } | null;
}) {
  const [picks, setPicks] = useState<Record<string, FumiAction>>({});
  const groups = useMemo(() => groupFumi(fumi), [fumi]);
  const picked = useMemo(
    () =>
      fumi
        .map((f) => ({ fumi: f, action: picks[f.id] }))
        .filter(
          (p): p is { fumi: FumiView; action: FumiAction } => !!p.action,
        ),
    [fumi, picks],
  );

  const staleCount = fumi.filter((f) => f.tier === "stale").length;

  const assistContext = useMemo(() => {
    const head = evidenceHint
      ? [
          `goalId: ${evidenceHint.goalId}`,
          evidenceHint.goalTitle ?? "",
          "",
        ].join("\n")
      : "";
    const lines = [
      `うけばこ（受付所）: 未仕分けの ふみ ${fumi.length}通 / ${
        staleCount
      }通 は 14日 以上 放置。`,
    ];
    if (picked.length > 0) {
      lines.push(
        "",
        "ユーザーが画面で えらんだ しわけ（この通りに triage_inbox を呼べ。実行前に一覧を復唱して確認を取れ）:",
        ...picked.map(
          (p) =>
            `- triage_inbox(captureId: "${p.fumi.id}", action: "${p.action}") … ${ACTION_LABEL[p.action]} / 「${p.fumi.title}」`,
        ),
      );
    } else if (fumi.length > 0) {
      lines.push(
        "",
        "まだ えらばれておらぬ。古い順に中身を確認し、accept / skip を提案せよ:",
        ...fumi
          .slice(0, 5)
          .map((f) => `- ${f.id} … 「${f.title}」（${f.days}にち 放置）`),
      );
    }
    return head + lines.join("\n");
  }, [evidenceHint, fumi, picked, staleCount]);

  function toggle(id: string, action: FumiAction) {
    setPicks((prev) => {
      const next = { ...prev };
      if (next[id] === action) delete next[id];
      else next[id] = action;
      return next;
    });
  }

  return (
    <>
      <section className="dq-win p-3.5" id="uke-jumon">
        {picked.length > 0 ? (
          <div className="uke-queue">
            <p className="uke-queue__title">えらんだ しわけ {picked.length}件</p>
            <ul className="uke-queue__list">
              {picked.map((p) => (
                <li key={p.fumi.id}>
                  <span className="uke-queue__act">
                    {ACTION_LABEL[p.action]}
                  </span>
                  {p.fumi.title}
                </li>
              ))}
            </ul>
            <p className="uke-cmd__note">
              <i className="uke-mk uke-mk--dust" />
              下の <b>じゅもんをとなえる</b> で賢者に渡る。実行は{" "}
              <b>MCP triage_inbox</b>。取り消しは もう一度 同じ コマンドを えらべ。
            </p>
          </div>
        ) : null}
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent={evidenceHint ? "goal-evidence" : "triage"}
            context={assistContext}
            title="じゅもんで しわける"
            blurb={
              picked.length > 0
                ? `えらんだ ${picked.length}件 を 賢者に わたす。となえよ。`
                : "うけばこは 受付。ふみを ひらいて えらび、実行は じゅもんに たのめ。"
            }
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
      </section>

      <section className="dq-win p-3.5" id="uke-fumi">
        <header className="uke-head">
          <h2 className="uke-head__title">
            とどいた ふみ
            <span className="uke-head__count">{fumi.length}つう</span>
          </h2>
          <div className="uke-rule" />
          <p className="uke-blurb">
            たびの あいだに ひろわれた まなびの たね。ひらいて しわけ すると くらに おさまる。
            <br />
            ひらかれぬまま 14にち を こえた ふみから 先に あけよ。
          </p>
        </header>

        {groups.length === 0 ? (
          <p className="m-0 text-center text-[14px] text-[#c9c3a0]">
            とどいた ふみは ない。うけつけは しずかじゃ。
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.tier}>
              <h3 className={GROUP_CLASS[g.tier]}>
                <UkeSprite
                  name={g.tier === "stale" ? "suna" : "fumi"}
                  width={g.tier === "stale" ? 16 : 24}
                />
                {g.label}
                <span className="uke-grp__n">{g.items.length}</span>
              </h3>
              <ul className="uke-fumi-list">
                {g.items.map((f) => {
                  const pick = picks[f.id];
                  return (
                    <li key={f.id}>
                      <details
                        className={`uke-fumi ${TIER_CLASS[f.tier]} ${
                          pick ? "uke-fumi--picked" : ""
                        }`.trim()}
                        open={f.tier === "stale"}
                      >
                        <summary className="uke-fumi__summary">
                          <span className="uke-fumi__seal">
                            <UkeSprite
                              name="fumi"
                              width={48}
                              className="is-closed"
                            />
                            <UkeSprite
                              name="fumi-open"
                              width={48}
                              className="is-open"
                            />
                          </span>
                          <span>
                            <span className="uke-fumi__title">{f.title}</span>
                            <span className="uke-fumi__meta">
                              <span className={`uke-from ${f.fromClass}`.trim()}>
                                {f.source}
                              </span>
                              <span>
                                {f.ageText}
                                {f.place ? ` ・ ${f.place}` : ""}
                              </span>
                              <Pips value={f.pips} />
                              {pick ? (
                                <span className="text-[#3ecf5a]">
                                  えらんだ: {ACTION_LABEL[pick]}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span
                            className={`uke-fumi__due ${TIER_DUE_CLASS[f.tier]}`.trim()}
                          >
                            ほうち<b>{f.days}にち</b>
                          </span>
                        </summary>
                        <div className="uke-fumi__paper">
                          {f.note ? (
                            <p className="uke-fumi__note">{f.note}</p>
                          ) : (
                            <p className="uke-fumi__note">
                              本文は 記されておらぬ。ひらいて たしかめよ。
                            </p>
                          )}
                          {f.triageReason ? (
                            <p className="uke-fumi__hint">
                              <i className="uke-mk uke-mk--sky" />
                              しわけの てがかり <b>{f.triageReason}</b>
                            </p>
                          ) : null}
                          <div className="uke-cmd">
                            <p className="uke-cmd__title">しわけ</p>
                            <ul className="uke-cmd__list">
                              {COMMANDS.map((c) => (
                                <li key={c.action}>
                                  <button
                                    type="button"
                                    onClick={() => toggle(f.id, c.action)}
                                    aria-pressed={pick === c.action}
                                    className={`uke-cmd__btn ${
                                      pick === c.action ? "is-sel" : ""
                                    } ${c.drop ? "is-drop" : ""}`.trim()}
                                  >
                                    <i />
                                    <span className="uke-cmd__key">{c.key}</span>
                                    <span className="uke-cmd__desc">
                                      {c.desc}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                            <p className="uke-cmd__note">
                              <i className="uke-mk uke-mk--dust" />
                              ここは 受付。えらぶだけで 台帳は 変わらぬ。手を うごかすのは{" "}
                              <b>じゅもん（MCP triage_inbox）</b> じゃ。
                            </p>
                            <p className="uke-cmd__note">
                              <Link
                                href={`/inbox/${f.id}`}
                                className="text-[#f0d25a] no-underline"
                              >
                                ふみの ぜんぶんを ひらく
                              </Link>
                            </p>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}

        {expiredCount > 0 ? (
          <p className="uke-more">
            ちりに かえった ふみ {expiredCount}つう（じゅもんで 掘り起こせる）
          </p>
        ) : null}
      </section>
    </>
  );
}
