import Link from "next/link";
import { Flame, RefreshCcw } from "lucide-react";
import { activityStreak } from "@/lib/streak";

export function LogoMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent shadow-[0_4px_14px_#bc5b3340] transition-transform duration-300 hover:rotate-[-12deg]">
      <RefreshCcw className="h-4 w-4 text-surface" strokeWidth={2.2} />
    </span>
  );
}

const NAV = [
  { href: "/", label: "ダッシュボード" },
  { href: "/zukan", label: "つまずき図鑑" },
  { href: "/gates", label: "理解チェック" },
  { href: "/goals", label: "目標" },
  { href: "/requirements", label: "要件チェック" },
  { href: "/harness", label: "AI の使い方" },
  { href: "/entries", label: "学び" },
] as const;

export async function Header() {
  const streak = await activityStreak();
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border/80 bg-bg/75 px-8 py-5 backdrop-blur-md md:px-16">
      <Link href="/" className="flex items-center gap-2.5">
        <LogoMark />
        <span className="font-display text-[19px] font-bold text-ink">
          Applied Loop
        </span>
      </Link>
      <nav className="flex items-center gap-6 text-sm text-ink-secondary">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="relative transition-colors hover:text-ink after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-accent after:transition-[width] after:duration-300 hover:after:w-full"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div
        className={`flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-2 ${
          streak > 0 ? "motion-pulse" : ""
        }`}
      >
        <Flame className="h-4 w-4 text-accent" strokeWidth={2.2} />
        <span className="font-display text-sm font-bold text-accent">
          {streak > 0 ? `${streak}日連続` : "今日から開始"}
        </span>
      </div>
    </header>
  );
}
