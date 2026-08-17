import Link from "next/link";
import { AtlasBrandMark } from "@/components/living-atlas/atlas-brand-mark";
import { LpHeroBattle } from "@/components/living-atlas/lp-hero-battle";
import { LpWaitlistForm } from "@/components/living-atlas/lp-waitlist-form";

export const dynamic = "force-static";

const GITHUB = "https://github.com/shin9898/applied-loop";

const PAINS = [
  {
    title: "Code ships, but you can't explain it",
    body: "You merged with your AI's help — then a reviewer asks \"why this design?\" and the words don't come.",
  },
  {
    title: "What you learned disappears into the chat",
    body: "It felt like it clicked in the moment. Once the session ends, no trace and no conclusion survive.",
  },
  {
    title: "The same misunderstanding keeps coming back",
    body: "Something you sorted out last week resurfaces as the exact same mistake on a different task.",
  },
] as const;

const RESOLVES = [
  {
    title: "Your footprint becomes material",
    body: "Commits and session traces aren't discarded. Material accumulates even if you skip a day's check.",
  },
  {
    title: "It compresses into one daily textbook",
    body: "At night (or in the morning), it becomes today's textbook. Read the chapters, answer a short check, and your understanding gets sorted.",
  },
  {
    title: "Tomorrow's next step is decided by state",
    body: "Mastery (clear / partial / stuck / parked) drives your morning summary and home-screen call to action.",
  },
] as const;

const SHOWCASE = [
  {
    title: "Home / world map",
    body: "Your territory of learning grows with every commit. See exactly where you are at a glance.",
    image: "/lp/lp-chizu.png",
    width: 900,
    height: 533,
    alt: "Screenshot of the home screen: a dotted-tile map alongside traveler status.",
  },
  {
    title: "Daily textbook",
    body: "The day's material is organized into chapters — why, pattern, and alternatives. Unlocks after your first clear.",
    image: "/lp/lp-kyounosho.png",
    width: 820,
    height: 856,
    alt: "Screenshot of the daily textbook: three chapter titles with their body text.",
  },
  {
    title: "Field guide of misconceptions",
    body: "Solved and unsolved questions, listed by category — and the source for spaced re-checks.",
    image: "/lp/lp-zukan.png",
    width: 820,
    height: 546,
    alt: "Screenshot of the field guide: per-category counts alongside learning cards.",
  },
] as const;

const AI_LINK_EXAMPLE = [
  "Call request_gate on the Applied Loop MCP server.",
  "Pass your current diff as the diff argument.",
].join("\n");

const STEPS = [
  {
    n: "①",
    title: "Start it locally",
    plain: "clone → setup → open the wizard in your browser. You can submit the first sample check right from the web.",
  },
  {
    n: "②",
    title: "Work like you normally do",
    plain: "Commit in a watched repo. Material accumulates. Opening a PR alone won't do it.",
  },
  {
    n: "③",
    title: "Close the day with the textbook",
    plain: "Daily textbook → check → Mastery. Tomorrow's next step changes based on your state.",
  },
] as const;

export default function LpPageEn() {
  return (
    <div className="flex min-h-full flex-1 flex-col text-[#f7f3d9]">
      <header className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-4 px-5 py-4 md:px-10">
        <Link
          href="/lp/en"
          className="inline-flex no-underline border-[3px] border-white bg-[#000c4a]/95 px-2.5 py-1.5 shadow-[3px_3px_0_#000]"
          aria-label="Applied Loop"
        >
          <AtlasBrandMark size={36} withWordmark wordmarkOverride="Applied Loop" />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-4">
          <a
            href="#pain"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
          >
            Problems
          </a>
          <a
            href="#resolve"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
          >
            Resolved
          </a>
          <a
            href="#how"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
          >
            How it works
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
            href="/lp"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff] no-underline hover:text-[#f0d25a]"
          >
            日本語
          </Link>
          <Link
            href="/setup"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#f0d25a] no-underline hover:underline"
          >
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero: what this tool is, in one glance */}
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
            <div className="flex items-center gap-3 border-[3px] border-white bg-[#000c4a]/90 p-3 shadow-[4px_4px_0_#000]">
              <AtlasBrandMark size={56} />
              <div>
                <p className="m-0 font-[family-name:var(--font-pixel)] text-[11px] leading-relaxed text-[#f0d25a] md:text-[12px]">
                  Applied Loop
                </p>
                <p className="mt-1 mb-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#9ec0ff]">
                  A learning loop for the comprehension gap left by AI-assisted coding
                </p>
              </div>
            </div>
            <h1 className="mt-5 mb-0 font-[family-name:var(--font-jp)] text-[26px] leading-tight text-[#f7f3d9] md:text-[36px]">
              Turn &ldquo;I get it&rdquo; into
              <br className="hidden sm:block" />
              something you can actually explain.
            </h1>
            <p className="mt-4 mb-0 font-[family-name:var(--font-jp)] text-[15px] leading-relaxed text-[#c9c3a0] md:text-[16px]">
              Keeps the footprint of code you wrote with Cursor or Claude as
              material, compresses it into a daily textbook, and sorts your
              understanding through a short check — so you can talk about
              your own code in review, in your own words. A local tool that
              runs on your machine.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={GITHUB}
                className="dq-btn !text-[10px]"
                rel="noreferrer"
                target="_blank"
              >
                View on GitHub
              </a>
              <Link href="/setup" className="dq-btn dq-btn-ghost !text-[10px]">
                Open the setup wizard
              </Link>
            </div>
            <p className="mt-4 mb-0 font-[family-name:var(--font-jp)] text-[12px] leading-relaxed text-[#9a9470]">
              Currently self-hosted dogfood. No SaaS or multi-user support yet.
            </p>
          </div>
          <LpHeroBattle lang="en" />
        </div>
      </section>

      <section
        id="pain"
        className="border-b-4 border-white bg-[#001a8c] px-5 py-14 md:px-10"
      >
        <h2 className="dq-win-title m-0">Built for these problems</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          Speed races ahead while understanding and the record of it get left behind — this fills that gap.
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
        <h2 className="dq-win-title m-0">What it resolves</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          Not more course material — it turns your own work (commits, sessions) into material for understanding.
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
        <h2 className="dq-win-title m-0">What you get</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          The UI uses playful RPG-style names. Every one of them is a feature for keeping your understanding — here are the actual screens.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHOWCASE.map((item, i) => (
            <div
              key={item.title}
              className="border-[3px] border-[#002070] bg-[#000c4a] p-3 atlas-enter"
              style={{ ["--motion-delay" as string]: `${i * 60}ms` }}
            >
              <img
                src={item.image}
                alt={item.alt}
                width={item.width}
                height={item.height}
                loading="lazy"
                style={{ imageRendering: "pixelated" }}
                className="w-full h-auto border-2 border-[#001a8c]"
              />
              <h3 className="mt-3 mb-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
                {item.title}
              </h3>
              <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#f7f3d9]">
                {item.body}
              </p>
            </div>
          ))}
          <div
            className="border-[3px] border-[#002070] bg-[#000c4a] p-4 atlas-enter"
            style={{ ["--motion-delay" as string]: `${SHOWCASE.length * 60}ms` }}
          >
            <h3 className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
              Connect your own LLM
            </h3>
            <p className="mt-2 mb-2 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#f7f3d9]">
              Paste this one line into Claude, Cursor, Codex, or whatever you use.
            </p>
            <pre className="m-0 whitespace-pre-wrap border-2 border-[#001a8c] bg-[#000814] p-2 font-mono text-[11px] leading-relaxed text-[#c9c3a0]">
              {AI_LINK_EXAMPLE}
            </pre>
            <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#9ec0ff]">
              → A check gets generated; answer it and it&apos;s saved to your field guide. The tool is the source of truth for actions.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="border-b-4 border-white bg-[#000c4a] px-5 py-14 md:px-10">
        <h2 className="dq-win-title m-0">How it works</h2>
        <p className="mt-2 mb-8 max-w-2xl font-[family-name:var(--font-jp)] text-[14px] leading-relaxed text-[#c9c3a0]">
          You don&apos;t need to memorize tool names on day one. Start → work → answer — that&apos;s the whole loop.
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
        <p className="mt-6 mb-0 max-w-2xl font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#9ec0ff]">
          ④ From day two on, check just three things each morning — your home screen&apos;s next step, unresolved items in your field guide, and where you left off in the daily textbook.
        </p>
      </section>

      <section className="bg-[#001a8c] px-5 py-14 md:px-10">
        <div className="dq-win max-w-2xl p-5">
          <h2 className="dq-win-title m-0">Start locally</h2>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
            Open source, runs on your own machine. This isn&apos;t a product
            you hand your API key to for cloud-side learning.
          </p>
          <pre className="mt-3 mb-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[#f7f3d9]">
            {`git clone https://github.com/shin9898/applied-loop.git
cd applied-loop
npm run setup
npm run dev:all
# → http://localhost:3100/setup`}
          </pre>
          <p className="mt-3 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
            Canonical docs: <code className="text-[#9ec0ff]">docs/onboarding.md</code> (Japanese) ·{" "}
            <code className="text-[#9ec0ff]">README.en.md</code> for an English summary.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={GITHUB}
              className="dq-btn !text-[10px]"
              rel="noreferrer"
              target="_blank"
            >
              Go to the repo
            </a>
            <Link href="/setup" className="dq-btn dq-btn-ghost !text-[10px]">
              Already running? Open setup
            </Link>
          </div>
        </div>
        <div className="dq-win mt-6 max-w-2xl p-5">
          <h2 className="dq-win-title m-0">Get notified early</h2>
          <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[13px] leading-relaxed text-[#c9c3a0]">
            We&apos;ll email you when a simpler installer or new features ship. Nothing else.
          </p>
          <LpWaitlistForm lang="en" />
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t-4 border-white bg-[#000c4a] px-5 py-6 md:px-10">
        <p className="m-0 font-[family-name:var(--font-jp)] text-[12px] text-[#9a9470]">
          Applied Loop — keeping the AI-coding comprehension gap on the map
        </p>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9a9470]">
          © 2026
        </p>
      </footer>
    </div>
  );
}
