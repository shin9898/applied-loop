import Link from "next/link";
import { LpHeroBattle } from "@/components/living-atlas/lp-hero-battle";

export const dynamic = "force-static";

const GITHUB = "https://github.com/shin9898/applied-loop";

const PAINS = [
  {
    title: "コードは進むのに、説明できない",
    body: "AIとマージできたのに、レビューで「なぜこの設計？」と聞かれて言葉が出ない。",
  },
  {
    title: "学びがチャットに消える",
    body: "わかったつもりでも、セッションが終わると痕跡も結論も残らない。",
  },
  {
    title: "同じ勘違いが戻ってくる",
    body: "先週通した話が、別タスクで同じミスとして再発する。",
  },
] as const;

const RESOLVES = [
  {
    title: "わかったつもりを、あとから試せる",
    body: "コミットや会話から理解チェック（しれん）が届く。合否はあとから見られる。",
  },
  {
    title: "つまずきが地図に残る",
    body: "答えた結果がずかんに貯まる。未解消や再発を追える。",
  },
  {
    title: "今日の一手が朝に見える",
    body: "朝の要約から、いま解くべきしれん／関連する学びに戻れる。",
  },
] as const;

const CAN_DO = [
  {
    title: "しれん（理解チェック）",
    body: "自分の差分について出題され、Web か自分の LLM から答える。",
  },
  {
    title: "ずかん（つまずき一覧）",
    body: "間違えた論点・誤解を一覧で追い、再出題につなげる。",
  },
  {
    title: "ちず（進捗の地図）",
    body: "未消化の理解ギャップをクエスト（！）として眺める。",
  },
  {
    title: "自分の LLM とつなぐ",
    body: "Claude / Cursor / Codex などに MCP を1回貼る。操作の正典はツール側。",
  },
] as const;

const STEPS = [
  {
    n: "①",
    title: "手元で起動する",
    plain: "clone → setup → ブラウザでじゅんび。最初の1問は Web で提出してよい。",
  },
  {
    n: "②",
    title: "いつもどおり働く",
    plain: "監視中の repo で commit、または会話から出題。PR 作成だけでは溜まらない。",
  },
  {
    n: "③",
    title: "答えて、地図に残す",
    plain: "しれんに答える → つまずきがずかんへ。朝に次の一手を見る。",
  },
] as const;

export default function LpPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col text-[#f7f3d9]">
      <header className="absolute top-0 right-0 left-0 z-10 flex items-center justify-end gap-4 px-5 py-4 md:px-10">
        <a
          href="#pain"
          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
        >
          困りごと
        </a>
        <a
          href="#resolve"
          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
        >
          解消
        </a>
        <a
          href="#how"
          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
        >
          仕組み
        </a>
        <a
          href={GITHUB}
          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
        <Link
          href="/setup"
          className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline hover:underline"
        >
          じゅんびへ
        </Link>
      </header>

      {/* Hero: 何のツールかが一視線で分かる */}
      <section className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden border-b-4 border-white px-5 pb-12 pt-20 md:px-10 md:pb-16">
        <div
          className="pointer-events-none absolute inset-0 bg-[#000c4a]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          aria-hidden
          style={{
            backgroundImage:
              "linear-gradient(#002070 1px, transparent 1px), linear-gradient(90deg, #002070 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-[#001a8c] to-transparent"
          aria-hidden
        />

        <div className="relative z-[1] mx-auto grid w-full max-w-6xl items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="atlas-enter max-w-xl">
            <p className="m-0 font-[family-name:var(--font-pixel)] text-[11px] leading-relaxed text-[#f0d25a] md:text-[12px]">
              Applied Loop
            </p>
            <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#9ec0ff]">
              ぼうけんのしょ — AIコーディング向けの、理解ギャップ学習ループ
            </p>
            <h1 className="mt-5 mb-0 font-[family-name:var(--font-jp)] text-[26px] leading-tight text-[#f7f3d9] md:text-[36px]">
              AIで書いたコードの
              <br className="hidden sm:block" />
              「わかったつもり」を、あとから試す。
            </h1>
            <p className="mt-4 mb-0 font-[family-name:var(--font-jp)] text-[15px] leading-relaxed text-[#c9c3a0] md:text-[16px]">
              Cursor や Claude
              で進めた実装について、コミットのたびに理解チェックが届く。答えるとつまずきが残り、朝に次の一手が見える——手元のローカルツール。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={GITHUB}
                className="dq-btn !text-[10px]"
                rel="noreferrer"
                target="_blank"
              >
                GitHub を見る
              </a>
              <Link href="/setup" className="dq-btn dq-btn-ghost !text-[10px]">
                じゅんびへ進む
              </Link>
            </div>
            <p className="mt-4 mb-0 font-[family-name:var(--font-jp)] text-[12px] leading-relaxed text-[#9a9470]">
              いまはセルフホスト dogfood。SaaS / マルチユーザーはまだない。
            </p>
          </div>
          <LpHeroBattle />
        </div>
      </section>

      <section
        id="pain"
        className="border-b-4 border-white bg-[#001a8c] px-5 py-14 md:px-10"
      >
        <h2 className="dq-win-title m-0">こんな困りごと向け</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          速度だけが先に行き、理解と記録が置いていかれる——その穴を埋める。
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {PAINS.map((item, i) => (
            <div
              key={item.title}
              className="border-[3px] border-[#002070] bg-[#000c4a] p-4 atlas-enter"
              style={{ ["--motion-delay" as string]: `${i * 80}ms` }}
            >
              <h3 className="m-0 font-[family-name:var(--font-jp)] text-[17px] text-[#f7f3d9]">
                {item.title}
              </h3>
              <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="resolve"
        className="border-b-4 border-white bg-[#000c4a] px-5 py-14 md:px-10"
      >
        <h2 className="dq-win-title m-0">なにが解消できるか</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          教材を増やすのではなく、自分の作業（コミット・セッション）を理解の材料にする。
        </p>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {RESOLVES.map((item, i) => (
            <li
              key={item.title}
              className="dq-win atlas-enter p-4"
              style={{ ["--motion-delay" as string]: `${i * 80}ms` }}
            >
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
                {`0${i + 1}`}
              </p>
              <h3 className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[18px] text-[#f7f3d9]">
                {item.title}
              </h3>
              <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-b-4 border-white bg-[#001a8c] px-5 py-14 md:px-10">
        <h2 className="dq-win-title m-0">なにができるか</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          UI の呼び名はゲーム風。中身は全部、理解を残すための機能。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAN_DO.map((item, i) => (
            <div
              key={item.title}
              className="border-[3px] border-[#002070] bg-[#000c4a] p-4 atlas-enter"
              style={{ ["--motion-delay" as string]: `${i * 60}ms` }}
            >
              <h3 className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
                {item.title}
              </h3>
              <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#f7f3d9]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="border-b-4 border-white bg-[#000c4a] px-5 py-14 md:px-10">
        <h2 className="dq-win-title m-0">どう動くか</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          初日はツール名を覚えなくてよい。起動 → 働く → 答える、の3手。
        </p>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className="dq-win atlas-enter p-4"
              style={{ ["--motion-delay" as string]: `${i * 80}ms` }}
            >
              <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
                {s.n}
              </p>
              <h3 className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[18px] text-[#f7f3d9]">
                {s.title}
              </h3>
              <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
                {s.plain}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-[#001a8c] px-5 py-14 md:px-10">
        <div className="dq-win max-w-2xl p-5">
          <h2 className="dq-win-title m-0">手元で始める</h2>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
            自分のマシンで動かすオープンソース。API
            キーを渡してクラウド学習させる製品ではない。
          </p>
          <pre className="mt-3 mb-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[#f7f3d9]">
            {`git clone https://github.com/shin9898/applied-loop.git
cd applied-loop
npm run setup
npm run dev:all
# → http://localhost:3100/setup`}
          </pre>
          <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
            正本は{" "}
            <code className="text-[#9ec0ff]">docs/onboarding.md</code>
            。仲間向け最短は README 冒頭。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={GITHUB}
              className="dq-btn !text-[10px]"
              rel="noreferrer"
              target="_blank"
            >
              リポジトリへ
            </a>
            <Link href="/setup" className="dq-btn dq-btn-ghost !text-[10px]">
              すでに起動中ならじゅんびへ
            </Link>
          </div>
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t-4 border-white bg-[#000c4a] px-5 py-6 md:px-10">
        <p className="m-0 font-[family-name:var(--font-jp)] text-[12px] text-[#9a9470]">
          Applied Loop — AIコーディングの理解ギャップを、地図に残す
        </p>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9a9470]">
          © 2026
        </p>
      </footer>
    </div>
  );
}
