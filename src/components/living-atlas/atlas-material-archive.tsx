"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AtlasShell } from "./atlas-shell";
import { AtlasPageTitle } from "./atlas-chrome";

export function AtlasMaterialArchive({
  bands,
  query,
}: {
  bands: Array<{
    id: string;
    dateKey: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
  }>;
  query: string;
}) {
  const [q, setQ] = useState(query);
  const router = useRouter();

  return (
    <AtlasShell>
      <section className="atlas-win-px atlas-px-cut">
        <AtlasPageTitle title="書庫" sub="読む前提ゼロ。引く時に引く" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/retro/archive?q=${encodeURIComponent(q)}`);
          }}
          className="atlas-archive-search"
        >
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="repo名・本文で検索"
            className="atlas-archive-search__input"
          />
          <button type="submit" className="dq-btn !px-3 !py-2 text-[8px]">
            さがす
          </button>
        </form>
        <ul className="atlas-archive-list">
          {bands.map((b) => (
            <li key={b.id} className="atlas-archive-list__item">
              <span className="atlas-archive-list__date">{b.dateKey}</span>
              <span className="atlas-archive-list__repo">{b.repo}</span>
              <span className="atlas-archive-list__digest">{b.digest}</span>
              <span className="atlas-archive-list__count">{b.count}件</span>
              {b.compiledChapterId ? (
                <span className="atlas-archive-list__done">編纂済み</span>
              ) : null}
            </li>
          ))}
          {bands.length === 0 ? (
            <li className="atlas-archive-list__empty">見当たらぬ。</li>
          ) : null}
        </ul>
      </section>
    </AtlasShell>
  );
}
