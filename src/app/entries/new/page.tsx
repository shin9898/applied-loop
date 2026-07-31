import { createEntry } from "@/lib/actions";

export default function NewEntryPage() {
  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-xl font-bold">学びを登録</h1>
      <form action={createEntry} className="space-y-4">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium">
            タイトル <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            name="title"
            required
            placeholder="例: プロダクトマネジメントのすべて PART I"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="kind" className="mb-1 block text-sm font-medium">
            種別
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue="book"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="book">書籍</option>
            <option value="article">記事</option>
            <option value="course">教材・コース</option>
            <option value="magazine">雑誌</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div>
          <label htmlFor="source" className="mb-1 block text-sm font-medium">
            出典
          </label>
          <input
            id="source"
            name="source"
            placeholder="書名・URL・誌名など"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="note" className="mb-1 block text-sm font-medium">
            要点と自業務への適用メモ
          </label>
          <textarea
            id="note"
            name="note"
            rows={4}
            placeholder="事実の書き写しで終わらせず、自分の文脈への翻訳を書く"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          登録する
        </button>
      </form>
    </div>
  );
}
