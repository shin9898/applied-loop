---
type: decision
status: accepted
date: 2026-08-24
tags: [skills, cs, repo-ownership, multi-repo]
source_refs: [docs/adr/0030-global-layer-entry-criteria.md, docs/adr/0023-release-video-canon-layered-split.md]
---

# ADR-0031: dogfooding charter の用途をCS向けハンズオン手順へ転換し、Python層を廃してmy-copyへ移す

## 背景

ADR-0030 の「次のアクション1」として `triple-dogfooding-charter-generator` の行き先を
決める必要があった。想定していた3択は (a) my-copy へ規約適合させて移設 /
(b) skill内 `scripts/` 配置を新前例として認める / (c) グローバル据え置き。

一次調査の結果、**この3択の前提そのものが崩れた**。

### 実態(実測)

- 構成は計 2,177行 — SKILL.md + `references/` 4本(903行)+ Python 5本(1,274行)。
  Python の public 関数は15本
- **実使用がほぼゼロ**: `~/.claude-dogfooding-config.json` の `first_run_at` は
  2026-05-15、`last_runs` は1件のみ(TRIPLE REPORT / rotation / 2026-05-15)。
  生成物(xlsx/csv)を `~/Desktop`・`~/Documents`・`~/Downloads`・`~/archive`・
  `~/Movies` で捜索して0件。`~/.config/triple-dogfooding/`(Google 認証)は未作成。
  ただし `record-run` は手動ステップなのでこの1件は実回数の下限
- **壊れてはいない**: `uv` 0.11.5 で `xlsx_writer.py` を実行すると PEP 723 が
  `openpyxl` を解決し schema validation が正常に動作する(不正な probe JSON を
  正しく reject)。「壊れているから削除」という選択肢は成立しない

### (a) の隠れコスト

my-copy の runtime 依存は `pyyaml` **1本のみ**。移設すると `openpyxl` +
`google-auth` + `google-auth-oauthlib` + `google-api-python-client` の**4本増**で、
うち `google-auth-oauthlib` は**対話的OAuth同意フロー**を持ち込む。加えて
my-copy には PEP 723 inline script の前例がゼロで、
`[tool.setuptools] packages = ["scripts"]` の installed package モデルと噛み合わない。

### (b) の機構的欠陥

`scripts/regenerate_readme.py` は **`scripts/*.py` を glob** して module docstring から
README を自動生成する。skill内 `scripts/` は拾われない。EXTENDING.md の
「配置・命名: `scripts/<feature>.py`」は慣習ではなく**機構的要件**だった。

### ADR-0030 の条文との緊張

`detect_product.py` は9プロダクトのrepo名レジストリを持つので**条文上は違反**。
しかし ADR-0030 の根拠(「cwdが前提と一致しているセッションでのみ正しく、それ以外で
静かに誤動作する」)には該当しない。実行確認では未知のrepo(workbench)から
`product_name: null` を返して壊れない = **cwdを前提とせず検出する設計**で、
repo名は「前提」ではなく「照合テーブル」である。

### 用途を見直した結果

「実装した内容のQAテスト構築」と「CSがユーザー接点だけを触って機能を理解する手順」の
2用途が候補に挙がった。調査すると:

- **用途1(QAテスト構築)は `qa-checklist` が完全にカバー済み**。ブランチ名 →
  `gh issue view` → `git diff main..<branch>` → FEの画面・コンポーネント・ルート特定
  → 6カテゴリのテスト項目 → Slackコピペ形式。トリガー語に「CS向けテスト」を含む
- **「ユーザーに関わる部分だけを切り出す」抽出ロジックは既に2箇所にある**:
  `qa-checklist` Step 2 と `release-video` [1](CS向け基準 = ユーザーの操作・見た目・
  挙動が変わるものだけ)。`release-video` は文言を実画面から完全一致で転写し
  クリック対象の DOM も確認するので、操作手順の材料は既に揃っている
- **空いているのは出力形式のみ**:

  | | 受け手 | 媒体 | 行為 |
  |---|---|---|---|
  | `qa-checklist` | CS | Slackテキスト | 検証する(pass/fail) |
  | `release-video` | CS / ユーザー | 動画 | 見る |
  | **本ADRの対象** | CS | 手順 | **自分で触って理解する** |

探索的テストの charter は本来「ペルソナXとしてゴールYで触ってみて」という**体験の設計**
であり、pass/fail の一覧ではない。charter という形式は「触って理解する」用途に元々向いている。

## 決定

1. **用途1(QAテスト構築)は実装しない**。`qa-checklist` に委ねる
2. `triple-dogfooding-charter-generator` を **「CS向け機能理解ハンズオン手順」へ用途転換**し、
   `my-copy` へ移す
3. **Python 5本(1,274行)は移設しない**。writers 3本(xlsx/csv/gsheet)は「配って終わり」の
   運用を選んだため不要。`git_info.py`・`detect_product.py` は既存2skillが同等の抽出を持つため不要
4. 核となる資産は **`references/` 2本**(`persona_extraction_guide.md`・
   `charter_template.md`)。**プロダクトは引数で受け、repo名レジストリを持たない**
5. 抽出ロジックは新規実装せず、`qa-checklist` / `release-video` の既存経路を参照する
6. Python を持たないため EXTENDING.md §1.5 の **resource-only skill** として作る
   (CLI規約・`--json`/`--no-write`・pytest・config は対象外。frontmatter と §13 のみ適用)

## 理由

- 実績1回・生成物ゼロの機能のために、my-copy の依存面を1→5本(OAuth込み)に広げるか、
  PEP 723 という第2実行モデルを新設するのは釣り合わない
- (b) は README 自動生成という**現に動いている機構**に穴を開ける前例になる
- **用途転換により (a) の障害が消える**: writers を落とせば依存は `pyyaml` のまま、
  PEP 723 も README glob も無関係になる。「移設できないから据え置く」ではなく
  「移設すべき形に絞ったから移設できる」という順序
- **同時に ADR-0030 の条文との緊張も消える**: プロダクトを引数化すれば repo名レジストリが
  不要になり、cwd非依存の跨プロダクト導線 = ADR-0030 の第3層に正しく収まる。
  書いた直後の条文を緩めずに済む
- **却下: 抽出ロジックを新skillに実装する** → `qa-checklist`・`release-video` に続く
  3箇所目になる。ADR-0023 が記録した「既存導線を確認せず新設して二重化」と同型

## 結果・トレードオフ

得るもの: my-copy の依存面が変わらない / 実行モデルが1つのまま / README自動生成が機能する /
ADR-0030 に例外を作らない / 空いている出力形式(CSハンズオン)を埋める。

意図的に失うもの:

- **動作する Python 5本 1,274行を廃棄する**。用途1は既存skillが持ち、用途2には不要という
  判断だが、コード自体は動く状態で捨てる
- **実施結果の記録機構を持たない**。`gsheet_writer.py` の charter catalog +
  execution log の2シート構成は「複数人に配って結果を残す」用途に活きたが、
  「配って終わり」の運用を選んだため落とす。後で必要になれば別途決める
- **抽出を既存2skillに依存する**ため、`qa-checklist`・`release-video` の出力形式が
  変わると追従が必要になる

## 影響を受けないもの

- `qa-checklist`・`release-video`・`release-delivery`・`my-copy-cs-launch-prep` の
  現行の使い方
- ADR-0030 の判定式そのもの(緩めない)

## 次のアクション(実装は別セッション)

1. 新skillの設計を固める — 入力(何を受けるか)、出力形式(Slack / テキスト /
   Google Doc。`my-copy-cs-launch-prep` が既に Google Doc 経路を持つ)、
   `qa-checklist`・`release-video` からの受け渡し形式
2. my-copy へ resource-only skill として新設 + frontmatter を Anthropic パターンに
   (現行 description の末尾「Always reads docs/specs/... never invents business context
   from memory.」は workflow 要約で §1 の禁止事項に触れるため落とす)
3. `~/.claude/skills/triple-dogfooding-charter-generator/` の削除。**破壊的操作なので
   事前にリスト提示 → koki 承認 → koki 実行**(`rm -r` は Auto Mode classifier が
   ブロックする)
4. `~/.cursor/skills/<name>` symlink(provider parity 規約7)と Codex adapter 生成、
   plugin version bump

## 出典

- 2026-08-24 一次調査: 全ファイル実測(2,177行 / public関数15本)、
  `~/.claude-dogfooding-config.json` 実物、スクリプト3本の実行確認(exit code 含む)、
  `my-copy/pyproject.toml`、`EXTENDING.md` §1.5・§2・配置命名、
  `regenerate_readme.py` の glob、`qa-checklist`・`release-video` の SKILL.md
- **前ENTRY記述の訂正3点**: 「docstring欠落2本」は誤り(5本すべてに module docstring
  あり。gsheet/xlsx は PEP 723 ブロック直後) / 「`--json` 全未実装」は
  `detect_product.py`・`git_info.py` が既定でJSONのみを出力するため実質は形式適合の話 /
  `--validate-only` が csv・gsheet・xlsx の3本に既存で `--no-write` 相当。
  実在する規約差分は exit code(schema validation 失敗が `2`、規約は `1`)
- ADR-0030「次のアクション1」を消化
- 前例: ADR-0023(ツールの位置と役割の再定義、および「宣言だけして実行導線を
  書き換えない」失敗の回避)
