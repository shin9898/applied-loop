import Image from "next/image";
import { NARRATION_PERSONA } from "@/lib/narration-persona";

/**
 * ルミナの会話ポートレート（中解像度画像埋め込み）。
 * ドット手描きは品質が届かないため、立ち絵アセットを優先。
 * 納得いかなければ肖像を外してプレースホルダに戻す。
 */
export function AtlasLuminaPortrait({
  size = 112,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/atlas/lumina-portrait.png"
      alt={`${NARRATION_PERSONA.name}（ナビ姫）`}
      width={size}
      height={size}
      className={`block object-cover object-top ${className}`.trim()}
      style={{ imageRendering: "auto", width: size, height: size }}
      priority={false}
    />
  );
}
