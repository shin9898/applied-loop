"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 採点中などバックグラウンドで状態が変わる間、定期的に Server Component を再取得する */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
