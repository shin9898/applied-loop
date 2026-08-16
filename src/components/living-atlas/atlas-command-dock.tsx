"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AtlasSurfaceIcon,
  surfaceIdFromHref,
  type AtlasSurfaceId,
} from "./atlas-surface-icons";

/** ADR-0019: コア4面。初 CLEAR 後に証跡面を追加（B3-3） */
const NAV_CORE: readonly {
  href: string;
  label: string;
  plain: string;
  surface: AtlasSurfaceId;
}[] = [
  { href: "/", label: "ちず", plain: "ホーム", surface: "map" },
  { href: "/gates", label: "しれん", plain: "理解チェック", surface: "gates" },
  { href: "/zukan", label: "ずかん", plain: "つまずき", surface: "zukan" },
  { href: "/setup", label: "じゅんび", plain: "セットアップ", surface: "setup" },
];

const NAV_EVIDENCE: readonly {
  href: string;
  label: string;
  plain: string;
  surface: AtlasSurfaceId;
}[] = [
  { href: "/retro", label: "にっき", plain: "ぼうけん日記", surface: "retro" },
  { href: "/entries", label: "うけばこ", plain: "学び・受信箱", surface: "entries" },
  { href: "/goals", label: "もくひょう", plain: "目標証跡", surface: "goals" },
  { href: "/harness", label: "どうぐ", plain: "ハーネス", surface: "harness" },
  {
    href: "/requirements",
    label: "ようけん",
    plain: "要件ゲート",
    surface: "requirements",
  },
];

const STORAGE_KEY = "atlas-cmd-dock-v1";

type DockPersist = {
  collapsed: boolean;
  left: number;
  top: number;
};

function pathActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function defaultPos(collapsed: boolean): { left: number; top: number } {
  const w = collapsed ? 104 : 276;
  const h = collapsed ? 48 : 248;
  return {
    left: Math.max(8, window.innerWidth - w - 12),
    top: Math.max(8, window.innerHeight - h - 12),
  };
}

function clampPos(left: number, top: number, el: HTMLElement | null) {
  const w = el?.offsetWidth ?? 276;
  const h = el?.offsetHeight ?? 48;
  const maxL = Math.max(8, window.innerWidth - w - 8);
  const maxT = Math.max(8, window.innerHeight - h - 8);
  return {
    left: Math.min(maxL, Math.max(8, left)),
    top: Math.min(maxT, Math.max(8, top)),
  };
}

function loadPersist(): DockPersist | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as DockPersist;
    if (
      typeof v.collapsed !== "boolean" ||
      typeof v.left !== "number" ||
      typeof v.top !== "number"
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/**
 * ユーザー操作のコマンドドック。
 * - 畳む／開くは明示操作のみ（自動退避なし）
 * - タイトルバー拖動で位置変更（localStorage に保存）
 * - 背景は真っ黒（古典 DQ メニュー）
 */
export function AtlasCommandDock({ streakDays }: { streakDays?: number }) {
  const pathname = usePathname() ?? "/";
  const rootRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [evidenceUnlocked, setEvidenceUnlocked] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const drag = useRef<{
    ox: number;
    oy: number;
    sl: number;
    st: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  /** 畳む／開く直後に、新しい DOM のサイズで位置を合わせる */
  const pendingAnchor = useRef<{
    collapsed: boolean;
    left: number;
    top: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // localStorage はクライアントでのみ読む（同期 setState を避ける）
    Promise.resolve().then(() => {
      if (cancelled) return;
      const saved = loadPersist();
      if (saved) {
        setCollapsed(saved.collapsed);
        setPos({ left: saved.left, top: saved.top });
      } else {
        setPos(defaultPos(false));
      }
      setReady(true);
    });
    void import("@/lib/actions").then(({ getEvidenceNavUnlocked }) =>
      getEvidenceNavUnlocked()
        .then((v) => {
          if (!cancelled) setEvidenceUnlocked(v);
        })
        .catch(() => {
          /* ignore */
        }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: DockPersist) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const onResize = () => {
      setPos((p) => {
        const c = clampPos(p.left, p.top, rootRef.current);
        persist({ collapsed, left: c.left, top: c.top });
        return c;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready, collapsed, persist]);

  /**
   * 畳む: 「たたむ」ボタン位置にタブを置く。
   * 開く: タブ位置を下端の目安にしてメニューを上方向に展開する。
   */
  function setCollapsedUser(
    next: boolean,
    anchor?: { left: number; top: number; height: number },
  ) {
    if (anchor) {
      pendingAnchor.current = { collapsed: next, ...anchor };
    }
    setCollapsed(next);
  }

  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor || anchor.collapsed !== collapsed) return;
    pendingAnchor.current = null;
    // 畳み／展開後の実 DOM サイズで位置決め
    requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el) return;
      const left = anchor.left;
      let top = anchor.top;
      if (!collapsed) {
        top = anchor.top + anchor.height - el.offsetHeight;
      }
      const c = clampPos(left, top, el);
      persist({ collapsed, left: c.left, top: c.top });
      setPos(c);
    });
  }, [collapsed, persist]);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("a,button.atlas-cmd-dock__fold")) {
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      ox: e.clientX,
      oy: e.clientY,
      sl: pos.left,
      st: pos.top,
      moved: false,
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const next = clampPos(d.sl + dx, d.st + dy, rootRef.current);
    setPos(next);
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d.moved) {
      suppressClick.current = true;
      setPos((p) => {
        const c = clampPos(p.left, p.top, rootRef.current);
        persist({ collapsed, left: c.left, top: c.top });
        return c;
      });
    }
  }

  if (!ready) return null;

  const style = { left: pos.left, top: pos.top };
  const navItems = evidenceUnlocked
    ? [...NAV_CORE, ...NAV_EVIDENCE]
    : [...NAV_CORE];

  if (collapsed) {
    return (
      <button
        ref={(n) => {
          rootRef.current = n;
        }}
        type="button"
        className="atlas-cmd-dock atlas-cmd-dock--tab atlas-keep"
        style={style}
        aria-label="メニューを開く"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setCollapsedUser(false, {
            left: r.left,
            top: r.top,
            height: r.height,
          });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ピクセルマーク */}
        <img
          src="/brand/mark.svg"
          alt=""
          width={16}
          height={16}
          className="atlas-cmd-dock__mark"
          style={{ imageRendering: "pixelated", marginRight: 8 }}
          decoding="async"
        />
        メニュー
      </button>
    );
  }

  return (
    <nav
      ref={(n) => {
        rootRef.current = n;
      }}
      className="atlas-cmd-dock atlas-keep"
      style={style}
      aria-label="コマンド"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="atlas-cmd-dock__title" title="ドラッグで移動">
        {/* eslint-disable-next-line @next/next/no-img-element -- ピクセルマーク */}
        <img
          src="/brand/mark.svg"
          alt=""
          width={18}
          height={18}
          className="atlas-cmd-dock__mark"
          style={{ imageRendering: "pixelated" }}
          decoding="async"
        />
        <span>ぼうけんのしょ</span>
      </div>
      <ul className="atlas-cmd-dock__grid">
        {navItems.map((n) => {
          const active = pathActive(pathname, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                className={active ? "is-active" : undefined}
                title={`${n.label}（${n.plain}）`}
              >
                <span className="atlas-cmd-dock__row">
                  <span className="atlas-cmd-dock__cur" aria-hidden />
                  <AtlasSurfaceIcon
                    surface={n.surface ?? surfaceIdFromHref(n.href)}
                    size={14}
                    className="atlas-cmd-dock__icon"
                  />
                  {n.label}
                </span>
                <span className="atlas-cmd-dock__plain">{n.plain}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {evidenceUnlocked ? (
        <div className="atlas-cmd-dock__streak" style={{ color: "#9ec0ff" }}>
          証跡面解放済み
        </div>
      ) : null}
      {typeof streakDays === "number" && streakDays > 0 ? (
        <div className="atlas-cmd-dock__streak">れんぞく {streakDays}日</div>
      ) : null}
      <button
        type="button"
        className="atlas-cmd-dock__fold"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCollapsedUser(true, {
            left: r.left,
            top: r.top,
            height: r.height,
          });
        }}
      >
        たたむ
      </button>
    </nav>
  );
}
