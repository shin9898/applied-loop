"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isUnknownPlace,
  placeFrom,
  systemLabel,
  type SystemKind,
} from "@/lib/atlas-taxonomy";
import type { ZukanItem } from "./atlas-zukan";
import { AtlasZukanSampleSprite } from "./atlas-zukan-sample";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";

const PAGE_SIZE = 6;

const SYSTEM_ORDER: SystemKind[] = [
  "cache",
  "harness",
  "design",
  "ops",
  "knowledge",
  "verification",
  "premise",
  "other",
];

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

type Numbered = { item: ZukanItem; no: number };
type Slot = Numbered | null;

type Sheet =
  | {
      kind: "pocket";
      key: string;
      system: SystemKind;
      label: string;
      slots: Slot[];
      pageInCat: number;
      pagesInCat: number;
      count: number;
    }
  | { kind: "empty"; key: string };

type CategoryNav = {
  system: SystemKind;
  label: string;
  startPage: number;
  count: number;
};

function statusMeta(item: ZukanItem): {
  label: string;
  tone: "clear" | "open" | "fog";
} {
  const fogPlace = isUnknownPlace(placeFrom(item.repo, item.domain));
  if (item.status === "clear") return { label: "CLEAR", tone: "clear" };
  if (fogPlace || item.status === "fog") return { label: "霧", tone: "fog" };
  return { label: "未CLEAR", tone: "open" };
}

function padNo(n: number): string {
  return `No.${String(n).padStart(3, "0")}`;
}

function padSlots(slice: Numbered[]): Slot[] {
  const slots: Slot[] = [...slice];
  while (slots.length < PAGE_SIZE) slots.push(null);
  return slots;
}

function buildCategoryBook(items: ZukanItem[]): {
  sheets: Sheet[];
  categories: CategoryNav[];
} {
  if (items.length === 0) {
    return { sheets: [{ kind: "empty", key: "empty" }], categories: [] };
  }

  const numbered = items.map((item, i) => ({ item, no: i + 1 }));
  const bySystem = new Map<SystemKind, Numbered[]>();
  for (const row of numbered) {
    const s = row.item.system ?? "other";
    const list = bySystem.get(s);
    if (list) list.push(row);
    else bySystem.set(s, [row]);
  }

  const sheets: Sheet[] = [];
  const categories: CategoryNav[] = [];

  for (const system of SYSTEM_ORDER) {
    const group = bySystem.get(system);
    if (!group?.length) continue;
    const label = systemLabel(system);
    const startPage = sheets.length + 1;
    categories.push({
      system,
      label,
      startPage,
      count: group.length,
    });
    const pagesInCat = Math.max(1, Math.ceil(group.length / PAGE_SIZE));
    for (let p = 0; p < pagesInCat; p++) {
      sheets.push({
        kind: "pocket",
        key: `pocket-${system}-${p}`,
        system,
        label,
        slots: padSlots(group.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE)),
        pageInCat: p + 1,
        pagesInCat,
        count: group.length,
      });
    }
  }

  return { sheets, categories };
}

type Props = {
  items: ZukanItem[];
  openCount: number;
};

/** ずかん本体。系統カテゴリは上部タブ＋ページ見出し、両ページともポケット。 */
export function AtlasZukanDex({ items, openCount }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlipInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [coverCentered, setCoverCentered] = useState(true);
  const openedRef = useRef(false);

  const { sheets, categories } = useMemo(
    () => buildCategoryBook(items),
    [items],
  );
  const needsEndpaper = sheets.length % 2 === 1;
  const bookKey = useMemo(
    () =>
      `${items.length}:${items.map((i) => `${i.id}:${i.system ?? "other"}`).join(",")}`,
    [items],
  );

  const activeCategory = useMemo(() => {
    if (pageIndex <= 0 || pageIndex >= pageCount - 1) return null;
    let current: CategoryNav | null = null;
    for (const c of categories) {
      if (pageIndex >= c.startPage) current = c;
      else break;
    }
    return current;
  }, [categories, pageIndex, pageCount]);

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
        hostRef.current.querySelectorAll<HTMLElement>("[data-zukan-page]"),
      );
      if (pages.length === 0) return;

      const pf = new PageFlip(hostRef.current, {
        width: 400,
        height: 560,
        size: "stretch",
        minWidth: 280,
        maxWidth: 720,
        minHeight: 360,
        maxHeight: 900,
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
      if (!pf) return;
      try {
        pf.off("flip");
        pf.off("changeState");
        pf.off("init");
        pf.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [bookKey]);

  const canPrev = pageIndex > 0;
  const canNext = pageCount > 0 && pageIndex < pageCount - 1;
  const showRedCase =
    ready &&
    !flipping &&
    pageCount > 0 &&
    pageIndex > 0 &&
    pageIndex < pageCount - 1;

  function go(dir: "next" | "prev") {
    const pf = flipRef.current;
    if (!pf || flipping) return;
    if (dir === "next") pf.flipNext("top");
    else pf.flipPrev("top");
  }

  function goCategory(startPage: number) {
    const pf = flipRef.current;
    if (!pf || flipping || !ready) return;
    const cur = pf.getCurrentPageIndex();
    if (cur === startPage) return;
    setCoverCentered(false);
    const dist = Math.abs(startPage - cur);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || dist > 2) {
      pf.turnToPage(startPage);
      setPageIndex(startPage);
      return;
    }
    pf.flip(startPage, "top");
  }

  return (
    <div className="atlas-zukan-flip">
      <header className="atlas-zukan-flip__chrome">
        <div className="atlas-zukan-flip__brand">
          <AtlasSurfaceIcon surface="zukan" size={20} />
          <div>
            <p className="atlas-zukan-flip__title">ずかん</p>
            <p className="atlas-zukan-flip__sub">
              学びカード {items.length} 枚 · 未CLEAR {openCount}
            </p>
          </div>
        </div>
        <p className="atlas-zukan-flip__hint">
          {ready
            ? "角・ボタン・カテゴリでページをめくれる"
            : "ずかんをひらいている…"}
        </p>
      </header>

      {categories.length > 0 ? (
        <nav className="atlas-zukan-cats" aria-label="ずかんカテゴリ">
          <p className="atlas-zukan-cats__label">カテゴリ</p>
          <ul className="atlas-zukan-cats__list">
            {categories.map((c) => (
              <li key={c.system}>
                <button
                  type="button"
                  className={`atlas-zukan-cats__btn ${
                    activeCategory?.system === c.system ? "is-active" : ""
                  }`}
                  disabled={!ready || flipping}
                  onClick={() => goCategory(c.startPage)}
                >
                  <span className="atlas-zukan-cats__name">{c.label}</span>
                  <span className="atlas-zukan-cats__count">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div
        className={`atlas-zukan-flip__stage ${
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
              className="atlas-zukan-flip-page atlas-zukan-flip-page--cover"
              data-zukan-page
              data-density="hard"
            >
              <CoverFace itemCount={items.length} openCount={openCount} />
            </div>

            {sheets.map((sheet) => {
              if (sheet.kind === "empty") {
                return (
                  <div
                    key={sheet.key}
                    className="atlas-zukan-flip-page atlas-zukan-flip-page--paper"
                    data-zukan-page
                  >
                    <EmptyDex />
                  </div>
                );
              }
              return (
                <div
                  key={sheet.key}
                  className="atlas-zukan-flip-page atlas-zukan-flip-page--paper"
                  data-zukan-page
                >
                  <div
                    className={`atlas-zukan-flip-page__head ${
                      sheet.pageInCat === 1 ? "is-cat-start" : ""
                    }`}
                  >
                    <span>
                      {sheet.label}
                      <small> · {sheet.count}枚</small>
                    </span>
                    <span>
                      {sheet.pageInCat} / {sheet.pagesInCat}
                    </span>
                  </div>
                  <ul className="atlas-zukan-pocket-grid atlas-zukan-pocket-grid--paged">
                    {sheet.slots.map((row, i) =>
                      row ? (
                        <li
                          key={row.item.id}
                          className="atlas-zukan-slot"
                          style={{ ["--pocket-i" as string]: String(i) }}
                        >
                          <ZukanCard item={row.item} no={row.no} />
                        </li>
                      ) : (
                        <li
                          key={`${sheet.key}-e-${i}`}
                          className="atlas-zukan-slot is-empty"
                          style={{ ["--pocket-i" as string]: String(i) }}
                          aria-hidden
                        >
                          <span className="atlas-zukan-slot__label">空き</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              );
            })}

            {needsEndpaper ? (
              <div
                className="atlas-zukan-flip-page atlas-zukan-flip-page--paper atlas-zukan-flip-page--endpaper"
                data-zukan-page
              >
                <div className="atlas-zukan-flip-page__endpaper">
                  <p>つづく学びは、まだポケットの奥に…</p>
                </div>
              </div>
            ) : null}

            <div
              className="atlas-zukan-flip-page atlas-zukan-flip-page--back"
              data-zukan-page
              data-density="hard"
            >
              <p className="atlas-zukan-flip-page__back-title">ずかん</p>
              <p className="atlas-zukan-flip-page__back-sub">ぼうけんのしょ</p>
            </div>
          </div>
        </div>
      </div>

      <nav className="atlas-zukan-pager" aria-label="ずかんページ送り">
        <button
          type="button"
          className="atlas-zukan-pager__btn"
          disabled={!ready || !canPrev || flipping}
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
                : (activeCategory?.label ?? String(pageIndex))}
        </span>
        <button
          type="button"
          className="atlas-zukan-pager__btn"
          disabled={!ready || !canNext || flipping}
          onClick={() => go("next")}
        >
          つぎ ▶
        </button>
      </nav>
    </div>
  );
}

function CoverFace({
  itemCount,
  openCount,
}: {
  itemCount: number;
  openCount: number;
}) {
  return (
    <div className="atlas-zukan-cover-face">
      <span className="atlas-zukan-cover-face__rivet atlas-zukan-cover-face__rivet--tl" />
      <span className="atlas-zukan-cover-face__rivet atlas-zukan-cover-face__rivet--tr" />
      <span className="atlas-zukan-cover-face__rivet atlas-zukan-cover-face__rivet--bl" />
      <span className="atlas-zukan-cover-face__rivet atlas-zukan-cover-face__rivet--br" />
      <AtlasSurfaceIcon surface="zukan" size={40} color="#f0d25a" />
      <p className="atlas-zukan-cover-face__title">ずかん</p>
      <p className="atlas-zukan-cover-face__sub">ぼうけんのしょ</p>
      <p className="atlas-zukan-cover-face__meta">
        学び {itemCount} · 未CLEAR {openCount}
      </p>
      <span className="atlas-zukan-cover-face__clasp" aria-hidden />
    </div>
  );
}

function EmptyDex() {
  return (
    <div className="atlas-zukan-book__empty">
      <div className="atlas-zukan-pocket-grid atlas-zukan-pocket-grid--paged">
        {Array.from({ length: PAGE_SIZE }, (_, i) => (
          <div key={i} className="atlas-zukan-slot is-empty" aria-hidden>
            <span className="atlas-zukan-slot__label">空き</span>
          </div>
        ))}
      </div>
      <div className="atlas-zukan-book__empty-copy">
        <div className="shrink-0 border-[3px] border-white bg-[#001a8c] p-1 shadow-[4px_4px_0_#000]">
          <AtlasZukanSampleSprite scale={2} />
        </div>
        <div className="grid gap-2">
          <p className="m-0 text-[15px] leading-relaxed text-[#1a1000]">
            ポケットはまだ空じゃ
          </p>
          <p className="m-0 text-[13px] leading-relaxed text-[#4a3a20]">
            しれんでつまずくと、ここに学びカードが収まる。
          </p>
          <Link href="/gates" className="dq-btn w-fit !text-[9px]">
            しれんへ
          </Link>
        </div>
      </div>
    </div>
  );
}

function ZukanCard({ item, no }: { item: ZukanItem; no: number }) {
  const meta = statusMeta(item);
  const detailHref = `/zukan/${item.id}`;
  const fightHref =
    item.status !== "clear" && item.gateId
      ? `/gates/${item.gateId}`
      : null;

  return (
    <article className={`atlas-zukan-card atlas-zukan-card--${meta.tone}`}>
      <Link href={detailHref} className="atlas-zukan-card__hit">
        <div className="atlas-zukan-card__top">
          <span className="atlas-zukan-card__no">{padNo(no)}</span>
          <span
            className={`atlas-zukan-card__badge atlas-zukan-card__badge--${meta.tone}`}
          >
            {meta.label}
          </span>
        </div>
        <div className="atlas-zukan-card__art" aria-hidden>
          <AtlasSurfaceIcon surface="zukan" size={28} />
        </div>
        <p className="atlas-zukan-card__title">{item.title}</p>
        <p className="atlas-zukan-card__meta">
          {item.placeLabel ?? "ばしょ不明"}
          {item.system ? ` · ${systemLabel(item.system)}` : ""}
        </p>
      </Link>
      {fightHref ? (
        <Link href={fightHref} className="atlas-zukan-card__fight">
          たたかう
        </Link>
      ) : (
        <span className="atlas-zukan-card__fight atlas-zukan-card__fight--ghost">
          詳細
        </span>
      )}
    </article>
  );
}
