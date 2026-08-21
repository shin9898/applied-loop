---
type: decision
status: accepted
date: 2026-08-21
tags: [harness, prompt-cache, multi-repo]
source_refs: [docs/adr/0017-prompt-cache-savings-pack.md]
---

# ADR-0022: ADR-0017 §2改訂 — 共有ハーネスパックの正典を llm-config へ移動

## 背景

ADR-0017 §2 は共有ハーネスパックの正典を `docs/harness-pack/`（Applied Loop
リポジトリ内）としていた。しかし実際の参照元は Applied Loop の外が主体
だった: `~/.claude/CLAUDE.md`・`~/.claude/codex/AGENTS.md`・workbench の
my-copy skill `my-copy-harness-prefix-pack` の3系統のうち2系統が Applied
Loop 外にあり、グローバル設定が特定プロダクトの docs を指す逆依存になって
いた。Applied Loop を将来リネーム・アーカイブ・移設すると、正典参照が
同時に壊れる単一障害点でもあった。

一方で `~/.claude`（llm-config）はすでに `docs/filing-rules.md` や
`rules/*.md` という横断規約のハブとして機能しており、`CLAUDE.md` に
`@import` を持たないため `docs/` 配下を置いてもコンテキスト膨張しない。

## 決定

ADR-0017 §2「共有パックの置き場」を以下に置き換える。§1・§3・§4 と
「理由」「結果・トレードオフ」は変更しない。

- 正典: `~/.claude/docs/harness-pack/`（llm-config リポジトリ内、版管理）
- Applied Loop リポジトリの `docs/harness-pack/README.md` は正典への
  短いポインタのみを残す（テンプレート本体は置かない）
- 配布・適用手順: my-copy skill `my-copy-harness-prefix-pack`
  （変更なし。参照パスのみ llm-config 側へ更新）

## 理由

- 参照元の主体が Applied Loop の外にあり、実行時依存もゼロなので、
  移動によって失うものがない
- llm-config は既に横断規約のハブとして機能しており、置き場として自然
- Applied Loop の単一障害点を解消できる

## 影響を受けないもの

`/harness`・`/harness/prescriptions/[repo]`・`/harness/concepts/prompt-cache`・
MCP `suggest_cache_prefix_fix` などの観測・局所処方（ADR-0017 §3）は
Prisma `HarnessRun` と Next.js runtime に束縛されており、Applied Loop に
据え置く。`cache-prefix-prescription.ts` のハードコードされた `checklist`
も同様に維持し、正典との同期はコードコメントで明示する（人力監査）。

## 出典

- ADR-0017 プロンプトキャッシュ節約パック（実行層）
- 2026-08-20/21 の横断ハーネス重複調査（Opus 調査、`propose-harness-prefix.mjs`
  の実質デッドコード化・4箇所チェックリスト重複・Applied Loop 自身の
  AGENTS.md 非準拠も同時に発見・是正）
