type Props = {
  /** マーク辺（px） */
  size?: number;
  /** 横並びワードマークを付ける */
  withWordmark?: boolean;
  /** 副題にシステム名 Applied Loop を出す */
  withSubtitle?: boolean;
  className?: string;
};

/**
 * DQ / Atlas 調のブランドロックアップ。
 * 表の名は「ぼうけんのしょ」。アセットは public/brand/mark.svg。
 */
export function AtlasBrandMark({
  size = 28,
  withWordmark = false,
  withSubtitle = false,
  className = "",
}: Props) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className}`.trim()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG ピクセルを pixelated で出す */}
      <img
        src="/brand/mark.svg"
        alt={withWordmark ? "" : "ぼうけんのしょ"}
        width={size}
        height={size}
        className="shrink-0"
        style={{ imageRendering: "pixelated" }}
        decoding="async"
      />
      {withWordmark ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] leading-none text-[#f0d25a] md:text-[11px]">
            ぼうけんのしょ
          </span>
          {withSubtitle ? (
            <span className="font-[family-name:var(--font-jp)] text-[11px] leading-tight text-[#9ec0ff]">
              Applied Loop
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
