import Link from "next/link";
import { systemLabel, type SystemKind } from "@/lib/atlas-taxonomy";
import { AtlasShell } from "./atlas-shell";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { PixelSprite } from "./atlas-pixel";

export type RequirementItem = {
  id: string;
  title: string;
  kind: "understood" | "next";
  system?: SystemKind;
  /** 未クリアの承認済みゲート。無ければ null（まだ結びが無い） */
  nextGateId: string | null;
  /** 承認まちの紐付け提案件数 */
  suggestedGateCount: number;
};

/** cuid をそのまま出しても読めないので、札の整理番号として末尾だけ見せる */
function slipNo(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

/** 討伐依頼の札 1 枚。しれん（ゲート）が結ばれていない要件は「かきかけの ふだ」 */
function Fuda({ item }: { item: RequirementItem }) {
  const open = !!item.nextGateId;
  return (
    <li className={`atlas-yk-fuda ${open ? "" : "atlas-yk-fuda--draft"}`}>
      <PixelSprite name="nail" className="atlas-yk-nail" />
      <div className="atlas-yk-fuda__top">
        <span className="atlas-yk-fuda__kind">
          {open ? "とうばついらい" : "かきかけの ふだ"}
        </span>
        <span className="atlas-yk-fuda__no">{slipNo(item.id)}</span>
      </div>
      <div className="atlas-yk-fuda__field">
        <span className="atlas-yk-fuda__field-label">りょういき</span>
        <PixelSprite name="dia-s" />
        <span className="atlas-yk-fuda__field-value">
          {systemLabel(item.system ?? "other")}
        </span>
      </div>
      <p className="atlas-yk-fuda__target">{item.title}</p>
      <div className="atlas-yk-fuda__terms">
        <div className="atlas-yk-term">
          <b>しれん</b>
          <span>
            {open
              ? `${slipNo(item.nextGateId!)} 未踏`
              : "まだ 結ばれておらぬ"}
          </span>
        </div>
        {open ? (
          <div className="atlas-yk-term">
            <b>ほうしゅう</b>
            <span>りかい +1 ・ この要件が 綴じへ 移る</span>
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="atlas-yk-fuda__cta">
          <Link
            href={`/gates/${item.nextGateId}`}
            className="atlas-yk-seal atlas-px-cut"
          >
            <PixelSprite name="dia-s" />
            うけたまわる
          </Link>
        </div>
      ) : (
        <div className="atlas-yk-fuda__pending">
          {item.suggestedGateCount > 0 ? (
            <>
              <b>結び提案 {item.suggestedGateCount} けん</b>
              <br />
              承認すれば この札は 依頼になる
            </>
          ) : (
            <>
              <b>結びの提案 なし</b>
              <br />
              じゅもんで しれんを 結べば 依頼になる
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** 板が空のときの案内。見本の札1枚 + 依頼が生まれる3手順で「どう使うか」を見せる */
function EmptyBoardGuide() {
  return (
    <div className="atlas-yk-empty">
      <p className="atlas-yk-board__empty">
        板に 貼られた 札は ないようじゃ。まだ 依頼が 結ばれておらぬ。
      </p>
      <div className="atlas-yk-empty__body">
        <div className="atlas-yk-fuda atlas-yk-fuda--sample" aria-hidden>
          <span className="atlas-yk-fuda__sample-tag">見本</span>
          <PixelSprite name="nail" className="atlas-yk-nail" />
          <div className="atlas-yk-fuda__top">
            <span className="atlas-yk-fuda__kind">とうばついらい</span>
            <span className="atlas-yk-fuda__no">#XXXXXX</span>
          </div>
          <div className="atlas-yk-fuda__field">
            <span className="atlas-yk-fuda__field-label">りょういき</span>
            <PixelSprite name="dia-s" />
            <span className="atlas-yk-fuda__field-value">キャッシュ</span>
          </div>
          <p className="atlas-yk-fuda__target">（要件の内容が ここに 入る）</p>
          <div className="atlas-yk-fuda__terms">
            <div className="atlas-yk-term">
              <b>しれん</b>
              <span>#XXXXXX 未踏</span>
            </div>
            <div className="atlas-yk-term">
              <b>ほうしゅう</b>
              <span>りかい +1 ・ この要件が 綴じへ 移る</span>
            </div>
          </div>
        </div>
        <ol className="atlas-yk-empty__steps">
          <li>
            <span className="atlas-yk-empty__step-no">1</span>
            <div>
              <p className="atlas-yk-empty__step-title">要件を書き記す</p>
              <p className="atlas-yk-empty__step-body">
                <code>register_requirement</code> で要件を1件 書き記す。
              </p>
            </div>
          </li>
          <li>
            <span className="atlas-yk-empty__step-no">2</span>
            <div>
              <p className="atlas-yk-empty__step-title">しれんと結ぶ</p>
              <p className="atlas-yk-empty__step-body">
                <code>link_requirement</code> で理解チェックと紐付け、
                <code>approve_requirement_link</code> で承認する。
              </p>
            </div>
          </li>
          <li>
            <span className="atlas-yk-empty__step-no">3</span>
            <div>
              <p className="atlas-yk-empty__step-title">板に札が立つ</p>
              <p className="atlas-yk-empty__step-body">
                結びが承認されると、この板に依頼として現れる。下の じゅもん窓から すぐ試せる。
              </p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** 達成の綴じ 1 枚（理解確認ずみ） */
function Slip({ item }: { item: RequirementItem }) {
  return (
    <li className="atlas-yk-slip atlas-px-cut">
      <span className="atlas-yk-slip__no">{slipNo(item.id)}</span>
      <p className="atlas-yk-slip__title">{item.title}</p>
      <p className="atlas-yk-slip__meta">
        {systemLabel(item.system ?? "other")}
      </p>
      <span className="atlas-yk-hanko atlas-px-cut">
        <span>達成</span>
      </span>
    </li>
  );
}

/** /requirements — ぼうけんしゃギルドの依頼掲示板（つぎのしれん候補／理解確認ずみ） */
export function AtlasRequirements({
  items,
  wsToken = null,
}: {
  items: RequirementItem[];
  wsToken?: string | null;
}) {
  const next = items.filter((i) => i.kind === "next");
  const understood = items.filter((i) => i.kind === "understood");
  const ready = next.filter((i) => i.nextGateId).length;

  return (
    <AtlasShell>
      <AtlasReveal as="section" className="atlas-win-px atlas-px-cut">
        <div className="atlas-yk-desk">
          <div className="flex items-start gap-4">
            <div className="atlas-talk__face">
              <PixelSprite name="sage" />
            </div>
            <p className="atlas-talk__body">
              ようこそ ギルドへ。いま 受けられる 依頼は <em>{next.length}まい</em>。
              <br />
              そのうち <em>{ready}まい</em> は しれんの支度が ととのっておる。
              <span className="atlas-cursor" />
            </p>
          </div>
          <div className="atlas-yk-counter">
            <div className="atlas-yk-counter__cell atlas-px-cut">
              <b>{next.length}</b>
              <span>うけられる</span>
            </div>
            <div className="atlas-yk-counter__cell atlas-px-cut">
              <b>{ready}</b>
              <span>しれんあり</span>
            </div>
            <div className="atlas-yk-counter__cell atlas-yk-counter__cell--done atlas-px-cut">
              <b>{understood.length}</b>
              <span>たっせい</span>
            </div>
          </div>
        </div>
      </AtlasReveal>

      <AtlasReveal
        as="section"
        delayIndex={1}
        className="atlas-yk-board atlas-px-cut"
      >
        <div className="atlas-yk-board__header">
          <h1 className="atlas-yk-board__title">とうばつ いらい</h1>
          <span className="atlas-yk-board__meta">
            まだ 理解が かたまっておらぬ 要件
          </span>
        </div>
        {next.length === 0 ? (
          <EmptyBoardGuide />
        ) : (
          <ul className="atlas-yk-grid">
            {next.map((item) => (
              <Fuda key={item.id} item={item} />
            ))}
          </ul>
        )}
        <div className="atlas-hint-band">
          <p>
            札の見かた: <span className="atlas-chip atlas-chip--open">しれんあり</span>{" "}
            すぐ挑める ／{" "}
            <span className="atlas-chip atlas-chip--draft">かきかけ</span>{" "}
            結びの承認まち ／{" "}
            <span className="atlas-chip atlas-chip--clear">たっせい</span>{" "}
            綴じへ移る
          </p>
        </div>
      </AtlasReveal>

      <AtlasReveal
        as="section"
        delayIndex={2}
        className="atlas-yk-ledger atlas-px-cut"
      >
        <h2 className="atlas-yk-ledger__title">
          たっせいの とじ
          <span>理解確認ずみ {understood.length} けん</span>
        </h2>
        {understood.length === 0 ? (
          <p className="atlas-yk-ledger__more">まだ 綴じた控えは ないぞ。</p>
        ) : (
          <ul className="atlas-yk-slips">
            {understood.map((item) => (
              <Slip key={item.id} item={item} />
            ))}
          </ul>
        )}
      </AtlasReveal>

      <AtlasReveal as="section" delayIndex={3}>
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent="requirements"
            context={`つぎのしれん ${next.length} / 理解確認ずみ ${understood.length}\n候補: ${next
              .slice(0, 5)
              .map((i) => `${i.id} ${i.title}`)
              .join("\n")}`}
            title="じゅもんでメテオフォールを進める"
            blurb="要件と理解の結びを、じゅもんで進めよ。"
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
        <p className="mt-2 mb-0 text-[11px] text-[#9a9470]">
          出典: ひさじゅ『メテオフォール開発』(Zenn, hisaju01)
        </p>
      </AtlasReveal>
    </AtlasShell>
  );
}
