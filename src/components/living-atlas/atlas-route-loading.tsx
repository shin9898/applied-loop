/**
 * ページ遷移中のロードUI（Issue #2）。
 * 領土テクスチャの帯を自キャラ（LPCスプライト）が足踏みし、帯の方が流れる。
 * ホームは hero（大きめ）、他ルートは compact（ページ上部の細い帯）。
 */
export function AtlasRouteLoading({
  variant = "compact",
  label = "よみこみちゅう",
}: {
  variant?: "hero" | "compact";
  label?: string;
}) {
  return (
    <div
      className={`atlas-route-loading atlas-route-loading--${variant}`}
      role="status"
      aria-live="polite"
    >
      <div className="atlas-route-loading__stage">
        <div className="atlas-route-loading__walker" />
      </div>
      <p className="atlas-route-loading__label">
        {variant === "hero" ? "せかいを " : ""}
        <span className="atlas-route-loading__gold">{label}</span> ……
      </p>
    </div>
  );
}
