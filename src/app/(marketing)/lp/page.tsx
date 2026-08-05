import { Moon, MoveRight, NotebookPen, Sunrise } from "lucide-react";
import { prisma } from "@/lib/db";
import { joinWaitlist } from "@/lib/actions";
import { recordStreak } from "@/lib/stats";
import { LogoMark } from "@/components/header";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Moon,
    time: "夜",
    title: "LLM が拾う",
    body: "Claude Code や Cursor での作業中、会話に現れた学びを秘書のように記録。あなたは何も登録しなくていい",
  },
  {
    icon: Sunrise,
    time: "朝",
    title: "30秒で仕分ける",
    body: "受信箱に届いた学びを「登録 / 無視」で仕分け。続いて「今日の問いかけ」が1件、実務で試すきっかけをくれる",
  },
  {
    icon: NotebookPen,
    time: "週末",
    title: "証跡が貯まる",
    body: "適用した場面と変わった意思決定が、週次のふりかえりにそのまま使える記録として積み上がる",
  },
];

export default async function LpPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { joined, error } = await searchParams;

  const [applicationCount, decisionCount, streak] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({ where: { decisionChanged: { not: null } } }),
    recordStreak(),
  ]);
  const metrics = [
    { value: applicationCount, label: "適用記録（4週間）" },
    { value: decisionCount, label: "変わった意思決定" },
    { value: streak, label: "連続記録日数" },
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
        <h1 className="font-display text-[44px] font-bold leading-[1.5] text-ink">
          学びが、流れて消える前に。
        </h1>
        <p className="max-w-[640px] text-base leading-[1.9] text-ink-secondary">
          LLM との会話に散らばる学びを、秘書のように拾い、朝の問いかけで実務に結びつける。Applied
          Loop は、学習習慣のための自動化装置です。
        </p>
        {joined ? (
          <p className="rounded-lg bg-accent-soft px-5 py-3.5 text-sm font-bold text-accent">
            登録ありがとうございます。ローンチ時に最初にお知らせします。
          </p>
        ) : (
          <form action={joinWaitlist} className="flex items-center gap-3">
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
        <p className="text-xs text-ink-faint">
          開発者自身が毎朝使って検証中。ローンチ時に最初にお知らせします
        </p>
      </section>

      <section id="how" className="space-y-9 bg-surface px-8 py-16 md:px-16">
        <h2 className="font-display text-2xl font-bold text-ink">
          一日の、小さな循環
        </h2>
        <div className="flex items-start gap-6">
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
                <MoveRight className="mt-1 h-5 w-5 shrink-0 text-ink-faint" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="space-y-8 px-8 py-16 md:px-16">
        <h2 className="font-display text-2xl font-bold text-ink">
          開発者自身で、まず証明する
        </h2>
        <div className="flex items-start gap-12">
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
              読んだだけで終わっていた学びが、週次レビューで『先週は3つ意思決定が変わった』と言える記録に変わった
            </p>
            <p className="text-xs text-ink-faint">
              — 開発者（ユーザー#1）のふりかえりより
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-auto flex items-center justify-between border-t border-border px-8 py-8 md:px-16">
        <p className="text-xs text-ink-faint">
          Applied Loop — 学習習慣の自動化装置
        </p>
        <p className="text-xs text-ink-faint">© 2026</p>
      </footer>
    </div>
  );
}
