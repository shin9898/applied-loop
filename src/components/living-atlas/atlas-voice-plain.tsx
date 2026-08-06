/** 天の声＋「つまり」手引の二層コピー */
export function AtlasVoicePlain({
  voice,
  plain,
  className = "",
}: {
  voice: string;
  plain: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">{voice}</p>
      <p className="mt-1.5 mb-0 border-l-[3px] border-[#9ec0ff] pl-2 text-[12px] leading-relaxed text-[#f7f3d9]">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          つまり{" "}
        </span>
        {plain}
      </p>
    </div>
  );
}
