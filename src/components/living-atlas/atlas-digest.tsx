import Link from "next/link";
import {
  extractNarrationLines,
  NARRATION_PERSONA,
} from "@/lib/narration-persona";
import { AtlasShell } from "./atlas-shell";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasLuminaPortrait } from "./atlas-lumina-portrait";

export type DigestFile = {
  weekKey: string;
  fileName: string;
};

/** /digest — ルミナの週次ダイジェスト（DQ セリフ窓＋会話ポートレート） */
export function AtlasDigest({
  weekKey,
  body,
  siblings = [],
  streakDays,
}: {
  weekKey: string | null;
  body: string | null;
  siblings?: DigestFile[];
  streakDays?: number;
}) {
  const lines = body ? extractNarrationLines(body) : [];
  const name = NARRATION_PERSONA.name;

  return (
    <AtlasChrome active="/entries" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <div className="grid grid-cols-[auto_1fr] items-start gap-4">
            <div className="shrink-0 border-[3px] border-white bg-[#001a8c] p-1 shadow-[4px_4px_0_#000]">
              <AtlasLuminaPortrait size={120} />
            </div>
            <div>
              <AtlasPageTitle
                title="週次の語り"
                sub={weekKey ? `${weekKey} · ${name}` : "まだ原稿なし"}
              />
              <p className="mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                ナビ姫「{name}」が、先週のちずの進みを語る。音声化は外出しのまま。
              </p>
              {siblings.length > 1 ? (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                  {siblings.slice(0, 5).map((f) => (
                    <li
                      key={f.fileName}
                      className={`font-[family-name:var(--font-pixel)] text-[8px] ${
                        f.weekKey === weekKey
                          ? "text-[#f0d25a]"
                          : "text-[#9a9470]"
                      }`}
                    >
                      {f.weekKey}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </AtlasReveal>

        {lines.length > 0 ? (
          <div className="grid gap-3">
            {lines.map((text, i) => (
              <AtlasReveal
                key={`${i}-${text.slice(0, 12)}`}
                as="section"
                className="dq-win p-3.5"
                delayIndex={Math.min(i, 4)}
              >
                <div className="mb-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a]">
                  ◆ {name}
                </div>
                <p className="m-0 text-[15px] leading-relaxed text-[#f7f3d9]">
                  {text}
                </p>
              </AtlasReveal>
            ))}
          </div>
        ) : (
          <AtlasReveal as="section" className="dq-win p-3.5">
            <p className="m-0 text-[14px] text-[#c9c3a0]">
              原稿がまだ無い。月曜に朝の要約を呼ぶと、{name}
              の語りがここに届くぞ。
            </p>
          </AtlasReveal>
        )}

        <AtlasReveal as="section" className="pt-1">
          <Link
            href="/entries"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline"
          >
            ← うけばこにもどる
          </Link>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
