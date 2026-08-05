---
type: decision
status: proposed
date: 2026-08-01
tags: [mcp, distribution, architecture]
source_refs: [docs/adr/0004-llm-embedded-capture.md]
---

# ADR-0005: MCP は Next.js 内蔵の Streamable HTTP で配布し、捕捉はセッション区切りで誘導する

## 背景

ADR-0004 で LLM ワークフロー埋め込みを決めたが、外部レビュー
（Fable レビュー 2026-08-01）で2つの設計不足が指摘された。

1. 「ツールを公開すれば LLM が自発的に記録する」は成立しない。
   呼ばれない（取りこぼし）か呼ばれすぎる（ノイズ）の二択になる
2. 配布形態（stdio npm / リモート HTTP / ハイブリッド）が未決定で、
   stdio npm 配布を選ぶと Supabase 移行時に作り直しが確定する

## 決定

### 配布形態

MCP サーバーは **Next.js の Route Handler (`/api/mcp`) として内蔵**し、
Streamable HTTP で配布する。接続先 URL で環境を切り替える。

- 自分用: `http://localhost:3000/api/mcp` + 固定トークン。DB は SQLite
- 公開用: デプロイ URL + per-user API キー。コード変更ほぼゼロで移行
- stdio しか対応しないクライアント（Codex 等）には
  `npx mcp-remote <url>` ブリッジを案内する

**stdio npm パッケージ配布は棄却** — Prisma 直叩きの別プロセスは
アプリとのロジック二重化・バージョン齟齬を生み、Supabase 移行時に
認証・DB 接続を作り直す二度手間になるため。

### 捕捉の誘導

主経路は**セッション区切りの一括抽出**とする。
Claude Code の SessionEnd hook + ルールスニペット
（CLAUDE.md / Cursor Rules への追記）で
「会話から学び候補を抽出して capture_learning_candidate を呼べ」と促す。
逐次検出は補助とする。

配布物は 3 点セット: **MCP エンドポイント + ルールスニペット + hook 設定**。

### ツール設計

MVP のツールは最小 3 つに絞る（多いほど LLM の選択が濁る）:

- `capture_learning_candidate` — 候補を受信箱に入れる。
  説明文に発火条件（明示依頼時 or セッションふりかえり時のみ、
  非自明な事実・設計判断の根拠が対象、一般常識や作業ログは対象外）を書く
- `record_application` — 適用記録
- `morning_briefing` — 受信箱未処理件数・今日の問いかけ・期限カードを返す。
  SessionStart hook で日の最初のセッションに表示させ、
  「毎朝開く」のトリガーにする

`suggest_cards` は v1.1 送り。

### 計測

受信箱の accept 率（登録/(登録+無視)）をダッシュボードに表示し、
5 割を切ったらツール説明文をチューニングする運用ループを仕込む。
ignored 候補を DB に残すのはこの計測のため。

## 理由

- アプリと MCP を同一プロセスに置くと、バリデーション・dedupe 等の
  ビジネスロジックが一箇所に集まる
- セッション区切りは my-copy の runtime-labelled events 捕捉と同型で、
  運用実績のある設計に寄せられる
- ロールアウト順序: Claude Code（自分、hook 完全体）→ Cursor（Rules 誘導、
  再現率は落ちる前提）→ Codex（ブリッジ、優先度低）

## 結果・トレードオフ

- 得られるもの: Supabase 移行時の作り直し回避 / 捕捉の再現率 /
  朝のトリガー獲得 / 個人開発に見合う保守コスト
- 失うもの: stdio 直配布の手軽さ（ブリッジ案内で代替）

## 出典

- Fable レビュー (2026-08-01): Critical#2, Major(配布形態/朝トリガー)
