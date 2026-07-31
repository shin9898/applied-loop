import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EntriesPage() {
  const entries = await prisma.entry.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      applications: { select: { id: true } },
      experiments: { where: { status: "active" }, select: { id: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">学び一覧</h1>
        <Link
          href="/entries/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
        >
          新規登録
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">
          まだ学びが登録されていません。読んだ本・教材を登録するところから始めます。
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3"
            >
              <div>
                <Link href={`/entries/${entry.id}`} className="font-medium hover:underline">
                  {entry.title}
                </Link>
                <p className="text-xs text-zinc-500">
                  {entry.kind}
                  {entry.source ? ` / ${entry.source}` : ""}
                </p>
              </div>
              <div className="flex gap-2 text-xs">
                {entry.applications.length > 0 && (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    適用 {entry.applications.length}
                  </span>
                )}
                {entry.experiments.length > 0 && (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">実験中</span>
                )}
                {entry.applications.length === 0 && entry.experiments.length === 0 && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">未適用</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
