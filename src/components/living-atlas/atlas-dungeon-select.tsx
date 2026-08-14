import Link from "next/link";
import { GATE_BACKLOG_CAP } from "@/lib/gate-limits";
import type { GatesSupplyState } from "@/lib/gates-supply";
import { AtlasShell } from "./atlas-shell";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasGateDeferActions } from "./atlas-gate-defer";
import { ENEMY_FOG } from "./atlas-enemies";
import {
  AtlasDungeonIcon,
  AtlasEnemySprite,
  AtlasTorch,
} from "./atlas-dungeon-sprites";
import { dungeonHref, type Dungeon } from "./atlas-dungeons";
import type { GateListItem } from "./atlas-gates-list";

/** いりぐち（れんが壁＋アーチの穴＋たいまつ＋主） */
function Doorway({
  dungeon,
  scale,
  sealed = false,
}: {
  dungeon: Dungeon;
  scale: number;
  sealed?: boolean;
}) {
  return (
    <span className="shr-doorway">
      {sealed ? null : (
        <>
          <AtlasTorch side="l" />
          <AtlasTorch side="r" />
        </>
      )}
      <span className="shr-hole" />
      <span className={`shr-monslot${sealed ? "" : " shr-bob"}`}>
        <AtlasEnemySprite
          def={dungeon.enemy}
          width={scale}
          silhouette={sealed}
        />
      </span>
      {sealed ? <span className="shr-sealband">せいふく ずみ</span> : null}
    </span>
  );
}

/** 残り／全体のめやすバー（1マス＝1体） */
function Meter({ dungeon }: { dungeon: Dungeon }) {
  const cells = dungeon.floors.slice(0, 12);
  return (
    <span className="shr-bar" aria-hidden>
      {cells.map((f) => (
        <i
          key={f.gate.id}
          className={f.state === "clear" ? "is-done" : "is-left"}
        />
      ))}
    </span>
  );
}

/** /gates — しれん（ダンジョンえらび）。一番光るのは「きょうの もぐりさき」1枚だけ */
export function AtlasDungeonSelect({
  dungeons,
  fogCount = 0,
  pendingBacklogCount = 0,
  parkedItems = [],
  wsToken = null,
  supply = null,
}: {
  dungeons: Dungeon[];
  /** ばしょ未特定（霧）の件数 */
  fogCount?: number;
  pendingBacklogCount?: number;
  parkedItems?: GateListItem[];
  wsToken?: string | null;
  supply?: GatesSupplyState | null;
}) {
  const open = dungeons.filter((d) => !d.sealed);
  const sealed = dungeons.filter((d) => d.sealed);
  const remainingTotal = open.reduce((n, d) => n + d.remaining, 0);
  const hero = open[0] ?? null;
  const others = hero ? [...open.slice(1), ...sealed] : sealed;
  const overCap = pendingBacklogCount >= GATE_BACKLOG_CAP;
  const firstGate = hero?.nowFloor?.gate ?? null;

  return (
    <AtlasShell>
      <AtlasReveal as="section">
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent="gates"
            context={`挑めるまもの ${remainingTotal} 体 / ひらいたダンジョン ${open.length}。霧 ${fogCount} 件。\n${
              firstGate
                ? `先頭候補: ${firstGate.id} ${firstGate.title}`
                : "未クリアなし"
            }`}
            title="じゅもんでしれんを片付ける"
            blurb="まとめて切り開くならじゅもん。1体ずつ潜るならダンジョンへ。"
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
      </AtlasReveal>

      <AtlasReveal as="section" className="dq-win p-3.5">
        <AtlasPageTitle
          title="しれん"
          sub={`ダンジョン ${open.length} / まもの ${remainingTotal} 体`}
        />
        <div className="shr-status">
          <span>いま挑める まもの</span>
          <b>{remainingTotal}</b>
          <span>ひらいた ダンジョン</span>
          <b>{open.length}</b>
          <span>せいふく ずみ</span>
          <b>{sealed.length}</b>
        </div>
        <p className="m-0 mt-2 text-[13px] leading-relaxed text-[#c9c3a0]">
          つまずきは系統ごとに巣くっておる。ひとつの迷宮にもぐって、そこのまものを続けてたおすのが近道じゃ。
          1体ずつ拾うでない。全文はたたかう画面か上のじゅもんで見よ。
        </p>
        {overCap ? (
          <div className="mt-3 border-[3px] border-[#f0a030] bg-[#2a1800] p-3">
            <p className="m-0 text-[13px] leading-relaxed text-[#f7f3d9]">
              pending が {pendingBacklogCount} 件（上限 {GATE_BACKLOG_CAP}
              ）。即時しれん生成は止まっておるが、材料は消えておらぬ。
              <Link href="/gates?view=list" className="text-[#9ec0ff]">
                ぜんぶの一覧
              </Link>
              で『あとまわし』『閉じる』を使い {GATE_BACKLOG_CAP}{" "}
              未満にすると再び生成できる。夜は{" "}
              <Link href="/retro" className="text-[#9ec0ff]">
                きょうのしょ
              </Link>
              へ。
            </p>
          </div>
        ) : null}
        <p className="m-0 mt-3 text-[12px] text-[#9a9470]">
          <Link href="/gates?view=list" className="text-[#9ec0ff]">
            ぜんぶを一覧で見る（あとまわし／閉じる）
          </Link>
        </p>
      </AtlasReveal>

      {dungeons.length === 0 ? (
        <AtlasReveal as="section" className="dq-win p-3.5">
          {supply && supply.kind !== "has_items" ? (
            <div className="grid gap-2">
              <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
                {supply.title}
              </p>
              <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
                {supply.body}
              </p>
              {supply.href && supply.cta ? (
                <Link href={supply.href} className="dq-btn w-fit">
                  {supply.cta}
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              しれんはすべてCLEARのようじゃ。
            </p>
          )}
        </AtlasReveal>
      ) : null}

      <AtlasReveal as="section" className="shr">
        {hero ? (
          <>
            <p className="shr-label">きょうの もぐりさき</p>
            <Link href={dungeonHref(hero.system)} className="shr-hero">
              <Doorway dungeon={hero} scale={88} />
              <span className="shr-hero__body">
                <span className="shr-kicker">
                  <AtlasDungeonIcon name="arrow-dark" width={8} />
                  いちばん 深い
                </span>
                <span className="shr-hero__name">{hero.name}</span>
                <span className="shr-flavor">
                  {hero.flavor} 未クリア {hero.remaining} 体
                  {hero.oldestDays !== null
                    ? `、最も古いつまずきは ${hero.oldestDays}日前のもの`
                    : ""}
                  。{hero.hasBoss ? "最下層には たおしたはずの ぬし が 戻っておる。" : ""}
                </span>
                <span className="shr-counts">
                  <span className="shr-counts__n">{hero.remaining}</span>
                  <span className="shr-counts__u">体 のこり</span>
                  <span className="shr-counts__all">
                    ぜんぶで {hero.total}体（{hero.cleared}体 撃破ずみ）
                  </span>
                </span>
                <Meter dungeon={hero} />
                <span className="shr-acts">
                  <span className="dq-btn">
                    ここへ もぐる
                    <AtlasDungeonIcon
                      name="arrow-dark"
                      width={8}
                      className="ml-2"
                    />
                  </span>
                </span>
              </span>
            </Link>
          </>
        ) : null}

        {others.length > 0 ? (
          <>
            <p className="shr-label">ほかの いりぐち</p>
            <div className="shr-gates">
              {others.map((d) =>
                d.sealed ? (
                  <div key={d.system} className="shr-gate shr-gate--sealed">
                    <Doorway dungeon={d} scale={64} sealed />
                    <span className="shr-gate__body">
                      <span className="shr-gate__name">{d.name}</span>
                      <span className="shr-gate__sub">系統：{d.label}</span>
                      <span className="shr-flavor">
                        灯は 消えた。また つまずけば 火が入る。
                      </span>
                      <span className="shr-counts">
                        <span className="shr-counts__n">0</span>
                        <span className="shr-counts__u">体 のこり</span>
                        <span className="shr-counts__all">全{d.total}</span>
                      </span>
                      <Meter dungeon={d} />
                    </span>
                  </div>
                ) : (
                  <Link
                    key={d.system}
                    href={dungeonHref(d.system)}
                    className="shr-gate"
                  >
                    <Doorway dungeon={d} scale={64} />
                    <span className="shr-gate__body">
                      <span className="shr-gate__name">{d.name}</span>
                      <span className="shr-gate__sub">
                        系統：{d.label}
                        {d.placeLabel ? ` ／ ${d.placeLabel}` : ""}
                      </span>
                      <span className="shr-flavor">{d.flavor}</span>
                      <span className="shr-counts">
                        <span className="shr-counts__n">{d.remaining}</span>
                        <span className="shr-counts__u">体 のこり</span>
                        <span className="shr-counts__all">全{d.total}</span>
                      </span>
                      <Meter dungeon={d} />
                      <span className="shr-acts">
                        <span className="dq-btn dq-btn-ghost">のぞく</span>
                      </span>
                    </span>
                  </Link>
                ),
              )}
            </div>
          </>
        ) : null}

        {fogCount > 0 ? (
          <div className="shr-fog">
            <AtlasEnemySprite def={ENEMY_FOG} width={64} />
            <p>
              <span className="shr-fog__t">
                もやの森 ― ばしょ 未特定 {fogCount}体
              </span>
              repo も domain も 分からぬまま さまよう しれんが {fogCount} 体。
              MCP の enrich_gate_places（または出題時の domain / repo）で ちずに
              のせると、それぞれの ダンジョンで ばしょが 見えるようになる。
            </p>
          </div>
        ) : null}
      </AtlasReveal>

      {parkedItems.length > 0 ? (
        <AtlasReveal as="section" className="dq-win p-3.5">
          <h2 className="dq-win-title mb-2">
            あとまわし（{parkedItems.length}）
          </h2>
          <p className="mb-3 text-[12px] text-[#c9c3a0]">
            pending から外してある。もどすと再び挑めるしれんになる。
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {parkedItems.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-[1fr_auto] items-start gap-3 border-t-2 border-[#002070] pt-2 first:border-t-0 first:pt-0"
              >
                <div>
                  <Link
                    href={`/gates/${item.id}`}
                    className="text-[14px] text-inherit no-underline hover:text-[#f0d25a]"
                  >
                    {item.title}
                  </Link>
                  <p className="m-0 mt-0.5 text-[11px] text-[#9a9470]">
                    あとまわし
                  </p>
                </div>
                <AtlasGateDeferActions gateId={item.id} mode="parked" />
              </li>
            ))}
          </ul>
        </AtlasReveal>
      ) : null}
    </AtlasShell>
  );
}
