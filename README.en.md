# Applied Loop

*[日本語版 README はこちら](README.md)*

A local-first tool that turns your day's implementation footprint into **material**, compresses it into a daily **textbook**, and sorts your understanding into **Mastery** states via a short check — so you know exactly what to pick up tomorrow ([ADR-0020](docs/adr/0020-daily-retro-knowledge-loop.md)).

The problem it addresses: an Anthropic RCT (2026-02, n=52) found developers who paired with AI scored 17 points lower on independent code-comprehension tests than developers who hand-wrote the same code (50% vs 67%) — see [docs/product-brief.md](docs/product-brief.md) for the full rationale. Applied Loop doesn't try to slow you down — it captures what you built, compresses it into a short daily lesson, and tracks *specific* misconceptions through an open → resolved → regressed lifecycle until they're actually gone, not just answered once.

An immediate understanding-check ("gate") also remains as a transitional path. Answered misconceptions accumulate in your **field guide** (ずかん / zukan). The UI is called Living Atlas. **MCP is the canonical way to operate it** — the web app is mainly a map, diagnostics, and submission entry point.

This is a self-hosted, single-user OSS tool you run on your own machine. There's no SaaS, no account, and no cloud sync of your answers — see [LICENSE.md](LICENSE.md) (FSL-1.1-MIT: free for personal use, modification, and redistribution; only competing-service hosting is restricted, and only for 2 years, after which it becomes MIT).

**Intro landing page:** local `/lp` · static GitHub Pages version [docs/lp/](docs/lp/)
**Canonical progress (Phase):** [docs/phase-progress.md](docs/phase-progress.md) · [ADR-0019](docs/adr/0019-core-loop-phases.md) · daily-retro P4 [ADR-0020](docs/adr/0020-daily-retro-knowledge-loop.md)
Full onboarding details: [docs/onboarding.md](docs/onboarding.md) (Japanese; canonical)

---

## Quickstart

```bash
git clone https://github.com/shin9898/applied-loop.git
cd applied-loop
npm run setup           # preflight / install / .env generation / migrate / sample seed
                         # detects your grading CLI (claude/codex) and prints
                         # a ready-to-paste MCP registration command
npm run dev:all          # http://localhost:3100
```

1. Open **[/setup](http://localhost:3100/setup)** in your browser and submit one sample check (no need to wait for the verdict).
2. Pick your LLM client and paste the MCP registration command that `npm run setup` printed for you.
3. Ongoing supply (either): watch a repo + install the git hook from `/setup`, or ask your LLM to call `request_gate` in conversation.

Common snags:
- **No grading shows up** → make sure you're logged into the headless Claude or Codex CLI. Manual regrade: `npm run regrade -- <gateId>`
- **Port conflicts** → `npm run preflight` (checks 3100 / 3101)
- **git hook while the app is stopped** → events queue at `~/.applied-loop/event-queue.jsonl` and flush on the next commit after `npm run dev:all` is back up

---

## Core screens

| Path | Role |
|---|---|
| `/` | Home / world map |
| `/setup` | Onboarding wizard + diagnostics |
| `/gates` | Understanding checks (answer now or defer) |
| `/zukan` | Field guide of misconceptions |
| `/retro` | Daily textbook → check → Mastery |

Personal-use surfaces (goals / harness / requirements / Cloud) unlock progressively as you use the tool; direct URLs and `MCP_SURFACE=full` reach them immediately.

## Glossary (UI term → meaning)

The UI uses playful RPG-flavored Japanese names for its concepts. They're kept as-is in the interface; here's what they mean:

| UI term | Meaning |
|---|---|
| ちず (chizu) | Home / world map |
| じゅんび (junbi) | Setup wizard |
| しれん (shiren) | Understanding check (a short graded question) |
| ずかん (zukan) | Field guide of misconceptions |
| きょうのしょ (kyou no sho) | Daily textbook (material → chapter → check → Mastery) |
| じゅもん (jumon) | In-app terminal that opens your LLM/MCP session |

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Prisma + SQLite (Postgres migration planned for a hosted release)
- MCP: `POST /api/mcp` (Streamable HTTP)
- In-app terminal: `scripts/terminal-server.mjs` (`ENABLE_TERMINAL=true`)
- License: [FSL-1.1-MIT](LICENSE.md)

## Common scripts

```bash
npm run dev:all          # UI + in-app terminal
npm run mcp:cloud-config # MCP config snippet for cloud agents (needs APPLIED_LOOP_URL)
./scripts/setup-git-hook.sh ~/path/to/repo
npm run digest            # project weekly digest
```

## Notes

- Decisions are recorded as ADRs under `docs/adr/`.
- All writes go through MCP; the `/entries/new` form has been removed (ADR-0010).
- The observation harness never reads conversation text — metadata only (ADR-0009).
- Full documentation is Japanese-first; this file is a translated summary, not the canonical source. When in doubt, `docs/onboarding.md` and the ADRs win.
