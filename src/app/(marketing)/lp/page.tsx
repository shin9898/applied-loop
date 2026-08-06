import { Compass, MoveRight, Swords, Waypoints } from "lucide-react";
import { prisma } from "@/lib/db";
import { joinWaitlist } from "@/lib/actions";
import { recordStreak } from "@/lib/stats";
import { LogoMark } from "@/components/header";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Waypoints,
    time: "① つなぐ",
    title: "MCP を刺す",
    body: "Claude / Cursor / Codex に applied-loop を登録。学びも理解チェックも、フォームではなくツールで完結する",
  },
  {
    icon: Compass,
    time: "② 集める",
    title: "hook とルール",
    body: "コミットからしれんが生え、セッションの非自明な知見だけが受信箱へ。会話本文はクラウドに溜めない",
  },
  {
    icon: Swords,
    time: "③ 進める",
    title: "briefing → しれん",
    body: "朝に morning_briefing。ずれはバトル／じゅもんで潰し、適用は record_application で証跡に残す",
  },
];

export default async function LpPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { joined, error } = await searchParams;

  const [applicationCount, gateResolved, streak] = await Promise.all([
    prisma.application.count(),
    prisma.gate.count({
      where: { status: { in: ["passed", "self_graded_pass"] } },
    }),
    recordStreak(),
  ]);
  const metrics = [
    { value: applicationCount, label: "適用の証跡" },
    { value: gateResolved, label: "しれん CLEAR" },
    { value: streak, label: "連続記録日" },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-8 py-6 md:px-16">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-display text-[19px] font-bold text-ink">
            Applied Loop
          </span>
        </div>
        <nav className="flex items-center gap-7 text-sm text-ink-secondary">
          <a href="#how" className="hover:text-ink">
            仕組み
          </a>
          <a href="#proof" className="hover:text-ink">
            実績
          </a>
          <Link href="/" className="hover:text-ink">
            アプリを開く
          </Link>
          <a
            href="#register"
            className="rounded-lg bg-accent px-4.5 py-[9px] text-[13px] font-bold text-surface transition-opacity hover:opacity-90"
          >
            早期アクセス
          </a>
        </nav>
      </header>

      <section
        id="register"
        className="flex flex-col items-center gap-7 px-8 pb-20 pt-24 text-center md:px-16"
      >
        <h1 className="font-display text-[40px] font-bold leading-[1.45] text-ink md:text-[44px]">
          理解ギャップを、地図に残す。
        </h1>
        <p className="max-w-[640px] text-base leading-[1.9] text-ink-secondary">
          vibe coding で通り過ぎた「わかったつもり」を、しれんと学びの証跡に変える。
          Applied Loop はローカルで回る MCP ループ。UI は Living Atlas、操作の正典はツール。
        </p>
        {joined ? (
          <p className="rounded-lg bg-accent-soft px-5 py-3.5 text-sm font-bold text-accent">
            登録ありがとうございます。ローンチ時に最初にお知らせします。
          </p>
        ) : (
          <form action={joinWaitlist} className="flex flex-wrap items-center justify-center gap-3">
            <input
              type="email"
              name="email"
              required
              placeholder="メールアドレス"
              className="w-[300px] rounded-lg border border-border bg-surface px-4 py-[13px] text-sm placeholder:text-ink-faint"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-6 py-[13px] text-sm font-bold text-surface transition-opacity hover:opacity-90"
            >
              早期アクセスに登録
            </button>
          </form>
        )}
        {error && (
          <p className="text-sm text-warn">
            メールアドレスの形式を確認してください。
          </p>
        )}
        <p className="max-w-[520px] text-xs leading-relaxed text-ink-faint">
          いまはセルフホスト前提の dogfooding 段階。認証付きマルチユーザーはこれから。
          手元で試すならアプリの{" "}
          <code className="text-ink-secondary">/setup</code>
          （じゅんび＝サンプルしれん→貼る文）か{" "}
          <code className="text-ink-secondary">docs/onboarding.md</code>。
          紹介と設計の話は{" "}
          <code className="text-ink-secondary">
            docs/blog/2026-08-why-mcp-async-grade-metadata.md
          </code>
          。
        </p>
      </section>

      <section id="how" className="space-y-9 bg-surface px-8 py-16 md:px-16">
        <h2 className="font-display text-2xl font-bold text-ink">
          ゼロから価値までの3手
        </h2>
        <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start">
          {STEPS.map((step, i) => (
            <div key={step.time} className="flex min-w-0 flex-1 items-start gap-6">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2.5">
                  <step.icon className="h-[18px] w-[18px] text-accent" strokeWidth={2.2} />
                  <span className="font-display text-[15px] font-bold text-accent">
                    {step.time}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-ink">
                  {step.title}
                </h3>
                <p className="text-[13px] leading-[1.8] text-ink-secondary">
                  {step.body}
                </p>
              </div>
              {i < STEPS.length - 1 && (
                <MoveRight className="mt-1 hidden h-5 w-5 shrink-0 text-ink-faint md:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="space-y-8 px-8 py-16 md:px-16">
        <h2 className="font-display text-2xl font-bold text-ink">
          開発者自身で、まず証明する
        </h2>
        <div className="flex flex-col items-start gap-12 md:flex-row">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-1.5">
              <p className="font-display text-[40px] font-bold leading-none text-accent">
                {metric.value}
              </p>
              <p className="text-[13px] text-ink-secondary">{metric.label}</p>
            </div>
          ))}
          <div className="min-w-0 flex-1 space-y-2.5 rounded-lg border-l-4 border-accent bg-surface p-6">
            <p className="font-display text-[15px] leading-[1.8] text-ink">
              採点はセッションの外。迎合しないしれんが、ハーネスの見え方と学びの適用を同じ地図に載せる。
            </p>
            <p className="text-xs text-ink-faint">
              — Living Atlas / MCP 一本化（ADR-0010）より
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-8 py-8 md:px-16">
        <p className="text-xs text-ink-faint">
          Applied Loop — 理解ギャップの Living Atlas
        </p>
        <p className="text-xs text-ink-faint">© 2026</p>
      </footer>
    </div>
  );
}
