# Applied Loop 事業化戦略（2026-08 調査）

- 日付: 2026-08-16
- 調査範囲: src 全量（約28,000行）/ prisma スキーマ / scripts / docs 全量（ADR 20本含む）/ 2026年の市場環境
- 進行トラッキング: GitHub Issues「90日プラン」（本ドキュメント末尾参照）

---

## 結論（TL;DR）

- **プロダクトの筋は良く、市場のタイミングも良い。**「AIで書けるが説明できない」問題は2026年に実証研究（Anthropic RCT・17pt差）とメディア報道で顕在化した成長市場。誤解のライフサイクル管理という差別化も本物。
- **ただしマネタイズの構成要素はゼロ。**課金・認証・ユーザー概念・LICENSE・需要計測、すべて存在しない。一番の欠落はコードではなく**「需要の証拠」**。
- **いきなり SaaS 化しない。**現在の BYO-LLM 設計（採点コストをユーザー自身の CLI サブスクが負担）は運営コストほぼゼロの優れた構造。これを捨てずに「ローカル無料 + クラウド付加価値サブスク」の段階戦略を取る。
- **90日でやることは3つ。**①残り検証3件（B10-3 / B10-4 / C4-2）を完了して配れる状態にする、②LP・ブログ・waitlist で需要を計測する（waitlist 実装は既にあるのに未接続）、③LICENSE 等の配布前提を整える。

## 1. 現状診断

「1人の開発者が自分のために作った、商用レベルの完成度を持つローカル専用ツール」。

### 強み（資産になるもの）

- **BYO-LLM のコスト構造。**採点をユーザー自身の Claude / Codex CLI サブスクで行うため運営側トークンコストゼロ。フリーミアム配布と相性が抜群。
- **移行への備え。**`requireAuth()` 57箇所差し込み済み、DB アダプタ分離、JST 固定の TZ 非依存化、クラウド同期除外カラム注記、Reachable MCP 先行実装。
- **意思決定の記録。**ADR 20本とブログドラフトはそのまま技術発信＝集客コンテンツになる品質。
- **計測装置。**Activation ファネル7点、採点一貫性スポットチェック、golden test。

### 現在地：残りは「人間の検証」3件のみ

| 残タスク | 内容 | 意味 |
|---|---|---|
| B10-3 | 同僚1名の無介入ウォークスルー | P1 完了条件。他人に渡せる証明 |
| B10-4 | Claude 以外のハーネスでの検証 | 特定 LLM 依存でないことの証明 |
| C4-2 | 実装量の多い1日でのセルフラン | P4 コアループの実証 |

## 2. 市場環境

- **問題の実証:** Anthropic RCT（2026-02, n=52）で AI 支援群の理解テスト 50% vs 手書き 67%（17pt差）。product-brief の根拠研究そのものが市場の関心事に。
- **skill atrophy が語彙として定着。**開発者の80%超が AI コーディングツールを使用。
- **競合はまだ弱い:** 報道された [Atrophy](https://github.com/ashutosh-rath02/atrophy)（OSS CLI, Elo式ドリル）は「汎用の筋トレ」型。vibe-learn / EngramQuest 等も説明・フラッシュカード止まり。**「自分の実コミットを材料に、誤解を open → resolved → regressed で追跡し続ける」形は空席。**
- **教訓:** 2026年のインディー開発は約半数が MRR $0〜1K。ボトルネックは開発力でなく**配布**。Applied Loop は「作る」が済み「届ける」が未着手の典型。

> 含意: 需要の証拠を持っているのは競合の側。今の優先順位は機能追加ではなく需要の証拠づくり。

## 3. マネタイズに足りないもの（深刻度順）

| # | 欠落 | 現状 | 対処 |
|---|---|---|---|
| 1 | LICENSE がない | README は clone を促すが未指定＝All Rights Reserved | FSL または AGPL + 商用例外を推奨 |
| 2 | 需要計測ゼロ | `WaitlistSignup` / `joinWaitlist()` は実装済みなのに LP にフォームがなくデッドコード。ブログもスクショ待ちで未公開 | LP にフォーム接続（半日）、Zenn 公開（1日） |
| 3 | 配布の摩擦 | Node≥20 + 2ポート + CLI ログイン + クライアント別 MCP 登録。初回30分 | 1コマンドインストーラ → デスクトップアプリ |
| 4 | 課金・決済・アカウント | 皆無（全17モデルに userId なし） | ローカル配布の間は MoR 型（Polar / Lemon Squeezy）のライセンスキーで十分 |
| 5 | クラウドで動かない構造 | 採点=CLI サブプロセス、供給=ローカル git hook + `git show`、状態=`~/.applied-loop/`、SQLite | SaaS を選ぶ場合のみ。差し替え点は整理済み |
| 6 | 配布に耐えるセキュリティ | `MCP_TOKEN` 未設定で `/api/events` 等が無認証素通り。terminal 許可リストに `bash`。`watch_repos` が MCP 経由でシェル実行 | 配布前に既定値をセキュアに |
| 7 | CI がない | Actions ゼロ。MCP 22ツール・API・Server Actions 未テスト | lint + test の Actions を先に |

**商用化前のリスク:** ドラクエ想起の語彙・演出（ぼうけんのしょ／じゅもん等）は無料 OSS なら実務上問題になりにくいが、課金開始で商標・不正競争のリスクが変わる。マネタイズ段階では Living Atlas 側の独自世界観へ置き換える（DQ語＋一般語並記の抽象化は着手済みで土台あり）。

## 4. 推奨マネタイズ戦略 — BYO-LLM を捨てない段階設計

フル SaaS は採点コストが運営持ちになり、認証・GitHub App・マルチテナントの全面書き換えを要するため、需要の証拠なしに着手しない。

### Stage 0: 需要の証拠づくり（いま〜1ヶ月・¥0）

- 残り検証3件（B10-3 / B10-4 / C4-2）完了
- LICENSE 決定（FSL か AGPL。純 MIT は後から閉じられない）
- LP に waitlist フォーム接続（GitHub Pages 版にも Formspree 等で）
- ブログのスクショ4枚 → Zenn 公開。以後 ADR を種に月1〜2本
- **判断基準を先に決める:** 例「3ヶ月で waitlist 100件 or GitHub スター300」

### Stage 1: 配布摩擦を削る（1〜3ヶ月）

- `npx applied-loop init` 一発セットアップ（30分→10分）
- opt-in 匿名テレメトリ（activation 7点のみ。本文を読まない不変条件は堅持し訴求点に）
- GitHub Sponsors 開設
- 英語 README + LP 英語版（skill atrophy の震源地は英語圏）

### Stage 2: Pro ライセンス（3〜6ヶ月・目標 MRR ¥5〜15万）

コアループは無料のまま、Pro に:

- **理解ポートフォリオ出力** — 解消した誤解・ルーブリック評価・適用証跡を面接/評価面談用に整形エクスポート（最も自然な有料機能）
- 週次音声ナレーションの製品化、複数リポジトリ横断の弱点分析、ハーネス処方の高度版
- 決済は Polar / Lemon Squeezy（MoR）+ ローカルのライセンスキー検証。買い切り ¥6,000〜9,800 か月額 ¥980 / $8 程度から

### Stage 3: クラウドコンパニオン → チーム（6ヶ月〜・証拠が出た場合のみ）

- 採点はローカルに残し（BYO-LLM 維持）、クラウドは同期・閲覧・通知のみ。ADR-0018 の「ローカルエージェント + アウトバウンド WSS」構想が設計図。月額 ¥1,500 前後でも粗利が立つ
- 本命の B2B はその先（「AI でジュニアの理解が育たない」への組織課金、$15〜25/席）。ただし「個人が回ってから」の順序は守る

## 5. 機能改善の提案（優先度つき）

### すぐやる（数時間〜1日）

- waitlist を LP に接続（最重要クイックウィン）
- セキュリティ既定値是正: `MCP_TOKEN` 未設定時の素通りを塞ぐ、terminal の `bash` を明示オプトインに
- docs drift 解消: `surface-unlock.md` の存在しないツール（`list_goals` / `link_goal`）、core 5本表記 vs 実装6本、ADR-0003/0004/0005 の `proposed` ステータス
- CI 追加（lint + test。テスト glob を `src/**/*.test.ts` へ）
- ファネルの `first_supply` 欠測穴に補完イベント

### 次にやる（〜1ヶ月）

- 採点の API フォールバック: `runHeadlessLLM` に `ANTHROPIC_API_KEY` 直叩きの第3経路（CLI 未ログインつまずきの回避 + クラウド化の布石）
- 1コマンドセットアップ CLI
- diff の保存（現状は採点のたびに `git show` 再取得 → repo 移動・rebase・worktree 削除で採点不能）
- 「共有できる成果物」: 週次の解消済み誤解カード共有（外発ゲーミフィケーションは避けたまま配布ループだけ作る）
- MCP route 分割（1,550行22ツール単一ファイル → ツール単位モジュール + テスト。`registerTool` モンキーパッチの正攻法化）

### その後（需要が見えてから）

- 理解ポートフォリオ出力（Stage 2 Pro 機能）
- UI の i18n（英語）
- Postgres 移行 + マルチユーザー化（Stage 3 を選んだ場合のみ）
- DQ 語彙の独自世界観への置き換え（課金開始の前提条件）

## 6. 90日プラン

| 週 | やること | 出口 |
|---|---|---|
| 1–2 | C4-2 セルフラン → B10-3 ウォークスルー。並行して LICENSE・waitlist 接続・セキュリティ既定値是正 | P1/P4 完了。配布可能な状態 |
| 3–4 | ブログスクショ → Zenn 公開。CI 追加。B10-4 | 最初の外部流入と計測開始 |
| 5–8 | 1コマンドセットアップ CLI、opt-in テレメトリ、英語 README。発信2本目（ADR-0020 の backlog 実測話） | 「clone してもらえば回る」→「勧めれば入る」 |
| 9–12 | waitlist / スター / activation 完走率で判断: 閾値超え → Stage 2（Pro 設計・決済導入）。未満 → dogfood 継続 + 発信で再挑戦 | データに基づく投資判断 |

## 出典（市場環境）

- [Anthropic Study: AI-Assisted Devs Score 17% Lower on Code Comprehension](https://serenitiesai.com/articles/ai-coding-skills-anthropic-research-2026)
- [The Anthropic coding-skill study: what developers should take away](https://learn.senwitt.com/blog/anthropic-coding-skill-study-what-developers-should-take-away/)
- [The Register: Avoid AI atrophy](https://www.theregister.com/ai-and-ml/2026/07/07/avoid-ai-atrophy-new-tool-promises-to-reverse-vibe-coding-skills-decay/5267913)
- [GitHub: ashutosh-rath02/atrophy](https://github.com/ashutosh-rath02/atrophy)
- [How Indie Hackers Actually Make Money in 2026](https://www.gladlabs.io/posts/beyond-the-bootstrap-how-indie-hackers-actually-ma-f0a313a9)
- [Indie Hacker in 2026: What It Means + Real Playbook](https://www.betterlaunch.co/blog/indie-hacker)
- [個人開発で始まった「Zenn」はいかにして作られたのか](https://codezine.jp/article/detail/14018)
