---
type: decision
status: accepted
date: 2026-08-24
tags: [skills, harness, multi-repo, repo-ownership]
source_refs: [docs/adr/0022-harness-pack-canon-moves-to-llm-config.md, docs/adr/0023-release-video-canon-layered-split.md]
---

# ADR-0030: グローバル層(`~/.claude`)の入場基準 — cwd依存情報を含む資産は置かない

## 背景

`~/.claude/skills/` と `~/.claude/commands/` に置いた資産は、**cwdが不定の状態で
全セッションにロードされる**。したがってここに何を置くかの判断は、コンテキスト量
だけでなく正しさにも直接効く。

にもかかわらず、**skill/commandの配置スコープを規定する規約が存在しなかった**。
既存の置き場規約は成果物ファイルしか扱っていない:

- `~/.claude/rules/file-placement.md` — LLMが新規作成するファイル・フォルダの置き場
  (プロジェクト一式・書類・データエクスポート等)。skill/command の定義場所は対象外
- `~/folder-audit/filing-rules.md` — 同上。むしろ `~/.claude` を「ツール管理領域」
  としてタクソノミの**外**に置いている(l.42)。skillへの言及は
  `~/archive/skill-packages/`(l.28)だけで、これは配布zipのアーカイブ先であり
  生きたskillの定義場所ではない

規約が無かった結果、2026-08-24の棚卸しでグローバル層に8件の違反が見つかった
(うち7件はこのADRの適用として解消済み、1件が判断保留。内訳は「適用状況」節)。
うち実害が確認できたもの:

1. **誤りが複製されて広がる**: `commands/spec.md` はrepo名をハードコードしており、
   しかもその値が誤っていた(228・230・255行で `triple-three-inc/triple-report-mirror`
   = 無関係な放置サンドボックスrepoを参照)。`/spec` は既に6リポジトリでrepo-local版に
   複製されており、グローバル版はその系譜の**最古のスナップショット**。
   triple-onboarding・triple-report-monoの2箇所が `.agents/skills/` 経由のsymlinkで
   この誤repo名バグを継承していた
2. **参照先が消えても静かに壊れる**: `skills/engagement-issueize` / `-polish` は
   必須の進捗doc 3本が実在せず既に不発だった。しかもそれらのdocは `.git/info/exclude`
   でマッチし `git log --all` にも痕跡ゼロ = 復元不可のローカル作業ファイルだった。
   skillのロード自体は常に成功するため、不発は検出されないまま残っていた

## 決定

グローバル層(`~/.claude/skills/`・`~/.claude/commands/`)への入場基準を次の1行とする。

> **cwdに依存する情報(repo名・ディレクトリ構成・board名・進捗docパス)を含む資産は、
> グローバル層に置かない。**

基準を満たさない資産は、性質に応じて4層に振り分ける。

| 資産の性質 | 行き先 | 受け皿の状態 |
|---|---|---|
| 単一repo固定 | repo-local (`<repo>/.claude/`) へ移設、または削除 | 既存 |
| 複数プロダクトで同型だがrepo名非依存にできない | `product-template` | 既に正典 |
| 跨プロダクト導線で、cwd非依存に書き直せる | `my-copy` plugin | 稼働中 |
| 個人ツール(プロダクト非依存) | グローバル据え置き | 現状のまま |

**新規機構はゼロ**。受け皿3種すべてが既に稼働している。

## 理由

- **判定式が1行であることが要件**。グローバルに置いてよいかの判断はskill追加のたびに
  発生するため、チェックリストではなく単一の問いに落とす必要がある。実際にこの1行で、
  棚卸しで解消した7件(commit `a851e71` の4件 + `ef4191e` の3件)と残存1件の
  すべてを判定できた
- **なぜcwd依存が禁止事項になるか**: グローバル層はcwdが不定の状態でロードされる。
  cwd依存情報を含む資産は「cwdが前提と一致しているセッションでのみ正しい」ものになり、
  それ以外では静かに誤動作する(誤ったrepoへPRを向ける、存在しないdocを参照する)。
  ロード自体は常に成功するので、失敗が失敗として現れない
- **却下: グローバルに置いて条件分岐させる**。分岐条件がrepo名の列挙になり、repo追加の
  たびにグローバル層の更新が必要になる。今回の `spec.md` の誤repo名ハードコードは、
  まさにこの形の失敗が実現した姿
- **却下: 全部my-copyへ集約する**。**コンテキスト削減にはならない** —
  `~/.claude/settings.json` でmy-copyがuser scope有効になっており、68 skill(実測)が元々
  全セッション常時ロードされている。my-copy化で買えるのはversioning・テスト・
  README同期・Codex adapter生成のgovernanceだけで、cwd依存性そのものは解決しない。
  層の選択とmy-copy化は別の軸

## 結果・トレードオフ

得るもの:

- 誤りの複製経路を断つ(グローバル層 → repo-local複製 → symlink継承の連鎖)
- 静かな誤動作の予防(ロード成功だが前提不一致、という検出できない失敗)
- 判断コストの単一化(skill追加時に問う質問が1つ)

意図的に失うもの:

- 中間層(複数プロダクトで同型)は `product-template` 経由になるため、fork先への反映に
  手作業の伝播が必要になる
- **判定式は基準としては十分だが、grepで完全に機械化できない**。実測: 現在のグローバル
  資産13エントリ(`skills/` 9 + `commands/` 4)にrepo名・既知パスのgrepをかけると違反は1件
  (`triple-dogfooding-charter-generator`)しか出ない。しかし `commands/skill-create.md`
  は `src/db/schema.ts`(Drizzle型スキーマ)・`src/components/index.ts`(barrel export)
  という**一般的に見えるパス**を例示しており、実際の4プロダクト(Go backend +
  `packages/*`)のどれにも該当しない。repo名を含まない「架空のスタック前提」は
  パターンで拾えないため、lint化はできず人力判断が残る

## 影響を受けないもの

- `my-copy` 内部の規約(`my-copy/docs/my-copy-extension.rule.md` / `docs/EXTENDING.md`)。
  あちらはmy-copyに入った**後**のfrontmatter・CLI規約・pytest・provider parityを扱い、
  層の選択そのものは扱わない
- `file-placement.md` / `filing-rules.md` の成果物ファイル規約。対象が別
- repo-local の `.claude/` に置かれた資産の中身。本ADRはグローバル層の入場基準のみを
  規定し、各repoが自repo向けに何を置くかには関与しない

## 適用状況(2026-08-24時点)

- **Phase 0(削除)完了**: `commands/spec.md`(誤repo名)・`commands/e2e.md`(移設のため)・
  `skills/engagement-{issueize,polish}`(既に不発) → `~/.claude` commit `a851e71`。
  `~/.agents/skills/` の対応4件も削除(非git・復元不可のため事前に明示して実行)
- **跨プロダクト導線3件をmy-copyへ移設完了**: `qa-checklist`・`insyoku-research`・
  `meeting-to-issues` → workbench `91ce95b`(my-copy 0.12.13) / `~/.claude` `ef4191e`。
  ADR-0023が記録した「宣言だけして実行導線を書き換えない」失敗を避けるため、
  `meeting-to-issues` 内の `/qa-checklist` 参照を `my-copy:qa-checklist` へ更新し、
  provider parity(`~/.cursor/skills/` symlink)も同時に作成した
- **repo-local化2件マージ済み**: triple-report PR #1327(`/e2e` をrepo-local化、merge `e9487bdc`)・
  triple-onboarding PR #626(`spec` 誤repo名修正)
- **残存違反1件**: `triple-dogfooding-charter-generator`。`triple-ats` 等のorg固有
  レジストリと `src/features/check-status/...` の実パスを保持している。ただしPython 5本
  (1,274行)をバンドルしており、my-copyにはskill内 `scripts/` の前例がゼロ
  (80本すべてplugin直下に集約しCLI規約・docstring・pytestの対象)なので、行き先の判断は
  規約適合作業の規模とセットで保留中

## 次のアクション

1. `triple-dogfooding-charter-generator` の行き先決定 —
   (a) Python 5本をmy-copy規約に適合させて移設 (b) skill内scripts配置を新前例として
   認める (c) グローバル据え置き
2. 判定式を**運用ルール**として `~/.claude/rules/` に1本化する。本ADRは決定の記録で
   あり、セッション常時ロードされる運用ルールは別ファイルが必要
   (※`~/.claude` は現在他セッションによる未コミット再構成11件が進行中のため、
   それが落ち着いてから)
3. `commands/skill-create.md` の架空スタック前提の是正 —
   判定式のgrep形では拾えない型の実例

## 出典

- 2026-08-24 実コード調査 + Opus設計調査(Fableは月間支出上限で停止、既定通りOpusへ切替)。
  一次結論に5点の事実誤認があり、うち2点(`spec.md` のrepo名ハードコード、
  engagement系が既に不発)は資産の分類そのものを変えた
- `~/.claude`(llm-config) commit `a851e71`・`ef4191e`、workbench commit `91ce95b`
- triple-report PR #1327、triple-onboarding PR #626(squash `35837d39`)
- 既存規約のギャップ確認: `~/.claude/rules/file-placement.md`、
  `~/folder-audit/filing-rules.md` l.28/l.42、`~/.claude/rules/` 全6本のgrep
- 前例: ADR-0022(正典移動+ポインタ化の型)、ADR-0023(宣言だけして実行導線を
  書き換えないと無効化される)
