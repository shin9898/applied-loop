import { createEntry } from "@/lib/actions";
import { BookOpen } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/reveal";

export default function NewEntryPage() {
  const field =
    "w-full rounded-[10px] border border-border bg-surface-raised px-3.5 py-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

  return (
    <PageShell narrow>
      <Reveal className="space-y-8">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-accent" strokeWidth={2.2} />
          <h1 className="font-display text-2xl font-bold text-ink">
            学びを登録
          </h1>
        </div>
        <form
          action={createEntry}
          className="space-y-5 rounded-xl bg-surface/90 p-7 shadow-[0_12px_40px_#2e241808] backdrop-blur-sm"
        >
          <div>
            <label
              htmlFor="title"
              className="mb-1.5 block text-sm font-bold text-ink"
            >
              タイトル <span className="text-accent">*</span>
            </label>
            <input
              id="title"
              name="title"
              required
              placeholder="例: プロダクトマネジメントのすべて PART I"
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor="kind"
              className="mb-1.5 block text-sm font-bold text-ink"
            >
              種別
            </label>
            <select id="kind" name="kind" defaultValue="book" className={field}>
              <option value="book">書籍</option>
              <option value="article">記事</option>
              <option value="course">教材・コース</option>
              <option value="magazine">雑誌</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="source"
              className="mb-1.5 block text-sm font-bold text-ink"
            >
              出典
            </label>
            <input
              id="source"
              name="source"
              placeholder="書名・URL・誌名など"
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor="note"
              className="mb-1.5 block text-sm font-bold text-ink"
            >
              要点と自業務への適用メモ
            </label>
            <textarea
              id="note"
              name="note"
              rows={4}
              placeholder="事実の書き写しで終わらせず、自分の文脈への翻訳を書く"
              className={field}
            />
          </div>
          <button
            type="submit"
            className="rounded-[10px] bg-accent px-5 py-3 text-sm font-bold text-surface transition-opacity hover:opacity-90"
          >
            登録する
          </button>
        </form>
      </Reveal>
    </PageShell>
  );
}
