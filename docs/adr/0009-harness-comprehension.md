---
type: decision
status: accepted
date: 2026-08-02
tags: [harness, observability, privacy, llm]
source_refs: [docs/product-brief.md]
---

# ADR-0009: ハーネス理解ループ — 観測メタデータの学びへの変換

## 背景

product-brief v3 の④。生成 AI を使うエンジニアは「ただ使う」だけでは
なく、どのハーネス (skill / hook / rule / コンテキスト設計) をどう
改善すれば良くなるかを理解する必要がある。**ハーネス = 生成 AI 時代の
エンジニアが学ぶべき新領域**であり、Applied Loop のコアに含める
（分離案は開発者の再解釈により撤回）。

認知の 4 象限でいうと、ハーネス観測は主に「未知の未知を減らす」
働きを担う: 「そもそも hook が動いていなかった」「コンテキストが
肥大して cache miss していた」ことを可視化する。

## 決定

### 1. 収集するもの = メタデータのみ (プライバシー不変条件)

- **会話本文は一切読まない・送らない**。プロンプト・回答・
  コード断片は対象外
- 収集: モデル名、token 内訳 (input / output / cache read /
  cache create / thinking)、ツール名 (skill / hook / MCP)、
  実行時刻、セッション ID、対象リポジトリ (判別できる場合)

### 2. データソース (v1.5)

| ハーネス | ソース | 備考 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | usage・model・tool_use を含む。最も情報が豊富 |
| Codex | `~/.codex/sessions/*.jsonl` | 構造は実装時に実機調査して確定 |
| Cursor | 対象外 | ローカルに構造化ログがなく取得手段がない。提供手段が出てから検討 |

収集はローカルの定期ジョブ (launchd or 手動実行の CLI) が
jsonl を**増分パース**して `POST /api/harness-runs` へ送信。
送信前にメタデータ以外のフィールドをローカルで落とす。

### 3. HarnessRun モデル

```prisma
model HarnessRun {
  id         String   @id @default(cuid())
  harness    String   // claude / codex
  sessionId  String
  model      String?
  repo       String?
  tools      String?  // JSON: [{name, kind(skill/hook/mcp/builtin), calls}]
  tokensIn   Int      @default(0)
  tokensOut  Int      @default(0)
  cacheRead  Int      @default(0)
  cacheCreate Int     @default(0)
  thinking   Int      @default(0)
  turns      Int      @default(0)
  startedAt  DateTime
  endedAt    DateTime?

  @@unique([harness, sessionId])
}
```

- 1 セッション = 1 レコードに集約して upsert
  （イベント単位では粒度が細かすぎる）
- Bearer 認証は `/api/events` と共通

### 4. 観測 → 学びへの変換 (v1.5 後半)

週次 (または日次) の集計ジョブがパターンを検出し、
コード理解と同じく **Inbox (Capture) に流す**:

- `sourceTool: "harness"` の Capture として候補化
- accept すると Entry（ハーネス改善の学び）または
  Misconception（ハーネスへの誤解）として正典化

検出パターンの例 (閾値は運用でチューニング):

- cache read 率の低下が続く → コンテキスト設計の見直し候補
- 同一セッション内での類似指示の繰り返し (turns 異常) →
  「LLM に誤解を与えている」兆候
- output token あたりの進捗が悪い → 依頼設計 (メテオフォール) の
  学びの機会

### 5. 改善のネクストアクション (v2)

- 蓄積されたパターンから LLM が「どのハーネスをどう変えるか」を
  提案生成。**一次情報 (公式ドキュメントの該当節) へのリンクを
  必ず付ける** — 「教える」ではなく「読むべき場所を指す」
- 改善実施後は次週の観測で効果を確認してループを閉じる

### 6. UI (v1.5)

- `/harness` ページ: 週次 token 推移 (内訳積み上げ)、
  harness/model 別の構成比、検出パターンの一覧
- 効率の数字 (コスト節約額など) を前面に出さない。
  product-brief の「効率厨っぽい数字で殴らない」原則に従い、
  あくまで「理解のための観測」として見せる

## 却下した案

- **会話本文の解析による誤解検出**: プライバシー不変条件に反する。
  メタデータのパターンで代替する
- **Cursor のローカル DB (state.vscdb) からの抽出**: 非公式・
  スキーマ変更耐性なし・利用規約上の懸念。提供手段を待つ
- **リアルタイム収集 (hook でイベント即 POST)**: 既存 hook の
  所有権分離原則に触れやすい。定期ジョブの増分パースで十分
