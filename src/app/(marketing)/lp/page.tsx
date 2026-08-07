import Link from "next/link";

export const dynamic = "force-static";

const GITHUB = "https://github.com/shin9898/applied-loop";

const STEPS = [
  {
    n: "①",
    title: "サンプルしれんを1問",
    plain: "Web の『たたかう』で提出。合否は待たなくてよい",
  },
  {
    n: "②",
    title: "自分の LLM に MCP をつなぐ",
    plain: "道を選び、貼る文を1回呼ぶ。ツール名は覚えなくてよい",
  },
  {
    n: "③",
    title: "（任意）監視リポジトリ",
    plain: "仕事 repo を選んで鉤。未選択なら commit からは溜まらない",
  },
] as const;

const LOOP = [
  {
    title: "つなぐ",
    body: "アプリ + 合言葉 + 自分の LLM（MCP）。操作の正典はツール。",
  },
  {
    title: "集める",
    body: "監視中 repo の commit、または会話の request_gate。PR 作成だけでは増えない。",
  },
  {
    title: "進める",
    body: "朝の要約 → しれん → ずかん。わかったつもりを地図に残す。",
  },
] as const;

export default function LpPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col text-[#f7f3d9]">
      {/* ナビ（ヒーロー内ブランドを邪魔しない薄さ） */}
      <header className="absolute top-0 right-0 left-0 z-10 flex items-center justify-end gap-4 px-5 py-4 md:px-10">
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

      {/* Hero: 1構図 — ブランド / 見出し / 一文 / CTA / 支配的ビジュアル面 */}
      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden border-b-4 border-white px-5 pb-10 pt-20 md:px-10 md:pb-14">
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
          className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-gradient-to-b from-[#001a8c] to-transparent"
          aria-hidden
        />
        <div
          className="atlas-enter pointer-events-none absolute top-[18%] right-[8%] hidden h-28 w-28 border-4 border-white bg-[#001a8c] shadow-[6px_6px_0_#000] md:block"
          aria-hidden
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex h-full items-center justify-center font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
            ！
          </div>
        </div>

        <div className="relative z-[1] max-w-3xl atlas-enter">
          <p className="m-0 font-[family-name:var(--font-pixel)] text-[11px] leading-relaxed text-[#f0d25a] md:text-[12px]">
            Applied Loop
          </p>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[22px] leading-snug text-[#f7f3d9] md:text-[28px]">
            ぼうけんのしょ
          </p>
          <h1 className="mt-6 mb-0 font-[family-name:var(--font-jp)] text-[28px] leading-tight text-[#f7f3d9] md:text-[40px]">
            理解ギャップを、地図に残す。
          </h1>
          <p className="mt-4 mb-0 max-w-xl font-[family-name:var(--font-jp)] text-[15px] leading-relaxed text-[#c9c3a0] md:text-[17px]">
            vibe coding
            で通り過ぎた「わかったつもり」を、しれん（理解チェック）とずかん（つまずき）に変える。ローカルで回る
            MCP ループ。UI は Living Atlas。
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
      </section>

      <section id="how" className="border-b-4 border-white bg-[#001a8c] px-5 py-14 md:px-10">
        <h2 className="dq-win-title m-0">最短3手（じゅんび）</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          初日はツール名を覚えなくてよい。順番だけ守る。
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

      <section className="border-b-4 border-white bg-[#000c4a] px-5 py-14 md:px-10">
        <h2 className="dq-win-title m-0">本運用のループ</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {LOOP.map((item, i) => (
            <div
              key={item.title}
              className="border-[3px] border-[#002070] bg-[#001a8c] p-4 atlas-enter"
              style={{ ["--motion-delay" as string]: `${i * 80}ms` }}
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

      <section className="bg-[#001a8c] px-5 py-14 md:px-10">
        <div className="dq-win max-w-2xl p-5">
          <h2 className="dq-win-title m-0">手元で始める</h2>
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
          Applied Loop — 理解ギャップの Living Atlas
        </p>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9a9470]">
          © 2026
        </p>
      </footer>
    </div>
  );
}
