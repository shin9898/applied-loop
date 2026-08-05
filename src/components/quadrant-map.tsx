import type { QuadrantFlows } from "@/lib/quadrant";

type FlowKey =
  | "unknownUnknownDiscovery"
  | "knownUnknownToKnownKnown"
  | "unknownKnownToKnownKnown"
  | "knownKnownMaintenance";

const FLOWS: {
  key: FlowKey;
  label: string;
  /** SVG arrow path endpoints (from → to) in viewBox coords */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}[] = [
  {
    // 未知の未知への流入 (発見)
    key: "unknownUnknownDiscovery",
    label: "未知の未知の発見",
    x1: 140,
    y1: 390,
    x2: 140,
    y2: 365,
  },
  {
    // 知の未知 → 知の知 (左上→右上)
    key: "knownUnknownToKnownKnown",
    label: "知の未知 → 知の知",
    x1: 225,
    y1: 110,
    x2: 275,
    y2: 110,
  },
  {
    // 未知の知 → 知の知 (右下→右上)
    key: "unknownKnownToKnownKnown",
    label: "未知の知 → 知の知",
    x1: 360,
    y1: 215,
    x2: 360,
    y2: 185,
  },
  {
    // 知の知の維持 (右上でループ風の短い矢印)
    key: "knownKnownMaintenance",
    label: "知の知の維持",
    x1: 455,
    y1: 70,
    x2: 455,
    y2: 150,
  },
];

function activeColor(n: number): string {
  return n > 0 ? "#BC5B33" : "#B8AB90";
}

function boxFill(n: number): string {
  return n > 0 ? "#FBF8F0" : "#F4EEE2";
}

function boxStroke(n: number): string {
  return n > 0 ? "#BC5B33" : "#E3D9C4";
}

/**
 * 認知の4象限 — 週次フローを SVG で描画 (チャートライブラリ不使用)。
 * ゼロ件の遷移はグレーアウト。
 */
export function QuadrantMap({ flows }: { flows: QuadrantFlows }) {
  const uu = flows.unknownUnknownDiscovery;
  const ku = flows.knownUnknownToKnownKnown;
  const uk = flows.unknownKnownToKnownKnown;
  const kk = flows.knownKnownMaintenance;

  // 各象限ボックスの「活性」は関連フローの合計で判断
  const qUnknownUnknown = uu;
  const qKnownUnknown = uu + ku;
  const qUnknownKnown = uk;
  const qKnownKnown = ku + uk + kk;

  return (
    <div className="space-y-3">
      <svg
        viewBox="0 0 520 400"
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-label={`認知の4象限 ${flows.weekKey}`}
      >
        <defs>
          <marker
            id="arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#BC5B33" />
          </marker>
          <marker
            id="arrow-muted"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#B8AB90" />
          </marker>
        </defs>

        {/* 軸ラベル: X=知識の有無, Y=自覚の有無 */}
        <text x="140" y="24" textAnchor="middle" fill="#8A7C66" fontSize="11">
          知らない
        </text>
        <text x="360" y="24" textAnchor="middle" fill="#8A7C66" fontSize="11">
          知っている
        </text>
        <text
          x="18"
          y="110"
          textAnchor="middle"
          fill="#8A7C66"
          fontSize="10"
          transform="rotate(-90 18 110)"
        >
          自覚あり
        </text>
        <text
          x="18"
          y="290"
          textAnchor="middle"
          fill="#8A7C66"
          fontSize="10"
          transform="rotate(-90 18 290)"
        >
          自覚なし
        </text>

        {/* 左上=知の未知, 右上=知の知, 左下=未知の未知, 右下=未知の知 */}
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

        {/* 遷移矢印 */}
        {FLOWS.map((f) => {
          const n = flows[f.key];
          const active = n > 0;
          return (
            <g key={f.key} opacity={active ? 1 : 0.45}>
              <line
                x1={f.x1}
                y1={f.y1}
                x2={f.x2}
                y2={f.y2}
                stroke={activeColor(n)}
                strokeWidth={active ? 2.5 : 1.5}
                markerEnd={active ? "url(#arrow-active)" : "url(#arrow-muted)"}
              />
              <text
                x={(f.x1 + f.x2) / 2 + (f.x1 === f.x2 ? 14 : 0)}
                y={(f.y1 + f.y2) / 2 + (f.y1 === f.y2 ? -8 : 4)}
                fill={activeColor(n)}
                fontSize="12"
                fontWeight={active ? 700 : 400}
              >
                {n}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="grid gap-2 text-xs text-ink-secondary sm:grid-cols-2">
        {FLOWS.map((f) => {
          const n = flows[f.key];
          return (
            <li
              key={f.key}
              className={`rounded-md px-3 py-2 ${
                n > 0 ? "bg-accent-soft text-accent" : "bg-bg text-ink-faint"
              }`}
            >
              <span className="font-bold">{f.label}</span>
              <span className="ml-2">{n}件</span>
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
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={160}
        height={140}
        rx={10}
        fill={boxFill(count)}
        stroke={boxStroke(count)}
        strokeWidth={count > 0 ? 2 : 1}
      />
      <text x={x + 80} y={y + 36} textAnchor="middle" fill="#2E2418" fontSize="15" fontWeight="700">
        {title}
      </text>
      <text x={x + 80} y={y + 56} textAnchor="middle" fill="#8A7C66" fontSize="10">
        {subtitle}
      </text>
      <text
        x={x + 80}
        y={y + 96}
        textAnchor="middle"
        fill={count > 0 ? "#BC5B33" : "#B8AB90"}
        fontSize="28"
        fontWeight="700"
      >
        {count}
      </text>
      {detail && (
        <text x={x + 80} y={y + 118} textAnchor="middle" fill="#8A7C66" fontSize="10">
          {detail}
        </text>
      )}
    </g>
  );
}
