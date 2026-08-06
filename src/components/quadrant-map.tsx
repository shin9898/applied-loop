import type { QuadrantFlows } from "@/lib/quadrant";

type FlowKey =
  | "unknownUnknownDiscovery"
  | "knownUnknownToKnownKnown"
  | "unknownKnownToKnownKnown"
  | "knownKnownMaintenance";

const FLOWS: {
  key: FlowKey;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}[] = [
  {
    key: "unknownUnknownDiscovery",
    label: "未知の未知の発見",
    x1: 140,
    y1: 390,
    x2: 140,
    y2: 365,
  },
  {
    key: "knownUnknownToKnownKnown",
    label: "知の未知 → 知の知",
    x1: 225,
    y1: 110,
    x2: 275,
    y2: 110,
  },
  {
    key: "unknownKnownToKnownKnown",
    label: "未知の知 → 知の知",
    x1: 360,
    y1: 215,
    x2: 360,
    y2: 185,
  },
  {
    key: "knownKnownMaintenance",
    label: "知の知の維持",
    x1: 455,
    y1: 70,
    x2: 455,
    y2: 150,
  },
];

const C = {
  navy: "#000c4a",
  navyDeep: "#001a8c",
  cream: "#f7f3d9",
  muted: "#c9c3a0",
  gold: "#f0d25a",
  blue: "#9ec0ff",
  dim: "#5a6a9a",
  white: "#ffffff",
  black: "#000000",
} as const;

function stroke(n: number): string {
  return n > 0 ? C.gold : C.dim;
}

function countFill(n: number): string {
  return n > 0 ? C.gold : C.dim;
}

/**
 * 認知の4象限 — Living Atlas / DQ ウィンドウ色で描画。
 * ゼロ件の遷移は暗くする。
 */
export function QuadrantMap({ flows }: { flows: QuadrantFlows }) {
  const uu = flows.unknownUnknownDiscovery;
  const ku = flows.knownUnknownToKnownKnown;
  const uk = flows.unknownKnownToKnownKnown;
  const kk = flows.knownKnownMaintenance;

  const qUnknownUnknown = uu;
  const qKnownUnknown = uu + ku;
  const qUnknownKnown = uk;
  const qKnownKnown = ku + uk + kk;

  return (
    <div className="grid gap-3">
      <svg
        viewBox="0 0 520 400"
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-label={`認知の4象限 ${flows.weekKey}`}
      >
        <defs>
          <marker
            id="dq-arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={C.gold} />
          </marker>
          <marker
            id="dq-arrow-muted"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={C.dim} />
          </marker>
        </defs>

        <rect x="0" y="0" width="520" height="400" fill={C.navyDeep} />

        <text
          x="140"
          y="22"
          textAnchor="middle"
          fill={C.blue}
          fontSize="11"
          fontFamily="var(--font-pixel), monospace"
        >
          知らない
        </text>
        <text
          x="360"
          y="22"
          textAnchor="middle"
          fill={C.blue}
          fontSize="11"
          fontFamily="var(--font-pixel), monospace"
        >
          知っている
        </text>
        <text
          x="16"
          y="110"
          textAnchor="middle"
          fill={C.blue}
          fontSize="10"
          fontFamily="var(--font-pixel), monospace"
          transform="rotate(-90 16 110)"
        >
          自覚あり
        </text>
        <text
          x="16"
          y="290"
          textAnchor="middle"
          fill={C.blue}
          fontSize="10"
          fontFamily="var(--font-pixel), monospace"
          transform="rotate(-90 16 290)"
        >
          自覚なし
        </text>

        <QuadrantBox
          x={60}
          y={40}
          title="知の未知"
          subtitle="分かっていない自覚"
          count={qKnownUnknown}
          detail={ku > 0 ? `解消へ ${ku}` : undefined}
        />
        <QuadrantBox
          x={280}
          y={40}
          title="知の知"
          subtitle="理解して使える"
          count={qKnownKnown}
          detail={kk > 0 ? `維持 ${kk}` : undefined}
        />
        <QuadrantBox
          x={60}
          y={220}
          title="未知の未知"
          subtitle="盲点の発見"
          count={qUnknownUnknown}
          detail={uu > 0 ? `発見 ${uu}` : undefined}
        />
        <QuadrantBox
          x={280}
          y={220}
          title="未知の知"
          subtitle="できている自覚なし"
          count={qUnknownKnown}
          detail={uk > 0 ? `調べて合格 ${uk}` : undefined}
        />

        {FLOWS.map((f) => {
          const n = flows[f.key];
          const active = n > 0;
          return (
            <g key={f.key} opacity={active ? 1 : 0.4}>
              <line
                x1={f.x1}
                y1={f.y1}
                x2={f.x2}
                y2={f.y2}
                stroke={active ? C.gold : C.dim}
                strokeWidth={active ? 3 : 2}
                markerEnd={
                  active ? "url(#dq-arrow-active)" : "url(#dq-arrow-muted)"
                }
              />
              <text
                x={(f.x1 + f.x2) / 2 + (f.x1 === f.x2 ? 14 : 0)}
                y={(f.y1 + f.y2) / 2 + (f.y1 === f.y2 ? -8 : 4)}
                fill={active ? C.gold : C.dim}
                fontSize="13"
                fontFamily="var(--font-pixel), monospace"
              >
                {n}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {FLOWS.map((f) => {
          const n = flows[f.key];
          return (
            <li
              key={f.key}
              className={`border-[3px] px-3 py-2 text-[12px] ${
                n > 0
                  ? "border-[#f0d25a] bg-[#000c4a] text-[#f7f3d9]"
                  : "border-[#002070] bg-[#000c4a] text-[#c9c3a0]"
              }`}
            >
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a]">
                {f.label}
              </span>
              <span className="ml-2">{n} 件</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuadrantBox({
  x,
  y,
  title,
  subtitle,
  count,
  detail,
}: {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  count: number;
  detail?: string;
}) {
  const active = count > 0;
  return (
    <g>
      {/* 白ふちの二重枠（DQ ウィンドウ） */}
      <rect
        x={x}
        y={y}
        width={160}
        height={140}
        fill={C.black}
        stroke={C.white}
        strokeWidth={3}
      />
      <rect
        x={x + 4}
        y={y + 4}
        width={152}
        height={132}
        fill={C.navy}
        stroke={stroke(count)}
        strokeWidth={active ? 2 : 1}
      />
      <text
        x={x + 80}
        y={y + 36}
        textAnchor="middle"
        fill={C.cream}
        fontSize="14"
        fontFamily="var(--font-pixel), monospace"
      >
        {title}
      </text>
      <text
        x={x + 80}
        y={y + 56}
        textAnchor="middle"
        fill={C.muted}
        fontSize="10"
      >
        {subtitle}
      </text>
      <text
        x={x + 80}
        y={y + 98}
        textAnchor="middle"
        fill={countFill(count)}
        fontSize="28"
        fontFamily="var(--font-pixel), monospace"
      >
        {count}
      </text>
      {detail ? (
        <text
          x={x + 80}
          y={y + 120}
          textAnchor="middle"
          fill={C.blue}
          fontSize="10"
        >
          {detail}
        </text>
      ) : null}
    </g>
  );
}
