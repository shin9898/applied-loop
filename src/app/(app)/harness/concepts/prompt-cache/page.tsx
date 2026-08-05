import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { ensurePromptCacheModuleGates } from "@/lib/harness-canon";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

/** 再作画図 (ADR-0016: 外部スクショ直置き禁止・原理のみ) */
function FigurePrefixReuse() {
  return (
    <svg viewBox="0 0 640 200" className="w-full max-w-2xl" role="img" aria-label="プロンプトキャッシュの基本">
      <text x="8" y="22" className="fill-ink" fontSize="13" fontWeight="700">
        2回目: 同じ先頭は再利用、末尾だけ新しく処理
      </text>
      {[
        { x: 8, label: "システム" },
        { x: 118, label: "ツール" },
        { x: 228, label: "履歴" },
        { x: 338, label: "次の質問" },
      ].map((b) => (
        <g key={b.label}>
          <rect
            x={b.x}
            y={48}
            width="100"
            height="44"
            rx="8"
            className={b.label === "次の質問" ? "fill-accent" : "fill-surface stroke-border"}
            strokeWidth="1"
          />
          <text
            x={b.x + 50}
            y={74}
            textAnchor="middle"
            fontSize="12"
            className={b.label === "次の質問" ? "fill-surface" : "fill-ink"}
            fontWeight="600"
          >
            {b.label}
          </text>
        </g>
      ))}
      <line x1="8" y1="120" x2="328" y2="120" className="stroke-accent" strokeWidth="2" />
      <text x="168" y="140" textAnchor="middle" fontSize="11" className="fill-ink-secondary">
        前回の計算を再利用
      </text>
      <line x1="338" y1="120" x2="438" y2="120" className="stroke-warn" strokeWidth="2" />
      <text x="388" y="140" textAnchor="middle" fontSize="11" className="fill-ink-secondary">
        新しく処理
      </text>
      <text x="8" y="175" fontSize="11" className="fill-ink-faint">
        ※ 人間的な記憶ではなく、同じ並びの計算結果の再利用
      </text>
    </svg>
  );
}

function FigureMidChange() {
  return (
    <svg viewBox="0 0 640 210" className="w-full max-w-2xl" role="img" aria-label="途中変更で後ろも再計算">
      <text x="8" y="22" className="fill-ink" fontSize="13" fontWeight="700">
        途中が1か所変わると、その後ろも再計算されやすい
      </text>
      {["A", "B", "C", "D", "E"].map((label, i) => (
        <g key={`prev-${label}`}>
          <rect x={8 + i * 70} y={40} width="60" height="36" rx="6" className="fill-surface stroke-border" />
          <text x={38 + i * 70} y={62} textAnchor="middle" fontSize="13" className="fill-ink" fontWeight="600">
            {label}
          </text>
        </g>
      ))}
      <text x="370" y="62" fontSize="12" className="fill-ink-faint">
        前回
      </text>
      {["A", "B", "X", "D", "E"].map((label, i) => (
        <g key={`cur-${label}-${i}`}>
          <rect
            x={8 + i * 70}
            y={100}
            width="60"
            height="36"
            rx="6"
            className={label === "X" ? "fill-accent" : "fill-surface stroke-border"}
          />
          <text
            x={38 + i * 70}
            y={122}
            textAnchor="middle"
            fontSize="13"
            className={label === "X" ? "fill-surface" : "fill-ink"}
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      <text x="370" y="122" fontSize="12" className="fill-ink-faint">
        今回
      </text>
      <text x="8" y="170" fontSize="11" className="fill-ink-secondary">
        A–B まで再利用可 / X 以降は再計算（意味が近くても並びが違えば別入力）
      </text>
    </svg>
  );
}

function FigureToolInsert() {
  return (
    <svg viewBox="0 0 640 200" className="w-full max-w-2xl" role="img" aria-label="ツール追加の影響">
      <text x="8" y="22" className="fill-ink" fontSize="13" fontWeight="700">
        ツール定義を前に足すと、後ろの長い履歴まで巻き込まれやすい
      </text>
      {["System", "read", "write", "bash", "履歴…"].map((label, i) => (
        <g key={`t1-${label}`}>
          <rect x={8 + i * 90} y={44} width="82" height="34" rx="6" className="fill-surface stroke-border" />
          <text x={49 + i * 90} y={65} textAnchor="middle" fontSize="11" className="fill-ink" fontWeight="600">
            {label}
          </text>
        </g>
      ))}
      {["System", "read", "write", "bash", "deploy", "履歴…"].map((label, i) => (
        <g key={`t2-${label}`}>
          <rect
            x={8 + i * 90}
            y={110}
            width="82"
            height="34"
            rx="6"
            className={label === "deploy" ? "fill-accent" : "fill-surface stroke-border"}
          />
          <text
            x={49 + i * 90}
            y={131}
            textAnchor="middle"
            fontSize="11"
            className={label === "deploy" ? "fill-surface" : "fill-ink"}
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      <text x="8" y="175" fontSize="11" className="fill-ink-secondary">
        前方の定義が変わると、後ろの長い文脈も再処理の対象になりやすい
      </text>
    </svg>
  );
}

export default async function PromptCacheConceptPage() {
  // シード + 未出題の module ゲートを冪等に用意
  const seeded = await ensurePromptCacheModuleGates().catch(() => ({
    created: 0,
    gateIds: [] as string[],
  }));

  return (
    <PageShell narrow className="space-y-10">
      <div>
        <Link
          href="/harness"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-secondary hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
          AI の使い方に戻る
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-accent" strokeWidth={2.2} />
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
            ハーネス正典モジュール
          </p>
        </div>
        <h1 className="font-display text-3xl font-bold text-ink">
          プロンプトキャッシュの原理
        </h1>
        <p className="text-sm leading-6 text-ink-secondary">
          目的は挙動の理解であり、キャッシュ率の最大化ではありません。
          概念はどのプロジェクトでも共通。直し方と効果確認はリポジトリごとに見ます
          (ADR-0016)。
        </p>
      </header>

      <section className="space-y-3 rounded-xl bg-surface p-7">
        <h2 className="font-display text-lg font-bold text-ink">出発点</h2>
        <p className="text-sm leading-6 text-ink-secondary">
          「続けて」と送っただけでも、システム・ツール定義・ルール・会話履歴・コマンド結果までまとめてモデルに送ることがあります。短い指示だから安い、とは限りません。
        </p>
      </section>

      <section className="space-y-4 rounded-xl bg-surface p-7">
        <h2 className="font-display text-lg font-bold text-ink">再利用の基本</h2>
        <FigurePrefixReuse />
        <p className="text-sm leading-6 text-ink-secondary">
          前回と同じ先頭部分があるなら、そこはゼロから計算し直さず、増えた末尾だけ処理します。これは AI が会話を覚えている話ではなく、同じ入力並びの計算結果の再利用です。
        </p>
      </section>

      <section className="space-y-4 rounded-xl bg-surface p-7">
        <h2 className="font-display text-lg font-bold text-ink">
          キャッシュは「意味」ではなく「同じ並び」
        </h2>
        <FigureMidChange />
        <p className="text-sm leading-6 text-ink-secondary">
          変わらない情報は前に、変わる情報は後ろに置くのが基本です。途中をいじると、その後ろも別入力扱いになりやすいです。
        </p>
      </section>

      <section className="space-y-4 rounded-xl bg-surface p-7">
        <h2 className="font-display text-lg font-bold text-ink">
          ツール定義の位置
        </h2>
        <FigureToolInsert />
        <p className="text-sm leading-6 text-ink-secondary">
          エージェントのツール定義は履歴より前に置かれることが多いです。1つ足しただけでも、後ろの長い履歴まで再処理の対象になり得ます。
        </p>
      </section>

      <section className="space-y-3 rounded-xl bg-surface p-7">
        <h2 className="font-display text-lg font-bold text-ink">TTL と履歴削除</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
          <li>
            入力が同じでも、待ち時間が長いと再利用できなくなることがあります（失効時間はプロバイダ・プランで変わるため、数値は正典にしません）。
          </li>
          <li>
            古い履歴を削るとトークンは減っても、並びが変わって再計算コストが増えたり、判断の根拠を失ったりします。
          </li>
          <li>
            見るべきなのは「どれだけ短くなったか」だけでなく、「どこから再計算か」「必要な文脈まで失っていないか」です。
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-bg p-7">
        <h2 className="font-display text-lg font-bold text-ink">次の一歩</h2>
        <p className="text-sm leading-6 text-ink-secondary">
          観測ページで repo 別の再利用率を確認し、理解チェック（module）で自分の言葉で説明してください。ハーネスを直したら、適用記録の対象にリポジトリ名を入れて再観測します。
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/harness"
            className="rounded-[10px] bg-accent px-4 py-2.5 text-sm font-bold text-surface"
          >
            観測を見る
          </Link>
          <Link
            href="/gates"
            className="rounded-[10px] border border-border bg-surface px-4 py-2.5 text-sm font-bold text-ink"
          >
            理解チェックへ
            {seeded.created > 0 ? ` (新規 ${seeded.created})` : ""}
          </Link>
        </div>
        <p className="pt-2 text-[11px] text-ink-faint">
          一次情報:{" "}
          <a
            className="text-accent hover:underline"
            href="https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"
            target="_blank"
            rel="noreferrer"
          >
            Anthropic Prompt caching
          </a>
        </p>
      </section>
    </PageShell>
  );
}
