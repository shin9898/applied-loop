/**
 * ドット絵スプライト。
 *
 * 画像・アイコンフォントは持ち込まず、`box-shadow` を並べたセル（4〜8px）だけで描く。
 * 実体は atlas-living.css の `.atlas-px-*`。色は currentColor 追従なので、
 * 状態（げんき / そわそわ / しょんぼり / ねむり）は親の class で塗り替える。
 */
export type AtlasSpriteName =
  | "pet-happy"
  | "pet-restless"
  | "pet-weak"
  | "pet-sleep"
  | "emblem"
  | "heart"
  | "bed"
  | "foot"
  | "box"
  | "forge"
  | "book"
  | "sage"
  | "dia-s"
  | "dia-m"
  | "core"
  | "ring"
  | "ring2"
  | "nail";

export function PixelSprite({
  name,
  className = "",
}: {
  name: AtlasSpriteName;
  className?: string;
}) {
  return (
    <span
      className={`atlas-dot atlas-dot--${name} ${className}`.trim()}
      aria-hidden="true"
    >
      <i className={`atlas-px-${name}`} />
    </span>
  );
}
