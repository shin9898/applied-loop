---
type: decision
status: accepted
date: 2026-08-02
tags: [goal, mcp, inbox, llm]
source_refs: [docs/product-brief.md, docs/adr/0008-goal-dashboard.md, docs/adr/0010-action-surface-mcp.md]
---

# ADR-0012: Goal OS ハーネスと Inbox 自動トリアージ

## 背景

product-brief v4 の「目標の Goal OS ハーネス化」と「G Inbox 自動トリアージ」。

- 目標: v3 の手動登録フォームは二重管理で friction。ユーザーの H2 目標は
  Goal OS (Obsidian vault 内) に既に存在する。LLM が読んで構造化提案し、
  承認制で登録する流れに変える
- Inbox: アクションの MCP 集約とハーネス観測の追加で Capture 候補が
  増えるため、手動 accept/skip は破綻する。LLM スコアリング +
  高信頼度の自動 accept を段階導入する

## 決定

### 1. Goal OS ハーネス (目標登録フロー)

- Goal OS の所在: Obsidian vault (`~/Knowledge/koki-central`) 内の
  目標管理ドキュメント。**場所の探索は LLM (セッション側) が行う**
  (Applied Loop サーバーは vault の構造を知らない・知る必要がない)
- フロー:
  1. ユーザーがセッションで「H2 目標を登録して」と依頼
  2. LLM が Goal OS ドキュメントを読み、目標を構造化提案
     (title / period / kdi / focusDomains)
  3. ユーザーが内容を承認・修正
  4. MCP ツール `register_goals` (ADR-0010) で登録
- スキーマ: `Goal.focusDomains String?` (JSON: ["PdM", "MCP"] 等。
  LLM 紐付け提案の精度向上に使う)
- 目標のカスタマイズ (KDI 調整・focusDomains 更新) も
  MCP ツール `update_goal` で対話的に行えるようにする
- アプリ側の目標登録フォームは撤去 (ADR-0010 §3)

### 2. Inbox 自動トリアージ (G)

- スキーマ: `Capture` に `importanceScore Int?` (0-100) と
  `triageReason String?` (LLM の根拠) を追加
- トリアージの実行:
  - `capture_learning_candidate` 受付時に `after()` で
    ヘッドレス LLM がスコアリング (非同期。応答は即返す)
  - スコア基準 (プロンプトで指示): 非自明性 / 再利用性 /
    誤解につながる可能性 / 既存 Entry との重複
- 自動化の段階導入:
  - **Phase 2 時点**: スコアと根拠を記録するのみ。
    accept/skip は引き続きユーザー (triage_inbox)。
    briefing でスコア順に提示して仕分けを助ける
  - **移行条件**: 2 週間運用し、スコア 80+ の候補に対する
    ユーザーの accept 率が 9 割を超えたら `llm_auto` (自動 accept) を
    有効化する。自動 accept されたものは「自動登録」バッジつきで
    一覧に出し、取り消し可能にする (可逆性)
- スコアリングの LLM コストは 1 候補 1 回の軽量呼び出し
  (採点より小さいプロンプト)

### 3. morning_briefing との統合

- briefing の受信箱セクションをスコア順ソートに変更し、
  各候補に importanceScore と根拠を付記
- 「仕分けは triage_inbox で」と誘導 (ADR-0010 §2)

## 却下した案

- **サーバー側から vault を直接読む案**: vault パス・構造への
  依存とプライバシー境界の複雑化を招く。読むのは LLM (ユーザー環境)
  で、サーバーは構造化された登録データだけを受け取る
- **初日からの llm_auto 有効化**: スコアリングの精度が未検証。
  誤自動 accept は Inbox への信頼を毀損する。2 週間の観察期間を置く
- **importance の 5 段階ラベル化**: 0-100 の数値の方が
  運用中の閾値調整が容易。表示時に「高/中/低」へ丸めるのはあり
