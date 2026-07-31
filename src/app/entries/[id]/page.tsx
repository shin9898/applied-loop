import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createApplication, createExperiment } from "@/lib/actions";

export const dynamic = "force-dynamic";

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await prisma.entry.findUnique({
    where: { id },
    include: {
      applications: { orderBy: { createdAt: "desc" } },
      experiments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!entry) notFound();

  const hasActiveExperiment = entry.experiments.some((e) => e.status === "active");

  return (
    <div className="space-y-10">
      <div>
        <Link href="/entries" className="text-sm text-zinc-500 hover:underline">
          ← 一覧へ
        </Link>
        <h1 className="mt-2 text-xl font-bold">{entry.title}</h1>
        <p className="text-sm text-zinc-500">
          {entry.kind}
          {entry.source ? ` / ${entry.source}` : ""} / {fmt(entry.createdAt)} 登録
        </p>
        {entry.note && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm whitespace-pre-wrap">
            {entry.note}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">適用を記録する（格上げ）</h2>
        <form action={createApplication} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <input type="hidden" name="entryId" value={entry.id} />
          <div>
            <label htmlFor="appliedTo" className="mb-1 block text-sm font-medium">
              何に適用したか <span className="text-red-500">*</span>
            </label>
            <input
              id="appliedTo"
              name="appliedTo"
              required
              placeholder="例: 個人開発 applied-loop の設計"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium">
              適用内容 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="note"
              name="note"
              required
              rows={3}
              placeholder="どう使ったか・結果どうなったか"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="decisionChanged" className="mb-1 block text-sm font-medium">
              変わった意思決定・採否・優先順位
            </label>
            <input
              id="decisionChanged"
              name="decisionChanged"
              placeholder="格上げの核心。例: 中核ループを実験型からイベント型に変更"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            適用を記録
          </button>
        </form>

        {entry.applications.length > 0 && (
          <ul className="mt-4 space-y-2">
            {entry.applications.map((app) => (
              <li key={app.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <span className="font-medium">{app.appliedTo}</span>
                <p className="mt-1 whitespace-pre-wrap">{app.note}</p>
                {app.decisionChanged && (
                  <p className="mt-1 text-emerald-700">意思決定の変化: {app.decisionChanged}</p>
                )}
                <p className="mt-1 text-xs text-zinc-500">{fmt(app.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">30日実験（オプション）</h2>
        {hasActiveExperiment ? (
          <p className="text-sm text-zinc-500">この学びにはアクティブな実験があります。</p>
        ) : (
          <form action={createExperiment} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
            <input type="hidden" name="entryId" value={entry.id} />
            <div>
              <label htmlFor="action" className="mb-1 block text-sm font-medium">
                やること（1つだけ）<span className="text-red-500">*</span>
              </label>
              <input
                id="action"
                name="action"
                required
                placeholder="例: 要望連絡に却下理由を添えて返す"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="successMetric" className="mb-1 block text-sm font-medium">
                成功指標（1つだけ）<span className="text-red-500">*</span>
              </label>
              <input
                id="successMetric"
                name="successMetric"
                required
                placeholder="例: 30日で8件に却下理由を添えられた"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-zinc-900 px-4 py-2 text-sm hover:bg-zinc-100"
            >
              実験を開始（30日）
            </button>
          </form>
        )}

        {entry.experiments.length > 0 && (
          <ul className="mt-4 space-y-2">
            {entry.experiments.map((exp) => (
              <li key={exp.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <Link href={`/experiments/${exp.id}`} className="font-medium hover:underline">
                  {exp.action}
                </Link>
                <p className="text-xs text-zinc-500">
                  {fmt(exp.startDate)} 〜 {fmt(exp.endDate)} / {exp.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
