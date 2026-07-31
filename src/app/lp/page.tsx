import { prisma } from "@/lib/db";
import { joinWaitlist } from "@/lib/actions";

export const dynamic = "force-dynamic";

function WaitlistForm({ compact = false }: { compact?: boolean }) {
  return (
    <form action={joinWaitlist} className="flex w-full max-w-md gap-2">
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        className={`rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 ${compact ? "" : "whitespace-nowrap"}`}
      >
        事前登録する
      </button>
    </form>
  );
}

export default async function LpPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { joined, error } = await searchParams;

  const [entryCount, applicationCount, waitlistCount] = await Promise.all([
    prisma.entry.count(),
    prisma.application.count(),
    prisma.waitlistSignup.count(),
  ]);

  return (
    <div className="-mx-4 -my-8">
      {/* ヒーロー */}
      <section className="bg-zinc-900 px-4 py-24 text-center text-white">
        <p className="mb-4 text-sm font-medium tracking-widest text-emerald-400">
          APPLIED LOOP
        </p>
        <h1 className="mx-auto max-w-2xl text-4xl font-bold leading-tight tracking-tight">
          読んだ本を、
          <br />
          実務の意思決定に変える。
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-zinc-300">
          技術書を読んでも、試す機会が流れて終わる —— を終わらせる。
          学び → 実務適用 → 証跡のループで、「使った」が残る学習ツールです。
        </p>
        <div className="mt-8 flex justify-center">
          {joined ? (
            <p className="rounded-md bg-emerald-500/20 px-4 py-3 text-sm text-emerald-300">
              登録ありがとうございます。ローンチ時にご連絡します。
            </p>
          ) : (
            <WaitlistForm />
          )}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-400">メールアドレスの形式を確認してください。</p>
        )}
        {waitlistCount > 0 && (
          <p className="mt-3 text-xs text-zinc-500">{waitlistCount} 名が事前登録済み</p>
        )}
      </section>

      {/* 課題 */}
      <section className="mx-auto max-w-3xl px-4 py-20">
        <h2 className="mb-10 text-center text-2xl font-bold">こんなこと、ありませんか</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "読了がゴールになる",
              body: "本を読み終えた達成感で満足して、実務で試すことなく次の本へ。",
            },
            {
              title: "復習アプリは「覚える」止まり",
              body: "間隔反復で記憶には残る。でも「実務で使ったか」は誰も聞いてくれない。",
            },
            {
              title: "学びの証跡が残らない",
              body: "半年前に学んだフレームワーク。試した結果どうなったか、記録がどこにもない。",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-zinc-200 bg-white p-5">
              <h3 className="mb-2 font-bold">{item.title}</h3>
              <p className="text-sm text-zinc-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 仕組み */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-2xl font-bold">3つのループ</h2>
          <ol className="space-y-6">
            {[
              {
                step: "1",
                title: "学びを登録する",
                body: "本・教材・記事を登録。要点は「自分の文脈への翻訳」で書く。事実の書き写しは要りません。",
              },
              {
                step: "2",
                title: "実務で試したら記録する",
                body: "適用した場面と、変わった意思決定を記録。摩擦を最小にしたイベント型記録だから続きます。",
              },
              {
                step: "3",
                title: "証跡が貯まる",
                body: "「読んだ」ではなく「使って意思決定が変わった」記録が貯まる。必要なら30日実験で習慣化も。",
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  {item.step}
                </span>
                <div>
                  <h3 className="font-bold">{item.title}</h3>
                  <p className="mt-1 text-sm text-zinc-600">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* dogfooding 実績 */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h2 className="mb-4 text-2xl font-bold">開発者自身がユーザー#1です</h2>
        <p className="mx-auto mb-10 max-w-xl text-sm text-zinc-600">
          Applied Loop は開発者自身の学習ループを支えるために作られ、
          開発初日から実データで回っています。
        </p>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          {[
            { value: entryCount, label: "登録された学び" },
            { value: applicationCount, label: "適用の証跡" },
            { value: 20, label: "移行済み復習カード" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-zinc-200 bg-white p-6">
              <p className="text-3xl font-bold text-emerald-600">{item.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 比較 */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-2xl font-bold">既存ツールとの違い</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="py-3 pr-4 font-medium text-zinc-500"></th>
                  <th className="py-3 pr-4 font-medium">Readwise 等</th>
                  <th className="py-3 font-medium text-emerald-600">Applied Loop</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                <tr>
                  <td className="py-3 pr-4 text-zinc-500">主目的</td>
                  <td className="py-3 pr-4">ハイライトの記憶定着</td>
                  <td className="py-3 font-medium">実務適用の証跡</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-zinc-500">終着点</td>
                  <td className="py-3 pr-4">「覚えた」</td>
                  <td className="py-3 font-medium">「意思決定が変わった」</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-zinc-500">記録の型</td>
                  <td className="py-3 pr-4">フラッシュカード反復</td>
                  <td className="py-3 font-medium">イベント型 + 30日実験</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* フッター CTA */}
      <section className="bg-zinc-900 px-4 py-20 text-center text-white">
        <h2 className="text-2xl font-bold">次に読む本を、実務で試せる状態に。</h2>
        <p className="mx-auto mt-4 max-w-md text-sm text-zinc-400">
          現在プライベート開発中。ローンチの案内を希望される方は事前登録をどうぞ。
        </p>
        <div className="mt-8 flex justify-center">
          {joined ? (
            <p className="rounded-md bg-emerald-500/20 px-4 py-3 text-sm text-emerald-300">
              登録済みです。ありがとうございます。
            </p>
          ) : (
            <WaitlistForm compact />
          )}
        </div>
      </section>
    </div>
  );
}
