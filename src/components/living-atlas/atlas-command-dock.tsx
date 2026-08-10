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

/** ADR-0019: コア4面。初 CLEAR 後に証跡面を追加（B3-3） */
const NAV_CORE = [
  { href: "/", label: "ちず", plain: "ホーム" },
  { href: "/gates", label: "しれん", plain: "理解チェック" },
  { href: "/zukan", label: "ずかん", plain: "つまずき" },
  { href: "/setup", label: "じゅんび", plain: "セットアップ" },
] as const;

const NAV_EVIDENCE = [
  { href: "/entries", label: "にっき", plain: "学び・受信箱" },
  { href: "/goals", label: "もくひょう", plain: "目標証跡" },
  { href: "/harness", label: "どうぐ", plain: "ハーネス" },
  /** P3 B12-5: requirements 復帰（初 CLEAR 後。直 URL は常時可） */
  { href: "/requirements", label: "ようけん", plain: "要件ゲート" },
  /** P4 ADR-0020: 日次教科書（直 URL は常時可） */
  { href: "/retro", label: "きょうのしょ", plain: "日次教科書" },
] as const;

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

  function setCollapsedUser(next: boolean) {
    setCollapsed(next);
    // After layout, clamp; approximate with current pos
    requestAnimationFrame(() => {
      setPos((p) => {
        const c = clampPos(p.left, p.top, rootRef.current);
        persist({ collapsed: next, left: c.left, top: c.top });
        return c;
      });
    });
  }

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
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setCollapsedUser(false);
        }}
      >
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
        コマンド
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
        onClick={() => setCollapsedUser(true)}
      >
        たたむ
      </button>
    </nav>
  );
}
