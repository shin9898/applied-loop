import { UkeSprite } from "./atlas-ukebako-sprites";

/** ふみの山の置き場所。後ろの要素ほど 山の上（= あぶない ふみ を 上に積む） */
const PILE_SLOTS = [
  { left: 0, lift: -3, rot: -8 },
  { left: 34, lift: -6, rot: 5 },
  { left: 74, lift: 0, rot: -3 },
  { left: 17, lift: -26, rot: 6 },
  { left: 59, lift: -30, rot: -5 },
  { left: 26, lift: -52, rot: -9 },
  { left: 65, lift: -58, rot: 4 },
] as const;

export type UkebakoStep = {
  label: string;
  /** 右端に出す数。0 なら片付いている */
  n: number;
};

export type UkebakoReceptionProps = {
  pending: number;
  stale: number;
  warn: number;
  entryTotal: number;
  sleeping: number;
  applicationTotal: number;
  trialActive: number;
  expired: number;
};

/**
 * 受付の間（HERO）。
 * ここは「今どれだけ溜まっていて、次に何をするか」だけを見せる場所で、
 * 実行系のフォームは置かない（実行は じゅもん = MCP）。
 */
export function AtlasUkebakoReception({
  pending,
  stale,
  warn,
  entryTotal,
  sleeping,
  applicationTotal,
  trialActive,
  expired,
}: UkebakoReceptionProps) {
  const drawn = Math.min(PILE_SLOTS.length, pending);
  const hotFrom = drawn - Math.min(stale, drawn);

  const steps: UkebakoStep[] = [
    { label: "ふるびた ふみ を しわけ する", n: stale },
    { label: "ねむったままの まなび を 1つ つかう", n: sleeping },
    { label: "しれん の みちしるべ を たしかめる", n: trialActive },
  ];
  const nowIndex = steps.findIndex((s) => s.n > 0);

  return (
    <div className="grid gap-3.5">
      <div className="uke-room">
        <div className="uke-room__wall" />
        <div className="uke-room__floor" />

        <div className="uke-banner">
          <span className="uke-banner__mark" />
        </div>
        <div className="uke-lamp">
          <span className="uke-lamp__glow" />
        </div>
        <div className="uke-torch uke-torch--l">
          <i />
        </div>
        <div className="uke-torch uke-torch--r">
          <i />
        </div>

        {/* ともしび — 人型ではない ランタンの ようれい。受付に ういている */}
        <div className="uke-tomo">
          <div className="uke-tomo__body">
            <span className="uke-tomo__glow" aria-hidden />
            <UkeSprite name="tomo" width={64} label="ともしび" />
            <UkeSprite
              name="tomo-blink"
              width={64}
              className="uke-tomo__blink"
            />
            <span className="uke-tomo__shadow" aria-hidden />
          </div>
          <span className="uke-name">ともしび</span>
        </div>

        <div className="uke-inkpot" aria-hidden>
          <UkeSprite name="ink" width={42} />
        </div>

        {pending > 0 ? (
          <div className="uke-pile">
            <div className="uke-pile__badge">
              <b>{pending}</b>
              <span>つう</span>
            </div>
            {PILE_SLOTS.slice(0, drawn).map((slot, i) => (
              <span
                key={slot.left + "-" + slot.lift}
                className={`uke-pile__env ${
                  i >= hotFrom ? "uke-pile__env--hot" : ""
                }`.trim()}
                style={{
                  left: slot.left,
                  transform: `translateY(${slot.lift}px) rotate(${slot.rot}deg)`,
                }}
              >
                <UkeSprite name="fumi" width={64} />
              </span>
            ))}
            {stale > 0 ? (
              <span className="uke-pile__suna">
                <UkeSprite name="suna" width={24} />
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="uke-desk">
          <div className="uke-desk__top" />
          <div className="uke-desk__front" />
          <div className="uke-desk__plate">うけばこ ・ うけつけ</div>
        </div>
      </div>

      <div className="uke-lower">
        <div className="dq-win uke-talk p-3.5">
          <span className="uke-talk__speaker">ともしび</span>
          <p>
            <i className="uke-mk" />
            おかえりなさい、ぼうけんしゃ どの。
          </p>
          {pending === 0 ? (
            <p>
              みしわけの ふみは <b>ない</b>。うけつけは しずかじゃ。
            </p>
          ) : (
            <p>
              みしわけの ふみが <b>{pending}つう</b> とどいて おる。
            </p>
          )}
          {stale > 0 ? (
            <p className="is-warn">
              されど そのうち <b>{stale}つう</b> は 14にち いじょう ひらかれておらぬ。
            </p>
          ) : warn > 0 ? (
            <p>
              そのうち <b>{warn}つう</b> は そろそろ ひらく ころあいじゃ。
            </p>
          ) : null}
          {stale > 0 ? (
            <p>まずは その {stale}つう から ひらくが よい。</p>
          ) : sleeping > 0 ? (
            <p>
              くらには ねむったままの まなびが <b>{sleeping}</b>。つかってこそ 身につく。
            </p>
          ) : null}

          <div className="uke-steps-box">
            <p className="uke-steps__title">きょうの てじゅん</p>
            <ol className="uke-steps">
              {steps.map((s, i) => (
                <li
                  key={s.label}
                  className={
                    s.n === 0 ? "is-done" : i === nowIndex ? "is-now" : undefined
                  }
                >
                  <i />
                  <span>{s.label}</span>
                  <span className="uke-steps__n">{s.n}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="dq-win p-3.5">
          <div className="uke-ledger__hero">
            <p className="uke-ledger__label">みしわけの ふみ</p>
            <p className="uke-ledger__big">
              {pending}
              <small>つう</small>
            </p>
            {stale > 0 ? (
              <p className="uke-ledger__warn">ふるびた {stale}つう</p>
            ) : null}
          </div>
          <ul className="uke-ledger__list">
            <li>
              <span>ふるびた（14にち〜）</span>
              <span className="uke-ledger__dots" />
              <span
                className={`uke-ledger__v ${stale > 0 ? "is-danger" : ""}`.trim()}
              >
                {stale}
              </span>
            </li>
            <li>
              <span>そろそろ（7にち〜）</span>
              <span className="uke-ledger__dots" />
              <span className="uke-ledger__v">{warn}</span>
            </li>
            <li>
              <span>くらの まなび</span>
              <span className="uke-ledger__dots" />
              <span className="uke-ledger__v">{entryTotal}</span>
            </li>
            <li>
              <span>ねむったまま</span>
              <span className="uke-ledger__dots" />
              <span
                className={`uke-ledger__v ${sleeping > 0 ? "is-sleep" : ""}`.trim()}
              >
                {sleeping}
              </span>
            </li>
            <li>
              <span>つかった きろく</span>
              <span className="uke-ledger__dots" />
              <span className="uke-ledger__v is-hp">{applicationTotal}</span>
            </li>
            <li>
              <span>はしってる しれん</span>
              <span className="uke-ledger__dots" />
              <span className="uke-ledger__v">{trialActive}</span>
            </li>
            {expired > 0 ? (
              <li>
                <span>ちりに かえった ふみ</span>
                <span className="uke-ledger__dots" />
                <span className="uke-ledger__v">{expired}</span>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="uke-cta">
        <a className="dq-btn" href="#uke-fumi">
          {stale > 0
            ? `ふるびた ふみ ${stale}つう を ひらく`
            : pending > 0
              ? `とどいた ふみ ${pending}つう を 見る`
              : "くらの まなびを 見る"}
        </a>
        <a className="dq-btn dq-btn-ghost" href="#uke-jumon">
          じゅもんで まとめて しわける
        </a>
      </div>
    </div>
  );
}
