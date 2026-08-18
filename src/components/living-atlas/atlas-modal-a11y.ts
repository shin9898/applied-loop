"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("disabled"));
}

/**
 * fixed inset-0 の DQ 風モーダル (role="dialog" aria-modal="true") 共通:
 * 開いたら先頭要素へフォーカス・Escapeで閉じる・Tab循環でモーダル外へ
 * フォーカスが漏れないようにする（AtlasWorldIntroModal・AtlasMicroDrill
 * の confirmSkip、いずれも既存ギャップだった。2026-08-18）。
 * 起動元要素が閉じた時点でも残っていれば、そこへフォーカスを戻す
 * （WAI-ARIA APGの対要件。opusレビュー指摘、2026-08-18）。
 * 起動元が無い（マウント時に自動で開くモーダル）場合や、閉じる操作
 * 自体が起動元ごとDOMから外す場合（例: AtlasMicroDrillの「飛ばして
 * 進む」で親のphaseが切り替わりコンポーネントごとunmountされる）は
 * `fallbackFocus` を渡すと、そちらへフォーカスする（opus2周目レビュー
 * 指摘、2026-08-18）。
 */
export function useModalA11y(
  open: boolean,
  onClose: () => void,
  options?: { fallbackFocus?: () => HTMLElement | null },
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const triggerRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef(options?.fallbackFocus);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    fallbackFocusRef.current = options?.fallbackFocus;
  });

  useEffect(() => {
    if (!open) return;
    // document.body（マウント時自動オープンで何も選択されていない状態の
    // activeElement）とモーダル内自身の要素（autoFocus等）は起動元として
    // 無効。body.focus()は無害だが何も達成しないため除外する（opus指摘）
    const active = document.activeElement;
    triggerRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      !containerRef.current?.contains(active)
        ? active
        : null;
    getFocusable(containerRef.current)[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable(containerRef.current);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const target = triggerRef.current?.isConnected
        ? triggerRef.current
        : (fallbackFocusRef.current?.() ?? null);
      target?.focus();
    };
  }, [open]);

  return containerRef;
}
