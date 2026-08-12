"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AtlasPageTitle } from "./atlas-chrome";
import { AtlasNikkiShelf } from "./atlas-nikki-shelf";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";
import type { NikkiMonth } from "./nikki-months";
import { bulkGenerateDailyTextbooksAction } from "@/lib/actions";

export type UngeneratedDay = {
  dateKey: string;
  materialCount: number;
};

/** /retro — 本棚が最上段。本を開くと従来どおりめくり全画面 */
export function AtlasNikkiRetro({
  months,
  todayKey,
  materialCountToday,
  ungeneratedDays = [],
  regenerateAction,
}: {
  months: NikkiMonth[];
  todayKey: string;
  materialCountToday: number;
  /** 材料はあるのに教科書になっていない日 */
  ungeneratedDays?: UngeneratedDay[];
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

          {/* ★ 本棚が最上段。ここから月をえらぶのが主動線 */}
          <div className="atlas-nikki-shelf-slot">
            <AtlasNikkiShelf
              months={months}
              todayKey={todayKey}
              openMonth={openMonth}
              onOpenMonth={setOpenMonth}
            />
          </div>

          <div className="atlas-journal__divider" aria-hidden />

          {/* 本の中の体験は変えず、棚の下に導線だけ小さく添える */}
          <NikkiQuickRow
            todayKey={todayKey}
            materialCountToday={materialCountToday}
            ungeneratedDays={ungeneratedDays}
            regenerateAction={regenerateAction}
          />
        </div>
      </div>
    </main>
  );
}

function NikkiQuickRow({
  todayKey,
  materialCountToday,
  ungeneratedDays,
  regenerateAction,
}: {
  todayKey: string;
  materialCountToday: number;
  ungeneratedDays: UngeneratedDay[];
  regenerateAction: () => Promise<void>;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <div className="atlas-nikki-quick">
      <p className="atlas-nikki-quick__label">はやみち</p>
      <div className="atlas-nikki-quick__row">
        <Link
          href={`/retro/${todayKey}`}
          className="dq-btn !px-3 !py-2 text-[8px]"
        >
          きょうの日記へ
          <span className="atlas-nikki-quick__badge">
            材料 {materialCountToday}
          </span>
        </Link>
        {ungeneratedDays.length > 0 ? (
          <button
            type="button"
            className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
            aria-expanded={bulkOpen}
            onClick={() => setBulkOpen((v) => !v)}
          >
            未作成の日をまとめて教科書化
            <span className="atlas-nikki-quick__badge is-ghost">
              {ungeneratedDays.length}日
            </span>
          </button>
        ) : (
          <form action={regenerateAction}>
            <button
              type="submit"
              className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
            >
              きょうを手元で生成（LLMなし）
            </button>
          </form>
        )}
      </div>
      {ungeneratedDays.length === 0 ? (
        <p className="atlas-journal__note">
          材料のある日はすべて教科書になっておる。
        </p>
      ) : null}
      {/* 生成し切ると未作成日が消えるので、パネルごと畳む（空パネルを残さない） */}
      {bulkOpen && ungeneratedDays.length > 0 ? (
        <NikkiBulkPanel
          key={ungeneratedDays.map((d) => d.dateKey).join(",")}
          days={ungeneratedDays}
        />
      ) : null}
    </div>
  );
}

function NikkiBulkPanel({ days }: { days: UngeneratedDay[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(() =>
    days.map((d) => d.dateKey),
  );
  const [result, setResult] = useState<string | null>(null);
  const allOn = selected.length === days.length;

  function toggle(dateKey: string) {
    setSelected((prev) =>
      prev.includes(dateKey)
        ? prev.filter((k) => k !== dateKey)
        : [...prev, dateKey],
    );
  }

  return (
    <section className="atlas-nikki-bulk">
      <header className="atlas-nikki-bulk__head">
        <div>
          <p className="atlas-nikki-bulk__title">未作成の日をまとめて教科書化</p>
          <p className="atlas-nikki-bulk__sub">
            材料はあるのに、まだ章になっていない日 — {days.length}日ぶん
          </p>
        </div>
        <button
          type="button"
          className="dq-btn dq-btn-ghost !px-2 !py-1.5 text-[7px]"
          disabled={pending}
          onClick={() =>
            setSelected(allOn ? [] : days.map((d) => d.dateKey))
          }
        >
          {allOn ? "ぜんぶ解除" : "ぜんぶ選ぶ"}
        </button>
      </header>

      <ul className="atlas-nikki-bulk__list">
        {days.map((d) => {
          const on = selected.includes(d.dateKey);
          return (
            <li key={d.dateKey}>
              <label className={`atlas-nikki-bulk__row ${on ? "is-on" : ""}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={pending}
                  onChange={() => toggle(d.dateKey)}
                />
                <span className="atlas-nikki-bulk__box" aria-hidden />
                <span className="atlas-nikki-bulk__date">{d.dateKey}</span>
                <span className="atlas-nikki-bulk__mat">
                  材料 {d.materialCount} 件
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="atlas-nikki-bulk__foot">
        <button
          type="button"
          className="dq-btn !px-3 !py-2 text-[8px]"
          disabled={pending || selected.length === 0}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const res = await bulkGenerateDailyTextbooksAction(selected);
              setResult(
                res.failed.length > 0
                  ? `${res.done.length}日ぶん作成。${res.failed.length}日は失敗（材料なしかも）。`
                  : `${res.done.length}日ぶん、教科書にした。`,
              );
              router.refresh();
            });
          }}
        >
          {pending
            ? "教科書にしている…"
            : `えらんだ日を教科書化する（${selected.length}日）`}
        </button>
        <p className="atlas-nikki-bulk__caution">
          LLMなし・手元の規則だけで圧縮する。あとから章ごとに「LLMで磨く」を選べる。
        </p>
        {result ? (
          <p className="atlas-nikki-bulk__result">{result}</p>
        ) : null}
      </div>
    </section>
  );
}
