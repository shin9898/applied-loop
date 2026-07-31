import { prisma } from "@/lib/db";
import { reviewCard } from "@/lib/actions";

export const dynamic = "force-dynamic";

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function CardsPage() {
  const now = new Date();
  const [dueCards, upcoming] = await Promise.all([
    prisma.srCard.findMany({
      where: { nextReview: { lte: now } },
      orderBy: { nextReview: "asc" },
    }),
    prisma.srCard.findMany({
      where: { nextReview: { gt: now } },
      orderBy: { nextReview: "asc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-xl font-bold">期限切れカード（{dueCards.length} 枚）</h1>
        <p className="mb-4 text-sm text-zinc-500">
          答えを思い出してから開き、0-5 で自己採点（0-2: 不正解 / 3: 部分 / 4-5: 正解）
        </p>
        {dueCards.length === 0 ? (
          <p className="text-sm text-zinc-500">復習期限のカードはありません。</p>
        ) : (
          <ul className="space-y-3">
            {dueCards.map((card) => (
              <li key={card.id} className="rounded-lg border border-amber-200 bg-white p-4">
                <p className="text-xs text-zinc-500">
                  {card.topic} / 期限 {fmt(card.nextReview)} / interval {card.interval}日
                </p>
                <p className="mt-2 font-medium">{card.question}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-blue-600">答えを見る</summary>
                  <p className="mt-1 rounded bg-zinc-50 p-2 text-sm">{card.answer}</p>
                  <form action={reviewCard} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="cardId" value={card.id} />
                    {[0, 1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="submit"
                        name="score"
                        value={s}
                        className={`h-8 w-8 rounded-md text-sm ${
                          s <= 2
                            ? "border border-red-300 text-red-600 hover:bg-red-50"
                            : s === 3
                              ? "border border-amber-300 text-amber-600 hover:bg-amber-50"
                              : "border border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">今後のカード</h2>
          <ul className="space-y-1 text-sm text-zinc-600">
            {upcoming.map((card) => (
              <li key={card.id} className="flex gap-3">
                <span className="w-24 text-zinc-400">{fmt(card.nextReview)}</span>
                <span>{card.topic}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
