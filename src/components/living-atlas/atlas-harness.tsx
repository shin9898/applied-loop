import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { PixelSprite } from "./atlas-pixel";
import type { MaterialCaptureHealth } from "./load-atlas-data";

export type HarnessRepo = {
  id: string;
  name: string;
  health: "ok" | "warn" | "bad";
  note: string;
  /** 監視本線 or 計測だけで見えた */
  tier: "watched" | "discovered";
  /** LLM セッション計測があるか（cache 週次レート等） */
  measured: boolean;
  /** 今日の DevEvent (commit) 件数。監視本線向け */
  commitCountToday?: number;
  /** 何を持ってその判定か */
  criteria?: string;
  /** より良くするための一手 */
  uplift?: string;
  prescriptionHref?: string;
  nextAction?: { label: string; href: string };
};

/**
 * けものの ようす。データモデル（health 3値 + measured）はそのまま、
 * 見せかたの語彙だけ「ペット・召喚契約獣」に寄せる。
 *   health ok/warn/bad → げんき / そわそわ / しょんぼり
 *   measured=false     → ねむり（判じるための計測が無い＝静かに眠っている）
 */
type BeastState = "ok" | "warn" | "bad" | "sleep";

const BEAST_LABEL: Record<BeastState, string> = {
  ok: "げんき",
  warn: "そわそわ",
  bad: "しょんぼり",
  sleep: "ねむり",
};

const BEAST_SPRITE = {
  ok: "pet-happy",
  warn: "pet-restless",
  bad: "pet-weak",
  sleep: "pet-sleep",
} as const;

/** げんきバーの割合。旧 UI の 85/45/22% をそのまま引き継ぐ（3値の視覚化） */
const BEAST_GENKI: Record<BeastState, number> = {
  ok: 85,
  warn: 45,
  bad: 22,
  sleep: 0,
};

const BEAST_GENKI_COLOR: Record<BeastState, string> = {
  ok: "var(--atlas-hp)",
  warn: "var(--atlas-gold)",
  bad: "var(--atlas-warm)",
  sleep: "transparent",
};

function beastState(repo: HarnessRepo): BeastState {
  return repo.measured ? repo.health : "sleep";
}

/** けいやくを むすんだ リポジトリ 1 ひき */
function BeastCard({ repo }: { repo: HarnessRepo }) {
  const state = beastState(repo);
  // もんしょう＝けいやくの証。未契約（計測だけで見えた repo）は ともっていない。
  const sigil = repo.tier === "watched" ? state : "none";
  return (
    <li className={`atlas-dg-beast atlas-px-cut atlas-dg-beast--${state}`}>
      <div className="atlas-dg-nest">
        <PixelSprite name="bed" className="atlas-dg-nest__bed" />
        <PixelSprite
          name={BEAST_SPRITE[state]}
          className={`atlas-dg-nest__pet atlas-dg-pet--${state}`}
        />
        {state === "ok" ? (
          <span
            className="atlas-dg-nest__joy"
            style={{ color: "var(--atlas-hp)" }}
            aria-hidden="true"
          >
            <PixelSprite name="heart" />
            <PixelSprite name="heart" />
          </span>
        ) : null}
        {state === "warn" ? (
          <span className="atlas-dg-sweat" aria-hidden="true" />
        ) : null}
        {state === "sleep" ? (
          <span className="atlas-dg-zzz" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <PixelSprite
          name="emblem"
          className={`atlas-dg-nest__sigil atlas-dg-sigil--${sigil}`}
        />
      </div>
      <div>
        <p className="atlas-dg-beast__name">
          {repo.name}
          <span className={`atlas-dg-beast__tag atlas-dg-tag--${state}`}>
            {BEAST_LABEL[state]}
          </span>
        </p>
        <div className="atlas-dg-genki">
          <span className="atlas-dg-genki__label">げんき</span>
          <span className="atlas-dg-genki__bar">
            <i
              style={{
                width: `${BEAST_GENKI[state]}%`,
                background: BEAST_GENKI_COLOR[state],
              }}
            />
          </span>
        </div>
        <p className="atlas-dg-beast__note">{repo.note}</p>
        {repo.criteria || typeof repo.commitCountToday === "number" ? (
          <p className="atlas-dg-beast__why">
            根拠:{" "}
            {typeof repo.commitCountToday === "number"
              ? `きょうの あしあと ${repo.commitCountToday}`
              : null}
            {repo.criteria && typeof repo.commitCountToday === "number"
              ? " ・ "
              : null}
            {repo.criteria}
          </p>
        ) : null}
        {repo.uplift ? (
          <p className="atlas-dg-beast__uplift">より良く: {repo.uplift}</p>
        ) : null}
        {repo.nextAction || repo.prescriptionHref ? (
          <div className="atlas-dg-beast__act">
            {repo.nextAction ? (
              <Link href={repo.nextAction.href} className="atlas-link-gold">
                {repo.nextAction.label}
              </Link>
            ) : (
              <Link href={repo.prescriptionHref!} className="atlas-link-gold">
                見立て
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function BeastSection({
  title,
  sub,
  blurb,
  repos,
  empty,
  delayIndex,
}: {
  title: string;
  sub: string;
  blurb: string;
  repos: HarnessRepo[];
  empty: string;
  delayIndex?: number;
}) {
  return (
    <AtlasReveal
      as="section"
      delayIndex={delayIndex}
      className="atlas-win-px atlas-px-cut"
    >
      <AtlasPageTitle title={title} sub={sub} />
      <p className="atlas-win-px__lead">{blurb}</p>
      {repos.length === 0 ? (
        <p className="m-0 text-[14px] text-[#c9c3a0]">{empty}</p>
      ) : (
        <ul className="atlas-dg-beasts">
          {repos.map((repo) => (
            <BeastCard key={repo.id} repo={repo} />
          ))}
        </ul>
      )}
    </AtlasReveal>
  );
}

type PulseGrade = "ok" | "warn" | "bad";

function pulseGrade(pct: number): PulseGrade {
  if (pct >= 0.9) return "ok";
  if (pct >= 0.7) return "warn";
  return "bad";
}

const PULSE_STATE_LABEL: Record<PulseGrade, string> = {
  ok: "すこやか",
  warn: "すこし よわい",
  bad: "よわっておる",
};

const PULSE_COLOR: Record<PulseGrade, string> = {
  ok: "var(--atlas-hp)",
  warn: "var(--atlas-gold)",
  bad: "var(--atlas-danger)",
};

/**
 * 1日＝1拍。棘の高さが その日の「拾えた率」。左が古く、右がいちばん新しい日。
 * 日数が少ないうちは帯がスカスカに見えるので、同じ列を繰り返して「打ち続けている脈」にする
 * （記録が 14 日ぶん溜まれば繰り返しは 1 周＝実データそのままになる）。
 */
function ecgBeats(days: MaterialCaptureHealth["days"]) {
  if (days.length === 0) return [];
  const reps = Math.max(1, Math.ceil(12 / days.length));
  const out: { key: string; grade: PulseGrade; h: number }[] = [];
  for (let r = 0; r < reps; r++) {
    for (const d of days) {
      const pct = d.materialCount > 0 ? 1 - d.droppedCount / d.materialCount : 1;
      const grade = pulseGrade(pct);
      // 4px 刻みに丸めてドットを潰さない
      const spike = 16 + Math.round((pct * 48) / 4) * 4;
      [8, 8, 12, spike, 12, 8, 4].forEach((h, i) => {
        out.push({ key: `${r}-${d.dateKey}-${i}`, grade, h });
      });
    }
  }
  return out;
}

/**
 * どうぐの一次シグナル: 材料（commit / セッション学び）を漏れなく拾えているか（ADR-0020 §6-4）。
 * 数字のダッシュボードではなく「しくみ 1 体のこどう」として見せるが、
 * 拾えた率・脱落件数・日ごとの内訳という中身は落とさない。
 */
function PulseSection({ health }: { health: MaterialCaptureHealth }) {
  const { days, inboxPending, inboxExpired } = health;
  const totalMaterial = days.reduce((s, d) => s + d.materialCount, 0);
  const totalDropped = days.reduce((s, d) => s + d.droppedCount, 0);
  const overallPct = totalMaterial > 0 ? 1 - totalDropped / totalMaterial : null;
  const today = days.length > 0 ? days[days.length - 1] : null;
  const todayPct =
    today && today.materialCount > 0
      ? 1 - today.droppedCount / today.materialCount
      : null;
  const grade = pulseGrade(todayPct ?? overallPct ?? 1);
  const beats = ecgBeats(days);

  return (
    <AtlasReveal as="section" className="atlas-win-px atlas-px-cut">
      <AtlasPageTitle
        title="しくみのこどう"
        sub="どうぐの一次シグナル"
      />
      {days.length === 0 ? (
        <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
          まだ日次教科書が無い。こどうは まだ 打っておらぬ。
          夜の振り返りで最初の1本ができると、ここに脈が出る。
        </p>
      ) : (
        <div className="atlas-dg-pulse">
          <div>
            <div className={`atlas-dg-heart atlas-dg-heart--${grade}`}>
              <PixelSprite name="ring" className="atlas-dg-heart__wave" />
              <PixelSprite
                name="ring"
                className="atlas-dg-heart__wave atlas-dg-heart__wave--b"
              />
              <PixelSprite name="ring2" className="atlas-dg-heart__ring2" />
              <PixelSprite name="ring" className="atlas-dg-heart__ring" />
              <PixelSprite name="core" className="atlas-dg-heart__core" />
            </div>
          </div>
          <div>
            <div
              className="atlas-dg-vitals__state"
              style={{ color: PULSE_COLOR[grade] }}
            >
              {PULSE_STATE_LABEL[grade]}
            </div>
            <div
              className="atlas-dg-vitals__num"
              style={{ color: PULSE_COLOR[grade] }}
            >
              {todayPct != null ? Math.round(todayPct * 100) : "--"}
              <small>%</small>
            </div>
            <div className="atlas-dg-vitals__label">
              {today ? `${today.dateKey.slice(5)} に ひろえた 材料の わりあい` : ""}
            </div>
            {today ? (
              <p className="atlas-dg-vitals__line">
                材料 {today.materialCount} のうち{" "}
                <b style={{ color: PULSE_COLOR[grade] }}>
                  {today.droppedCount} が かまどで 灰になった
                </b>
                。教科書へ 届いたのは {today.materialCount - today.droppedCount}。
              </p>
            ) : null}
            {overallPct != null && days.length > 1 ? (
              <p className="atlas-dg-vitals__line">
                直近 {days.length} 日では 材料 {totalMaterial} のうち{" "}
                {totalDropped} 件が圧縮で脱落（拾えた率{" "}
                {Math.round(overallPct * 100)}%）。
              </p>
            ) : null}

            <div className="atlas-dg-ecg">
              <div className="atlas-dg-ecg__scale" />
              {beats.map((b) => (
                <i
                  key={b.key}
                  className={`is-${b.grade}`}
                  style={{ height: `${b.h}px` }}
                />
              ))}
              <div className="atlas-dg-ecg__sweep" />
            </div>

            <div className="atlas-dg-legend">
              <div className="atlas-dg-legend__item">
                <PixelSprite name="dia-m" className="atlas-dg-mini--ok" />
                <span className="atlas-dg-legend__txt">
                  <b>安 / 90%〜</b>ゆっくり 静かに 光る
                </span>
              </div>
              <div className="atlas-dg-legend__item">
                <PixelSprite name="dia-m" className="atlas-dg-mini--warn" />
                <span className="atlas-dg-legend__txt">
                  <b>注 / 70〜89%</b>脈が 速くなる
                </span>
              </div>
              <div className="atlas-dg-legend__item">
                <PixelSprite name="dia-m" className="atlas-dg-mini--bad" />
                <span className="atlas-dg-legend__txt">
                  <b>危 / 〜69%</b>不規則に 打つ
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      <p className="mt-4 mb-0 text-[12px] leading-relaxed text-[#9ec0ff]">
        受信箱（Capture）: 未仕分け {inboxPending} 件・期限切れ {inboxExpired} 件
      </p>
    </AtlasReveal>
  );
}

/** 材料のながれ。足あと → 受信箱 → かまど → 日次教科書。こぼれを見えるところに置く。 */
function FlowSection({ health }: { health: MaterialCaptureHealth }) {
  const { days, inboxPending, inboxExpired } = health;
  const today = days.length > 0 ? days[days.length - 1] : null;
  if (!today) return null;
  const delivered = today.materialCount - today.droppedCount;
  const dropped = today.droppedCount;

  return (
    <AtlasReveal
      as="section"
      delayIndex={1}
      className="atlas-win-px atlas-px-cut"
    >
      <AtlasPageTitle
        title="材料のながれ"
        sub="足あと → 受信箱 → かまど → 日次教科書"
      />
      <p className="atlas-win-px__lead">
        実装の足あとが、どこで どれだけ こぼれているか。管の中の粒が材料じゃ。
        かまどの下に落ちた粒は、だまって消えたのではなく
        <span style={{ color: "var(--atlas-danger)" }}> とりこぼし </span>
        として残っておる。ひろい直せる。
      </p>

      <div className="atlas-dg-flow-wrap">
        <div className="atlas-dg-flow">
          <div className="atlas-dg-station atlas-px-cut">
            <div className="atlas-dg-station__icon">
              <PixelSprite name="foot" className="text-[#9ec0ff]" />
            </div>
            <span className="atlas-dg-station__name">あしあと</span>
            <span className="atlas-dg-station__n">{today.materialCount}</span>
          </div>
          <div className="atlas-dg-pipe">
            {[0, 0.45, 0.9, 1.35, 1.8, 2.25].map((d) => (
              <span
                key={d}
                className="atlas-dg-mote"
                style={{ animationDelay: `${d}s` }}
              />
            ))}
          </div>
          <div className="atlas-dg-station atlas-px-cut">
            <div className="atlas-dg-station__icon">
              <PixelSprite name="box" className="text-[#9ec0ff]" />
            </div>
            <span className="atlas-dg-station__name">じゅしんばこ</span>
            <span className="atlas-dg-station__n">{inboxPending}</span>
            <span className="atlas-dg-station__sub">
              未仕分け
              <br />
              期限切れ {inboxExpired}
            </span>
          </div>
          <div className="atlas-dg-pipe">
            {[0.2, 0.8, 1.4, 2].map((d) => (
              <span
                key={d}
                className="atlas-dg-mote"
                style={{ animationDelay: `${d}s` }}
              />
            ))}
          </div>
          <div
            className={`atlas-dg-station atlas-px-cut ${
              dropped > 0 ? "atlas-dg-station--forge" : ""
            }`}
          >
            <div className="atlas-dg-station__icon">
              <PixelSprite name="forge" className="text-[#c07050]" />
            </div>
            {dropped > 0 ? (
              <span className="atlas-dg-crack" aria-hidden="true" />
            ) : null}
            <span className="atlas-dg-station__name">あっしゅくのかまど</span>
            <span className="atlas-dg-station__n">
              {dropped > 0 ? `-${dropped}` : "0"}
            </span>
          </div>
          <div className="atlas-dg-pipe atlas-dg-pipe--thin">
            {[0.6, 1.7].map((d) => (
              <span
                key={d}
                className="atlas-dg-mote"
                style={{ animationDelay: `${d}s` }}
              />
            ))}
          </div>
          <div className="atlas-dg-station atlas-px-cut">
            <div className="atlas-dg-station__icon">
              <PixelSprite name="book" className="text-[#f0d25a]" />
            </div>
            <span className="atlas-dg-station__name">にっしきょうかしょ</span>
            <span className="atlas-dg-station__n">{delivered}</span>
          </div>

          <div className="atlas-dg-spill">
            {dropped > 0 ? (
              <div className="atlas-dg-spill__drops" aria-hidden="true">
                {[
                  { left: 4, delay: 0 },
                  { left: 20, delay: 0.35 },
                  { left: 36, delay: 0.7 },
                  { left: 52, delay: 1.05 },
                  { left: 28, delay: 1.3 },
                ].map((p) => (
                  <i
                    key={p.left}
                    style={{
                      left: `${p.left}px`,
                      animationDelay: `${p.delay}s`,
                    }}
                  />
                ))}
              </div>
            ) : null}
            <div
              className={`atlas-dg-spill__box atlas-px-cut ${
                dropped > 0 ? "" : "atlas-dg-spill__box--empty"
              }`}
            >
              <b>{dropped}</b>
              <span>とりこぼし</span>
            </div>
          </div>
        </div>
      </div>

      <div className="atlas-dg-flow-caption">
        <p>
          {dropped > 0
            ? `かまどで こぼれた ${dropped} は、まだ 消えてはおらぬ。いま ひろえば きょうの教科書に間に合う。`
            : "きょうは まだ 一粒も こぼれておらぬ。この まま 焼き上げてよい。"}
        </p>
        <Link href="/entries" className="atlas-link-gold">
          きょうの教科書を みる
        </Link>
      </div>
    </AtlasReveal>
  );
}

/** 1日 = 10 マス。欠けたマスが こぼれ。 */
function DaysSection({ health }: { health: MaterialCaptureHealth }) {
  const { days } = health;
  if (days.length === 0) return null;
  return (
    <AtlasReveal
      as="section"
      delayIndex={2}
      className="atlas-win-px atlas-px-cut"
    >
      <AtlasPageTitle
        title={`${days.length}日ぶんのこどう`}
        sub="1マス＝材料の10%。欠けたマスが こぼれ"
      />
      <p className="atlas-win-px__lead">
        マスが 欠けはじめた日を さがせ。そこで しくみを 何か 変えたはずじゃ。
      </p>
      <div className="atlas-dg-days">
        {days.map((d) => {
          const pct =
            d.materialCount > 0 ? 1 - d.droppedCount / d.materialCount : 1;
          const grade = pulseGrade(pct);
          const on = Math.max(0, Math.min(10, Math.round(pct * 10)));
          return (
            <div key={d.dateKey} className={`atlas-dg-day atlas-dg-day--${grade}`}>
              <div className="atlas-dg-day__col">
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < on ? "is-on" : "is-lost"} />
                ))}
              </div>
              <span className="atlas-dg-day__date">{d.dateKey.slice(5)}</span>
              <span className="atlas-dg-day__val">
                {d.materialCount - d.droppedCount}/{d.materialCount}
              </span>
            </div>
          );
        })}
      </div>
    </AtlasReveal>
  );
}

/** /harness — どうぐ（しくみのこどうと、けいやくの けものたち） */
export function AtlasHarness({
  repos,
  streakDays,
  wsToken = null,
  captureHealth,
}: {
  repos: HarnessRepo[];
  streakDays?: number;
  wsToken?: string | null;
  /** ADR-0020: どうぐの一次シグナル（材料キャプチャの完全性） */
  captureHealth: MaterialCaptureHealth;
}) {
  const watched = repos.filter((r) => r.tier === "watched");
  const discovered = repos.filter((r) => r.tier === "discovered");
  const weak = watched.filter((r) => r.health !== "ok" && r.measured);
  const focus = weak[0] ?? watched[0] ?? discovered[0];
  const today =
    captureHealth.days.length > 0
      ? captureHealth.days[captureHealth.days.length - 1]
      : null;
  const todayPct =
    today && today.materialCount > 0
      ? 1 - today.droppedCount / today.materialCount
      : null;

  return (
    <AtlasChrome active="/harness" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section">
          <div className="atlas-talk atlas-px-cut">
            <div className="atlas-talk__face">
              <PixelSprite name="sage" />
            </div>
            <p className="atlas-talk__body">
              ぼうけんしゃよ。ここは しくみの こどうを 見守る 部屋じゃ。
              <br />
              一次シグナルは「材料を 漏れなく 拾えておるか」。
              {todayPct != null ? (
                <>
                  {" "}
                  いまの こどうは <em>{Math.round(todayPct * 100)}%</em> ——{" "}
                  <em>{PULSE_STATE_LABEL[pulseGrade(todayPct)]}</em>。
                </>
              ) : (
                <> まだ こどうは 記録されておらぬ。</>
              )}
              <span className="atlas-cursor" />
            </p>
          </div>
        </AtlasReveal>

        <PulseSection health={captureHealth} />
        <FlowSection health={captureHealth} />
        <DaysSection health={captureHealth} />

        <BeastSection
          title="けいやくの けものたち"
          sub={
            weak.length
              ? `元気の ない子が ${weak.length} ひき`
              : watched.length
                ? `けいやく ${watched.length} ひき`
                : "まだ 1ひきも おらぬ"
          }
          blurb="つないでおるのは くさり ではない。ねどこと、ふわりと ともる もんしょうだけじゃ。げんき / そわそわ / しょんぼりは、キャッシュ効率から見た参考の見立てじゃ。"
          repos={watched}
          empty="まだ けいやくを むすんだ けものが おらぬ。設定から供給対象を追加せよ。"
        />
        <BeastSection
          title="まだ けいやくを むすんでおらぬ けもの"
          sub={
            discovered.length
              ? `${discovered.length} ひき（もんしょう なし）`
              : "いまはなし"
          }
          blurb="監視リストの外じゃが、気配だけ 見えておる repo。作業はしているが 連携が 付いていないときに ここへ 出る。"
          repos={discovered}
          empty="気配だけの けものは いま おらぬ。"
          delayIndex={1}
        />

        <AtlasReveal as="section">
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="harness"
              context={
                focus
                  ? `注目 repo: ${focus.name}\nhealth: ${focus.health}\n${focus.criteria ?? ""}\n${focus.uplift ?? ""}`
                  : "観測なし。suggest_cache_prefix_form の前に計測を溜めよ。"
              }
              title="じゅもんで処方を進める"
              blurb="どうぐの見立てを、じゅもんで実行の段まで進めよ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
