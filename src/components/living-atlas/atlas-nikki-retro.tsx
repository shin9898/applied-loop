"use client";

import Link from "next/link";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasNikkiShelf } from "./atlas-nikki-shelf";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";
import type { NikkiMonth } from "./nikki-months";
import { useState } from "react";

/** /retro — 日記UIに収めた本棚。本を開くとめくり全画面 */
export function AtlasNikkiRetro({
  months,
  todayKey,
  materialCountToday,
  regenerateAction,
}: {
  months: NikkiMonth[];
  todayKey: string;
  materialCountToday: number;
  regenerateAction: () => Promise<void>;
}) {
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const reading = Boolean(openMonth);

  if (reading) {
    return (
      <main className="mx-auto max-w-[min(1120px,98vw)] px-3 py-4 pb-28">
        <AtlasNikkiShelf
          months={months}
          todayKey={todayKey}
          openMonth={openMonth}
          onOpenMonth={setOpenMonth}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 pb-28">
      <AtlasPageTitle title="にっき" sub="月ごとのぼうけんにっき" />
      <div className="atlas-journal">
        <header className="atlas-journal__masthead">
          <AtlasSurfaceIcon surface="retro" size={28} color="#d8f0c8" />
          <div>
            <p className="atlas-journal__eyebrow">ぼうけんにっき</p>
            <h2 className="atlas-journal__heading">にっきのほんだな</h2>
          </div>
        </header>

        <div className="atlas-journal__page">
          <p className="atlas-journal__lead">
            月の本を手に取ると、1日ずつページをめくれる。書いた日は緑、空白はまだ眠っておる。
          </p>
          <p className="atlas-journal__meta">
            きょう（{todayKey}）の材料 · {materialCountToday} 件
          </p>
          <div className="atlas-journal__actions">
            <Link
              href={`/retro/${todayKey}`}
              className="dq-btn !px-3 !py-2 text-[8px]"
            >
              きょうを開く
            </Link>
            <form action={regenerateAction}>
              <button
                type="submit"
                className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
              >
                手元で生成（LLMなし）
              </button>
            </form>
          </div>

          <div className="atlas-journal__divider" aria-hidden />

          <AtlasNikkiShelf
            months={months}
            todayKey={todayKey}
            openMonth={openMonth}
            onOpenMonth={setOpenMonth}
          />
        </div>
      </div>
    </main>
  );
}
