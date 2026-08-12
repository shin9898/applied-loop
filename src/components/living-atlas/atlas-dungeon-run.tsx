import Link from "next/link";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasAssist, AtlasAssistUnavailable } from "./atlas-assist";
import { AtlasGateDeferActions } from "./atlas-gate-defer";
import {
  AtlasDungeonIcon,
  AtlasEnemySprite,
} from "./atlas-dungeon-sprites";
import { battleHref, type Dungeon, type DungeonFloor } from "./atlas-dungeons";

function fightLabel(floor: DungeonFloor): string {
  switch (floor.gate.status) {
    case "grading":
      return "結果を みる";
    case "grading_failed":
      return "復帰する";
    case "failed":
      return "もういちど たたかう";
    default:
      return "たたかう";
  }
}

function ClearFloor({ floor }: { floor: DungeonFloor }) {
  return (
    <div className="shr-clear">
      <AtlasDungeonIcon name="grave" width={24} />
      <div>
        <p className="shr-clear__title">{floor.gate.title}</p>
        <p className="shr-clear__meta">{floor.meta}</p>
      </div>
      <Link href={`/gates/${floor.gate.id}`} className="shr-clear__tag">
        たおした
      </Link>
    </div>
  );
}

function NowFloor({
  floor,
  system,
}: {
  floor: DungeonFloor;
  system: Dungeon["system"];
}) {
  return (
    <>
      {floor.boss ? (
        <span className="shr-boss">
          <AtlasDungeonIcon name="skull" width={12} />
          さいしんぶ ・ ぬし（再出題）
        </span>
      ) : null}
      <span className="shr-now">
        <AtlasDungeonIcon name="arrow-dark" width={8} />
        いま ここ
      </span>
      <div className="shr-battle">
        <div className="shr-stage">
          <AtlasEnemySprite
            def={floor.enemy}
            width={112}
            className="shr-bob"
            label={floor.enemy.name}
          />
        </div>
        <div>
          <p className="shr-mon">
            {floor.enemy.name.replace(/^つまずき：/, "")}
            {floor.boss ? " ・ ぬし" : ""}
          </p>
          {/* 道のりは見出しだけ。全文（問い・文脈・手がかり）はたたかう画面で出す */}
          <p className="shr-q">{floor.gate.title}</p>
          <p className="shr-q__meta">{floor.meta}</p>
          <div className="shr-acts">
            <Link
              href={battleHref(floor.gate.id, system)}
              className="dq-btn shr-curs"
            >
              {fightLabel(floor)}
              <AtlasDungeonIcon name="arrow-dark" width={8} className="ml-2" />
            </Link>
            {floor.gate.status === "pending" ? (
              <AtlasGateDeferActions gateId={floor.gate.id} mode="active" />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function LockedFloor({ floor }: { floor: DungeonFloor }) {
  return (
    <>
      {floor.boss ? (
        <>
          <div className="shr-door" aria-hidden />
          <span className="shr-boss">
            <AtlasDungeonIcon name="skull" width={12} />
            さいしんぶ ・ ぬし（再出題）
          </span>
        </>
      ) : null}
      <div className="shr-lock">
        <div className="shr-lock__sil">
          <AtlasEnemySprite
            def={floor.enemy}
            width={floor.boss ? 72 : 56}
            silhouette
          />
        </div>
        <div>
          <p className="shr-lock__title">
            {floor.boss ? "? ? ?（ぬし）" : "? ? ?"}
          </p>
          <p className="shr-lock__sub">
            {floor.boss
              ? "手前の まものを たおすと 道が ひらく"
              : "まだ 見えぬ。手前から 順に"}
          </p>
        </div>
      </div>
    </>
  );
}

/** /gates?d=<系統> — ダンジョンの中（縦の道のりで連続撃破） */
export function AtlasDungeonRun({
  dungeon,
  streakDays,
  wsToken = null,
}: {
  dungeon: Dungeon;
  streakDays?: number;
  wsToken?: string | null;
}) {
  const now = dungeon.nowFloor;
  const deepest = dungeon.floors[dungeon.floors.length - 1];
  return (
    <AtlasChrome active="/gates" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="shr">
          <div className="shr-dungeon">
            <div className="shr-dhead">
              <div className="shr-dhead__top">
                <h1 className="shr-dname">{dungeon.name}</h1>
                <span className="shr-dmeta">
                  系統：{dungeon.label}
                  {dungeon.placeLabel ? ` ／ ばしょ：${dungeon.placeLabel}` : ""}
                </span>
                <Link href="/gates" className="dq-btn dq-btn-ghost shr-dexit">
                  出る
                </Link>
              </div>
              <div className="shr-prog" aria-hidden>
                {dungeon.floors.map((f) => (
                  <i
                    key={f.gate.id}
                    className={
                      f.state === "clear"
                        ? "is-done"
                        : f.state === "now"
                          ? "is-now"
                          : ""
                    }
                  />
                ))}
              </div>
              <div className="shr-progline">
                <span>
                  撃破 {dungeon.cleared} / {dungeon.total}
                </span>
                <span>
                  {now ? `いま ${now.floorLabel}` : "すべて 撃破"}
                  {deepest ? ` ／ さいしんぶ ${deepest.floorLabel}` : ""}
                </span>
                <span>のこり {dungeon.remaining}体</span>
              </div>
            </div>

            <div className="shr-path">
              {dungeon.floors.map((f) => (
                <div
                  key={f.gate.id}
                  className={`shr-floor shr-floor--${f.state}${
                    f.boss ? " shr-floor--boss" : ""
                  }`}
                >
                  <div className="shr-rail">
                    <span className="shr-rail__fl">{f.floorLabel}</span>
                    <span className="shr-rail__dot" />
                  </div>
                  <div className="shr-card">
                    {f.state === "clear" ? (
                      <ClearFloor floor={f} />
                    ) : f.state === "now" ? (
                      <NowFloor floor={f} system={dungeon.system} />
                    ) : (
                      <LockedFloor floor={f} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="shr-dfoot">
              <p>
                {dungeon.remaining === 0
                  ? "この迷宮は しずまった。ちずへ もどって 次の いりぐちへ。"
                  : `のこり ${dungeon.remaining}体。ここを 空にすると この迷宮は しずまる。たおすたび 次のまものへ 続けて進めるぞ。`}
              </p>
              <Link href="/gates" className="dq-btn dq-btn-ghost">
                ダンジョンを 出る
              </Link>
              <Link href="/gates?view=list" className="dq-btn dq-btn-ghost">
                ぜんぶ一覧
              </Link>
            </div>
          </div>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={1}>
          {wsToken ? (
            <AtlasAssist
              wsToken={wsToken}
              intent="gates"
              context={`ダンジョン: ${dungeon.name}（系統 ${dungeon.label}）\nのこり ${dungeon.remaining}体${
                now ? `\nいま: ${now.gate.id} ${now.gate.title}` : ""
              }`}
              title="じゅもんでこの迷宮を片付ける"
              blurb="この系統のしれんをまとめて片付けるならじゅもん。1体ずつ潜るなら『たたかう』じゃ。"
            />
          ) : (
            <AtlasAssistUnavailable />
          )}
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
