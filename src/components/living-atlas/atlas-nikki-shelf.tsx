"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";
import type { NikkiDay, NikkiMonth } from "./nikki-months";

export type { NikkiDay, NikkiMonth } from "./nikki-months";
export { groupNikkiMonths } from "./nikki-months";

type PageFlipInstance = {
  loadFromHTML: (els: HTMLElement[] | NodeListOf<Element>) => void;
  flipNext: (corner?: "top" | "bottom") => void;
  flipPrev: (corner?: "top" | "bottom") => void;
  flip: (page: number, corner?: "top" | "bottom") => void;
  turnToPage: (page: number) => void;
  update: () => void;
  destroy: () => void;
  getCurrentPageIndex: () => number;
  getPageCount: () => number;
  on: (
    event: string,
    cb: (e: { data: number | string | Record<string, unknown> }) => void,
  ) => PageFlipInstance;
  off: (event: string) => void;
};

type DayPage = {
  dateKey: string;
  day: number;
  entry: NikkiDay | null;
};

function dayNum(dateKey: string): number {
  const n = Number(dateKey.slice(8, 10));
  return Number.isFinite(n) ? n : 0;
}

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function padDateKey(monthKey: string, day: number): string {
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}

/** 月ごとの本棚 → 選択後に日めくり本（ずかんと同じ PageFlip） */
export function AtlasNikkiShelf({
  months,
  todayKey,
  openMonth: openMonthProp,
  onOpenMonth,
}: {
  months: NikkiMonth[];
  todayKey: string;
  openMonth?: string | null;
  onOpenMonth?: (monthKey: string | null) => void;
}) {
  const [openMonthLocal, setOpenMonthLocal] = useState<string | null>(null);
  const openMonth = openMonthProp !== undefined ? openMonthProp : openMonthLocal;
  const setOpenMonth = onOpenMonth ?? setOpenMonthLocal;
  const month = months.find((m) => m.monthKey === openMonth) ?? null;

  if (month) {
    return (
      <AtlasNikkiBook
        month={month}
        todayKey={todayKey}
        onBack={() => setOpenMonth(null)}
      />
    );
  }

  return (
    <div className="atlas-nikki-shelf">
      <p className="atlas-nikki-shelf__hint">
        月の本を手に取ると、日付ページをめくれるぞ。
      </p>
      {months.length === 0 ? (
        <p className="atlas-nikki-shelf__empty">
          まだ日記の本がない。材料がある日に「手元で生成」せよ。
        </p>
      ) : (
        <div className="atlas-nikki-shelf__case" aria-label="月ごとの本棚">
          <ul className="atlas-nikki-shelf__grid">
            {months.map((m) => (
              <li key={m.monthKey}>
                <button
                  type="button"
                  className="atlas-nikki-book-spine"
                  onClick={() => setOpenMonth(m.monthKey)}
                >
                  <span className="atlas-nikki-book-spine__band" aria-hidden />
                  <AtlasSurfaceIcon surface="retro" size={22} color="#f0d25a" />
                  <span className="atlas-nikki-book-spine__title">{m.label}</span>
                  <span className="atlas-nikki-book-spine__meta">
                    {m.days.length} 日ぶん
                  </span>
                  <span className="atlas-nikki-book-spine__cta">ひらく</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="atlas-nikki-shelf__plank" aria-hidden />
        </div>
      )}
    </div>
  );
}

/**
 * めくった先の日ページ本文。まず「この日のぼうけん」で大枠（全章に触れる）を見せ、
 * そのあと章カードで個別の詳細に触れる。ページは固定寸法なので、
 * 章カードは 2 つまで・要約は clamp して紙面から溢れさせない
 * （大枠は overview 側ですでに全章を拾っているので、カード側を削っても取りこぼしにならない）。
 */
const DAY_PAGE_MAX_CHAPTERS = 2;

function DayPageChapters({ entry }: { entry: NikkiDay }) {
  const chapters = entry.chapters ?? [];
  if (chapters.length > 0) {
    const shown = chapters.slice(0, DAY_PAGE_MAX_CHAPTERS);
    const rest = entry.chapterCount - shown.length;
    return (
      <>
        {entry.overview ? (
          <p className="atlas-nikki-day-page__overview">{entry.overview}</p>
        ) : null}
        <div className="atlas-nikki-day-page__chapters">
          {shown.map((c) => (
            <section key={c.index} className="atlas-nikki-day-chapter">
              <p className="atlas-nikki-day-chapter__head">
                <span className="atlas-nikki-day-chapter__no">第{c.index}章</span>
                <span className="atlas-nikki-day-chapter__title">{c.title}</span>
              </p>
              <p className="atlas-nikki-day-chapter__did">{c.summary}</p>
            </section>
          ))}
          {rest > 0 ? (
            <p className="atlas-nikki-day-chapter__rest">ほか {rest} 章</p>
          ) : null}
        </div>
      </>
    );
  }

  if (entry.lines && entry.lines.length > 0) {
    return (
      <ul className="atlas-nikki-day-page__lines">
        {entry.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
  }

  return entry.lead ? (
    <p className="atlas-nikki-day-page__lead">{entry.lead}</p>
  ) : null;
}

function AtlasNikkiBook({
  month,
  todayKey,
  onBack,
}: {
  month: NikkiMonth;
  todayKey: string;
  onBack: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlipInstance | null>(null);
  const openedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [coverCentered, setCoverCentered] = useState(true);

  const byDay = useMemo(() => {
    const map = new Map<number, NikkiDay>();
    for (const d of month.days) map.set(dayNum(d.dateKey), d);
    return map;
  }, [month.days]);

  const dayPages = useMemo((): DayPage[] => {
    const total = daysInMonth(month.monthKey);
    return Array.from({ length: total }, (_, i) => {
      const day = i + 1;
      return {
        day,
        dateKey: padDateKey(month.monthKey, day),
        entry: byDay.get(day) ?? null,
      };
    });
  }, [month.monthKey, byDay]);

  const needsEndpaper = dayPages.length % 2 === 1;
  const bookKey = month.monthKey;
  const writtenCount = month.days.length;

  useEffect(() => {
    let cancelled = false;
    let openTimer = 0;
    openedRef.current = false;
    setReady(false);
    setPageIndex(0);
    setPageCount(0);
    setCoverCentered(true);
    if (!hostRef.current) return;
    let ro: ResizeObserver | null = null;

    (async () => {
      const { PageFlip } = await import("page-flip");
      if (cancelled || !hostRef.current) return;
      const pages = Array.from(
        hostRef.current.querySelectorAll<HTMLElement>("[data-nikki-page]"),
      );
      if (!pages.length) return;

      const pf = new PageFlip(hostRef.current, {
        width: 480,
        height: 640,
        size: "stretch",
        minWidth: 300,
        maxWidth: 980,
        minHeight: 420,
        maxHeight: 960,
        showCover: true,
        drawShadow: true,
        flippingTime: 700,
        usePortrait: true,
        autoSize: true,
        maxShadowOpacity: 0.45,
        startPage: 0,
        clickEventForward: true,
        mobileScrollSupport: true,
        useMouseEvents: true,
        disableFlipByClick: true,
      }) as unknown as PageFlipInstance;

      pf.loadFromHTML(pages);
      flipRef.current = pf;
      setPageCount(pf.getPageCount());
      // init が遅れても操作不能にしない
      setReady(true);

      const onResize = () => {
        try {
          pf.update();
        } catch {
          /* ignore */
        }
      };
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(onResize);
        ro.observe(hostRef.current.parentElement ?? hostRef.current);
      }

      pf.on("flip", (e) => {
        if (typeof e.data !== "number") return;
        setPageIndex(e.data);
        setCoverCentered(e.data === 0);
      });
      pf.on("changeState", (e) => {
        const state = e.data;
        setFlipping(state === "flipping" || state === "user_fold");
        if (state === "flipping") setCoverCentered(false);
      });
      pf.on("init", () => {
        if (cancelled) return;
        setReady(true);
        setPageCount(pf.getPageCount());
        requestAnimationFrame(() => {
          try {
            pf.update();
          } catch {
            /* ignore */
          }
        });
        const reduce =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
          pf.turnToPage(1);
          openedRef.current = true;
          setCoverCentered(false);
          return;
        }
        openTimer = window.setTimeout(() => {
          if (cancelled || openedRef.current) return;
          openedRef.current = true;
          setCoverCentered(false);
          pf.flipNext("top");
        }, 720);
      });
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(openTimer);
      ro?.disconnect();
      const pf = flipRef.current;
      flipRef.current = null;
      try {
        pf?.off("flip");
        pf?.off("changeState");
        pf?.off("init");
        pf?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [bookKey]);

  const showRedCase =
    ready &&
    !flipping &&
    !coverCentered &&
    pageIndex > 0 &&
    pageIndex < Math.max(1, pageCount - 1);

  function go(dir: "next" | "prev") {
    const pf = flipRef.current;
    if (!pf || flipping) return;
    if (dir === "next") pf.flipNext("top");
    else pf.flipPrev("top");
  }

  /** カレンダー日付 → 日ページ（表紙の次が day=1） */
  function goDay(day: number) {
    const pf = flipRef.current;
    if (!pf || !ready || flipping) return;
    const page = day; // cover=0, day1=1, …
    const cur = pf.getCurrentPageIndex();
    if (cur === page) return;
    if (Math.abs(page - cur) > 2) {
      pf.turnToPage(page);
      setPageIndex(page);
      setCoverCentered(page === 0);
      return;
    }
    pf.flip(page, "top");
  }

  const currentDay =
    pageIndex > 0 && pageIndex <= dayPages.length
      ? dayPages[pageIndex - 1]
      : null;
  const canPrev = ready && pageIndex > 0;
  const canNext = ready && pageCount > 1 && pageIndex < pageCount - 1;

  return (
    <div className="atlas-zukan-flip atlas-nikki-flip">
      <header className="atlas-zukan-flip__chrome">
        <div className="atlas-zukan-flip__brand">
          <AtlasSurfaceIcon surface="retro" size={20} />
          <div>
            <p className="atlas-zukan-flip__title">{month.label}</p>
            <p className="atlas-zukan-flip__sub">
              ぼうけんにっき · 書いた日 {writtenCount}/{dayPages.length}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="atlas-zukan-pager__btn"
          onClick={onBack}
        >
          本棚へ
        </button>
      </header>

      <p className="atlas-zukan-flip__hint atlas-nikki-flip__hint">
        {ready
          ? "角・ボタンで日付をめくれる。書いた日は緑、空白はまだ眠っておる"
          : "にっきをひらいている…"}
      </p>

      <div
        className={`atlas-zukan-flip__stage atlas-nikki-flip__stage ${
          showRedCase ? "is-open-spread" : "is-hard-cover"
        }`}
        aria-busy={!ready}
      >
        <div
          key={bookKey}
          className={`atlas-zukan-flip__mount ${
            coverCentered ? "is-showing-cover" : "is-showing-spread"
          }`}
        >
          <div ref={hostRef} className="atlas-zukan-flip__book">
            <div
              className="atlas-zukan-flip-page atlas-zukan-flip-page--cover atlas-nikki-cover"
              data-nikki-page
              data-density="hard"
            >
              <div className="atlas-zukan-cover-face atlas-nikki-cover-face">
                <AtlasSurfaceIcon surface="retro" size={36} color="#d8f0c8" />
                <p className="atlas-zukan-cover-face__title">{month.label}</p>
                <p className="atlas-zukan-cover-face__sub">ぼうけんにっき</p>
                <div className="atlas-nikki-calendar" aria-label="日付ジャンプ">
                  {dayPages.map((d) => (
                    <button
                      key={d.dateKey}
                      type="button"
                      className={`atlas-nikki-calendar__day ${
                        d.entry ? "has-entry" : ""
                      } ${d.dateKey === todayKey ? "is-today" : ""}`}
                      disabled={!ready || flipping}
                      onClick={() => goDay(d.day)}
                    >
                      {d.day}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {dayPages.map((d) => (
              <div
                key={d.dateKey}
                className="atlas-zukan-flip-page atlas-nikki-paper"
                data-nikki-page
              >
                <div
                  className={`atlas-nikki-day-page ${
                    d.entry ? "" : "is-blank"
                  }`}
                >
                  <p className="atlas-nikki-day-page__date">{d.dateKey}</p>
                  <p className="atlas-nikki-day-page__title">
                    {d.dateKey === todayKey
                      ? "きょうのしょ"
                      : d.entry
                        ? (d.entry.title ?? "この日のしょ")
                        : "空白のページ"}
                  </p>
                  {d.entry ? (
                    <>
                      <DayPageChapters entry={d.entry} />
                      <p className="atlas-nikki-day-page__meta">
                        材料 {d.entry.materialCount} · 章 {d.entry.chapterCount}
                      </p>
                      <Link
                        href={`/retro/${d.dateKey}`}
                        className="dq-btn atlas-nikki-day-page__open !text-[9px]"
                      >
                        くわしくひらく
                      </Link>
                    </>
                  ) : (
                    <p className="atlas-nikki-day-page__blank">
                      まだ書いていない日じゃ。材料があれば「手元で生成」せよ。
                    </p>
                  )}
                </div>
              </div>
            ))}

            {needsEndpaper ? (
              <div
                className="atlas-zukan-flip-page atlas-zukan-flip-page--paper atlas-zukan-flip-page--endpaper"
                data-nikki-page
              >
                <div className="atlas-zukan-flip-page__endpaper">
                  <p>月末の余白。つづきの冒険を待て…</p>
                </div>
              </div>
            ) : null}

            <div
              className="atlas-zukan-flip-page atlas-zukan-flip-page--back atlas-nikki-cover"
              data-nikki-page
              data-density="hard"
            >
              <p className="atlas-zukan-flip-page__back-title">{month.label}</p>
              <p className="atlas-zukan-flip-page__back-sub">ぼうけんにっき</p>
            </div>
          </div>
        </div>
      </div>

      <nav className="atlas-zukan-pager" aria-label="にっきページ送り">
        <button
          type="button"
          className="atlas-zukan-pager__btn"
          disabled={!canPrev || flipping}
          onClick={() => go("prev")}
        >
          ◀ まえ
        </button>
        <span className="atlas-zukan-pager__status">
          {!ready
            ? "—"
            : pageIndex === 0
              ? "表紙"
              : pageIndex >= pageCount - 1
                ? "うら表紙"
                : (currentDay?.dateKey ?? "—")}
        </span>
        <button
          type="button"
          className="atlas-zukan-pager__btn"
          disabled={!canNext || flipping}
          onClick={() => go("next")}
        >
          つぎ ▶
        </button>
      </nav>
    </div>
  );
}
