import Link from "next/link";
import type { SystemKind } from "@/lib/atlas-taxonomy";
import { systemLabel } from "@/lib/atlas-taxonomy";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasUkebakoReception } from "./atlas-ukebako-reception";
import { AtlasUkebakoFumi } from "./atlas-ukebako-fumi";
import { UkeSprite } from "./atlas-ukebako-sprites";
import {
  daysSince,
  mmdd,
  restDays,
  toFumiView,
  trialPips,
  wearPips,
  type UkebakoBoard,
} from "./ukebako-view";

export type EntryItem = {
  id: string;
  title: string;
  source?: string;
  usedCount?: number;
  /** entry=登録済み学び / capture=受信箱の未仕分け */
  kind: "entry" | "capture";
  pending?: boolean;
  placeLabel?: string;
  system?: SystemKind;
  at?: Date;
  dayKey?: string;
  dayLabel?: string;
  /** 本文（capture の下書き / entry のノート） */
  note?: string | null;
  /** capture の捕捉文脈 */
  context?: string | null;
  /** capture の重要度 0-100 */
  importance?: number | null;
  /** capture の仕分けヒント */
  triageReason?: string | null;
  /** entry を最後に使った日（つかった きろくの最新） */
  lastUsedAt?: Date;
};

const TRIAL_STATUS_LABEL: Record<string, string> = {
  active: "かせつ けんしょう",
  completed: "けっちゃく",
  abandoned: "うちきり",
};

/** 棚札・けっか行は器の大きさが主。あふれる原文は詳細ページで読む */
function clampText(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** /entries — うけばこ（ぼうけんしゃギルドの 受付所） */
export function AtlasEntries({
  items,
  board,
  streakDays,
  evidenceHint,
  mcpRegisterHint = false,
  wsToken = null,
}: {
  items: EntryItem[];
  /** しれん・つかった きろく・台帳の数 */
  board: UkebakoBoard;
  streakDays?: number;
  /** もくひょうから来たときの誤解防止バナー */
  evidenceHint?: { goalId: string; goalTitle?: string } | null;
  /** /entries/new 旧フォームからのリダイレクト */
  mcpRegisterHint?: boolean;
  wsToken?: string | null;
}) {
  // 経過日数はサーバ側の 1 つの now で確定させる（クライアント再計算は hydration がずれる）
  const now = new Date();

  const fumi = items
    .filter((i) => i.pending)
    .map((i) => toFumiView(i, now));
  const stale = fumi.filter((f) => f.tier === "stale").length;
  const warn = fumi.filter((f) => f.tier === "warn").length;

  // くら: つかわれた ものが 手前、ねむったままは 奥
  const tools = items
    .filter((i) => i.kind === "entry")
    .sort((a, b) => (b.usedCount ?? 0) - (a.usedCount ?? 0));
  const shelves = chunk(tools, 3);

  return (
    <AtlasChrome active="/entries" streakDays={streakDays}>
      <AtlasShell className="uke">
        {mcpRegisterHint ? (
          <AtlasReveal as="section" className="dq-win border-[3px] border-[#f0d25a] p-3.5">
            <h2 className="dq-win-title mb-2">登録フォームは閉じた</h2>
            <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
              学びの登録はじゅもんの道へ移したのじゃ。
            </p>
            <p className="mt-1.5 mb-0 border-l-[3px] border-[#9ec0ff] pl-2 text-[12px] leading-relaxed text-[#f7f3d9]">
              <span className="font-[family-name:var(--font-pixel)] text-[12px] text-[#9ec0ff]">
                つまり{" "}
              </span>
              下の『じゅもんをとなえる』か外部 MCP で capture_learning_candidate。この受付所は結果の棚。
            </p>
          </AtlasReveal>
        ) : null}
        {evidenceHint ? (
          <AtlasReveal as="section" className="dq-win border-[3px] border-[#f0d25a] p-3.5">
            <h2 className="dq-win-title mb-2">証跡は棚ではなくじゅもんで</h2>
            <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
              下のじゅもんか、もくひょう詳細から残せ。
            </p>
            <Link
              href={`/goals/${evidenceHint.goalId}`}
              className="dq-btn mt-3 !px-3 !py-2 text-[12px]"
            >
              もくひょう詳細へ
            </Link>
          </AtlasReveal>
        ) : null}

        {/* 1. 受付の間 */}
        <AtlasReveal as="section">
          <AtlasUkebakoReception
            pending={board.stats.pending || fumi.length}
            stale={stale}
            warn={warn}
            entryTotal={board.stats.entryTotal}
            sleeping={board.stats.sleeping}
            applicationTotal={board.stats.applicationTotal}
            trialActive={board.stats.trialActive}
            expired={board.stats.expired}
          />
        </AtlasReveal>

        {/* 2. じゅもん ＋ とどいた ふみ */}
        <AtlasReveal as="section" delayIndex={1} className="grid gap-3.5">
          <AtlasUkebakoFumi
            fumi={fumi}
            expiredCount={board.stats.expired}
            wsToken={wsToken}
            evidenceHint={evidenceHint}
          />
        </AtlasReveal>

        {/* 3. しれん */}
        {board.trials.length > 0 ? (
          <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
            <header className="uke-head">
              <h2 className="uke-head__title">
                けいやく中の しれん
                <span className="uke-head__count">{board.trials.length}</span>
              </h2>
              <div className="uke-rule" />
              <p className="uke-blurb">
                かせつを ひとつ 立て、日を かさねて たしかめる ながい ためし。
              </p>
            </header>
            <div className="grid gap-3.5">
              {board.trials.map((t) => {
                const pips = trialPips(t.startDate, t.endDate, now);
                const rest = restDays(t.endDate, now);
                return (
                  <div key={t.id} className="uke-trial">
                    <div>
                      <span className="uke-trial__kind">
                        {TRIAL_STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      <Link
                        href={`/experiments/${t.id}`}
                        className="uke-trial__hypo block"
                      >
                        <b>{t.action}</b>
                      </Link>
                      <p className="uke-trial__guide">
                        みちしるべ ・ <em>{t.successMetric}</em>
                        <br />
                        もとの まなび{" "}
                        <Link
                          href={`/entries/${t.entryId}`}
                          className="text-[#9ec0ff] no-underline"
                        >
                          {t.entryTitle}
                        </Link>
                        {t.checkInCount > 0
                          ? ` ・ みとどけ ${t.checkInCount}かい`
                          : ""}
                      </p>
                    </div>
                    <div className="uke-trial__right">
                      <p className="uke-trial__rest">
                        {rest}
                        <small>日</small>
                      </p>
                      <p className="uke-trial__restlabel">のこり</p>
                      <div
                        className="uke-gauge"
                        aria-label={`${pips.today + 1}日め / ${pips.total}日`}
                      >
                        {Array.from({ length: pips.total }).map((_, i) => (
                          <i
                            key={i}
                            className={
                              i < pips.passed
                                ? "on"
                                : i === pips.today
                                  ? "today"
                                  : undefined
                            }
                          />
                        ))}
                      </div>
                      <p className="uke-trial__span">
                        {mmdd(t.startDate)} - {mmdd(t.endDate)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </AtlasReveal>
        ) : null}

        {/* 4. くら */}
        <AtlasReveal as="section" delayIndex={3} className="dq-win p-3.5">
          <header className="uke-head">
            <h2 className="uke-head__title">
              くら ・ おさめた まなび
              <span className="uke-head__count">{board.stats.entryTotal}</span>
            </h2>
            <div className="uke-rule" />
            <p className="uke-blurb">
              しわけで さいようされた まなびは ここに つむ。
              <br />
              つかうほど 手に なじみ、つかわねば ほこりを かぶる。
            </p>
          </header>

          {tools.length === 0 ? (
            <p className="m-0 text-center text-[14px] text-[#c9c3a0]">
              くらは からっぽじゃ。ふみを しわけ すれば ここに つむ。
            </p>
          ) : (
            <div className="uke-case">
              <ul className="uke-shelf">
                {shelves.map((row, ri) => (
                  <li key={row[0]?.id ?? ri}>
                    <ul className="uke-shelf__row">
                      {row.map((t) => {
                        const used = t.usedCount ?? 0;
                        const wear = wearPips(used);
                        const sleepDays = daysSince(t.at, now);
                        return (
                          <li key={t.id}>
                            <Link
                              href={`/entries/${t.id}`}
                              className={`uke-tool ${
                                used > 0 ? "uke-tool--worn" : "uke-tool--sleep"
                              }`}
                            >
                              <UkeSprite name="maki" width={32} />
                              <div>
                                <p className="uke-tool__name">{t.title}</p>
                                <p className="uke-tool__use">
                                  <span className="uke-wear">
                                    {[0, 1, 2, 3, 4].map((i) => (
                                      <i
                                        key={i}
                                        className={i < wear ? "on" : undefined}
                                      />
                                    ))}
                                  </span>
                                  <span className="whitespace-nowrap">
                                    {used > 0
                                      ? `つかった ${used}かい ・ なじんだ`
                                      : `ねむったまま ・ ${sleepDays}にち`}
                                  </span>
                                </p>
                                <p className="uke-tool__meta">
                                  {[
                                    t.dayLabel,
                                    t.system && t.system !== "other"
                                      ? systemLabel(t.system)
                                      : null,
                                    t.source ? clampText(t.source, 22) : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ・ ")}
                                </p>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="uke-shelf__plank" aria-hidden />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {board.stats.sleeping > 0 ? (
            <div className="uke-alert">
              <p>
                <i className="uke-mk" />
                くらの まなび {board.stats.entryTotal} のうち{" "}
                <b>{board.stats.sleeping}</b>{" "}
                は、おさめてから 一度も つかわれておらぬ。
                <br />
                つかった きろくの ない まなびは、やがて さびる。
              </p>
            </div>
          ) : null}
        </AtlasReveal>

        {/* 5. つかった きろく */}
        <AtlasReveal as="section" delayIndex={4} className="dq-win p-3.5">
          <header className="uke-head">
            <h2 className="uke-head__title">
              つかった きろく
              <span className="uke-head__count">
                {board.stats.applicationTotal}
              </span>
            </h2>
            <div className="uke-rule" />
            <p className="uke-blurb">
              くらの まなびが、じっさいの たたかいで 判断を かえた しゅんかん。
            </p>
          </header>
          {board.log.length === 0 ? (
            <p className="m-0 text-center text-[14px] text-[#c9c3a0]">
              まだ きろくは ない。つかったら じゅもん（record_application）で のこせ。
            </p>
          ) : (
            <ol className="uke-log">
              {board.log.map((a) => (
                <li key={a.id}>
                  <p className="uke-log__when">{mmdd(a.createdAt)}</p>
                  <div>
                    <p className="uke-log__where">
                      {clampText(a.appliedTo, 48)}
                    </p>
                    <p className="uke-log__cast">
                      <Link href={`/entries/${a.entryId}`}>
                        「{a.entryTitle}」
                      </Link>{" "}
                      を となえた
                    </p>
                    <p className="uke-log__result">
                      <span>{clampText(a.decisionChanged || a.note, 110)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </AtlasReveal>

        {/* 週次・音声（既存の導線） */}
        <AtlasReveal as="section" delayIndex={5} className="dq-win p-3.5">
          <h2 className="dq-win-title">週次・音声</h2>
          <p className="mb-3 text-[13px] leading-relaxed text-[#c9c3a0]">
            ナビ姫ルミナが先週のちずを語る。月曜の朝の要約で原稿が溜まる。音声化は外出し。
          </p>
          <Link href="/digest" className="dq-btn w-fit !px-3 !py-2 text-[12px]">
            ルミナの語りをきく
          </Link>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={6}>
          <p className="uke-foot">
            <i className="uke-mk uke-mk--sky" />
            うけばこは <b>うけつけ</b> じゃ。ここで できるのは 「ひらく・よむ・えらぶ」。
            <br />
            しわけ・くらへの おさめ・きろくの のこしは、すべて <b>じゅもん（MCP）</b> が
            おこなう。アプリに 入力フォームは 増やさぬ。
          </p>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
