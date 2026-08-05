"use client";
import { useEffect } from "react";
/** Ensures body.atlas-dq and hides leftover sticky chrome from pre-Atlas layout */
export function AtlasBodyClass() {
  useEffect(() => {
    document.body.classList.add("atlas-dq");
    const hide = () => {
      const nodes = document.querySelectorAll(
        "header.sticky, .sticky.top-0, nav.sticky, [data-app-header], [data-sticky-header], .app-header, .site-header",
      );
      nodes.forEach((el) => {
        if (el.closest(".atlas-dq-root") || el.classList.contains("atlas-keep")) return;
        // Keep brand / command dock chrome
        if (el.textContent && el.textContent.includes("ぼうけんのしょ")) return;
        if (el.textContent && el.textContent.includes("コマンド")) return;
        (el as HTMLElement).style.setProperty("display", "none", "important");
      });
    };
    hide();
    const mo = new MutationObserver(hide);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      document.body.classList.remove("atlas-dq");
    };
  }, []);
  return null;
}
