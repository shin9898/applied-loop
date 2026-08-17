---
type: decision
status: accepted
date: 2026-08-01
tags: [gate, architecture, privacy, nsm]
source_refs: [docs/product-brief.md, docs/adr/0005-mcp-distribution.md]
---

# ADR-0006: 理解度ゲート — イベント駆動の発火とアプリ側回答サーフェス

## 背景

product-brief v2 でピボットした核心機能「理解度ゲート」の技術設計。
Fable レビュー (2026-08-01) の 4 条件と 3 論点の決着を実装可能な形に落とす。

- 条件 1: 出題・回答・採点はアプリ側。エージェント会話に出題しない
- 条件 2: 発火は hook から API への直接 POST (deterministic)
- 条件 3: コードは信頼済み LLM プロバイダの境界を越えない
- 条件 4: NSM = 解消された誤解数 (72h ルール)

## 決定

### 全体フロー

```
git post-commit hook (薄い)
  → POST /api/events { kind, repo, ref, summary }        (1. イベント記録)
  → サーバー側で発火判定 (重複排除 + 抑制)                 (2. 発火判定)
  → 出題生成ジョブ: ヘッドレス CLI で diff → 問い生成      (3. 出題)
  → Gate (pending) 作成 → ダッシュボード/朝ブリーフで通知   (4. 通知)
  → ユーザーが Gate ページで回答                           (5. 回答)
  → 採点ジョブ: ヘッドレス CLI で合否 + 誤解概念抽出       (6. 採点)
  → failed なら Misconception (open) 作成                 (7. 誤解記録)
  → 72h 後に再出題 → passed で resolved                  (8. 再帰)
```

### 1. イベント収集 (`POST /api/events`)

hook からの直接 POST を受ける API Route。MCP と同じ Bearer 認証を使う。

```json
{ "kind": "commit", "repo": "applied-loop", "ref": "a1b2c3...",
  "summary": "add gate page" }
```

- `kind`: `commit` (v1 はこれのみ)。将来 `pr_merged` 等
- `repo`: リポジトリ名 (git rev-parse --show-toplevel の basename)
- `ref`: commit sha。重複排除キー
- オフライン等で POST 失敗時は hook 側が `~/.applied-loop/event-queue.jsonl`
  に追記し、次回成功時にまとめて送る

**hook の配布**: git の `core.hooksPath` を使わず、各リポジトリの
`.git/hooks/post-commit` に数行のシェルを置く。リポジトリの
トラッキングファイル (CLAUDE.md 等) は一切触らない。
セットアップは `applied-loop setup hooks` 的な CLI スクリプトで行い、
既存の post-commit hook がある場合は追記で共存する。

### 2. 発火判定 (サーバー側集約)

イベント受信時に判定。v1 の抑制ルール:

- 重複排除: `(kind, repo, ref)` の unique 制約
- 頻度抑制: 同一 repo で直近の Gate 作成から **4 時間** 未満はスキップ
- 日次上限: 1 日 3 Gate まで
- pending Gate が 5 件以上溜まっていたら新規発火しない
  (回答されない状態で出題し続けない)

判定結果は DevEvent に記録し、「発火したが抑制された」も計測可能にする
(発火点チューニングの材料)。

### 3. 出題生成 (ヘッドレス CLI)

発火したイベントについて、ローカルでヘッドレス CLI を呼び出す:

```bash
claude -p "以下の diff について、書いた本人の理解を試す問いを1つ生成せよ。
対象は「なぜこのコードがこうなっているか」であり、構文の暗記ではない。
JSON で出力: {\"question\": \"...\", \"targetConcept\": \"...\"}
<diff>...</diff>" --output-format json
```

- diff はローカルの git から `git show <ref>` で取得し、
  信頼済みプロバイダ (ユーザー自身の Claude サブスク) にのみ送る
- DB に保存するのは question と targetConcept のみ。diff は保存しない
- 生成失敗時は Gate を作らず DevEvent に記録 (通知は出さない)

### 4. 回答サーフェス (Gate ページ)

`/gates` に一覧、`/gates/[id]` に回答フォーム。
ダッシュボードにも pending Gate の最新 1 件をカード表示する。

- 出題文 + 対象コミットの概要 (repo, summary, sha 短縮)
- 回答は自由記述 (textarea)。「わからない」ボタンも用意
  (わからない = failed として誤解記録へ。罰ではなく救済導線)
- hook 側がエージェント会話に注入するのは最大
  「保留中のゲートがあります: <url>」の 1 行まで

### 5. 採点ジョブ (状態機械)

```
answered → grading → passed / failed
                   ↘ grading_failed → (通知) → ユーザー手動リトライ
                   ↘ (フォールバック) self_graded
```

- 回答保存と同時に即座に採点せず、ジョブとして非同期実行
  (Next.js では Route Handler 内で `after()` または別プロセス起動。
  v1 は `claude -p` を spawn する Route Handler で十分)
- **認証切れ**: リトライせず `grading_failed` + ダッシュボードに通知。
  ユーザーが再ログイン後に手動リトライ
- **パース失敗**: スキーマ固定の出力指示 + 寛容パース + 再試行 1 回
- **最終フォールバック**: セルフ採点 UI (「正解だった/間違っていた」
  を自己申告)。`self_graded` フラグで区別し NSM 計算で識別可能に
- **ルールベース採点への自動フォールバックは禁止** (NSM 汚染防止)

採点 CLI には diff + question + answer を渡し、
`{"passed": bool, "feedback": "...", "misconceptions": ["概念1", ...]}`
を返させる。誤解概念はコード非依存の抽象記述であることを出力指示に明記。

### 6. 誤解ライフサイクル (72h ルール)

```
open --(72h 以上後の再出題で passed)--> resolved
resolved --(再出題で failed)--> regressed (= open に戻る)
```

- failed 採点時: 誤解概念ごとに Misconception を作成 (open)。
  ただし概念が既存の受信箱 (Capture) と同様に **ユーザー確認を経てから
  正典化** する (プライバシー条件 3: 概念は受信箱経由で同期)
- 再出題はスケジューラ起点: Misconception ごとに `nextReviewAt` を持ち、
  72h 経過後に `retry` kind の Gate を生成。以降は SM-2 的に間隔伸長
- **72h 未満の再挑戦** (ユーザーが自発的に「もう一度」) は記録するが
  resolved にはしない (記憶の新鮮さでごまかせないようにする)

### 7. データモデル (Prisma 追加)

```prisma
// hook からの生イベント + 発火判定結果
model DevEvent {
  id         String   @id @default(cuid())
  kind       String   // commit
  repo       String
  ref        String
  summary    String?
  fired      Boolean  @default(false) // ゲート発火したか
  skipReason String?  // dedupe / throttled / daily_cap / backlog / gen_failed
  receivedAt DateTime @default(now())
  gates      Gate[]

  @@unique([kind, repo, ref])
}

// 理解度ゲート (出題)
model Gate {
  id              String    @id @default(cuid())
  eventId         String?
  event           DevEvent? @relation(fields: [eventId], references: [id], onDelete: SetNull)
  misconceptionId String?
  misconception   Misconception? @relation(fields: [misconceptionId], references: [id], onDelete: SetNull)
  kind            String    @default("initial") // initial / retry / sr_review
  question        String
  targetConcept   String?
  answer          String?   // ローカルのみ。クラウド同期から除外
  status          String    @default("pending")
  // pending / answered / grading / grading_failed / passed / failed /
  // self_graded_pass / self_graded_fail / dismissed
  gradeNote       String?   // ローカルのみ
  nextReviewAt    DateTime? // retry/sr_review の出題予定
  createdAt       DateTime  @default(now())
  answeredAt      DateTime?
  gradedAt        DateTime?
}

// 誤解 (コード非依存の抽象概念のみ保存)
model Misconception {
  id          String    @id @default(cuid())
  concept     String
  status      String    @default("open") // open / resolved / regressed
  firstGateId String?
  resolvedAt  DateTime?
  reviewCount Int       @default(0)
  nextReviewAt DateTime?
  createdAt   DateTime  @default(now())
  gates       Gate[]
}
```

### 8. プライバシー実装

- `Gate.answer` / `Gate.gradeNote` はクラウド同期対象外とする
  (Supabase 移行時にカラム単位で同期除外 or ローカル専用テーブルに分離。
  移行時の ADR で確定。schema にコメントで明示しておく)
- diff / 採点コンテキストは DB に一切保存しない
- Misconception.concept は生成時に Capture (受信箱) を経由し、
  ユーザー accept で初めて確定とする

## 理由

- エージェント会話を回答サーフェスにしないことで、プロジェクトルール
  との干渉・カンニング・迎合採点・計測不能を構造的に回避
- 発火判定のサーバー側集約により、発火点を DB のデータを見ながら
  後からチューニングできる (hook 再配布不要)
- git hook は `.git/hooks` に置くためリポジトリのトラッキング
  ファイルを汚染しない。my-copy の hook 所有権とも衝突しない
  (git hook は my-copy が使っていない)
- ヘッドレス CLI は「ユーザーが既に信頼しているプロバイダ」
  という境界を守りつつ BYO-LLM のコストゼロを維持できる

## 結果・トレードオフ

- 得られるもの: 計測可能な NSM / ルール非干渉 / プライバシー境界 /
  発火点の後からチューニング可能
- 失うもの: 会話内即時出題のシームレスさ (ユーザーはアプリを開く
  必要がある → 朝ブリーフとダッシュボードの導線で補う)
- 採点の遅延 (非同期ジョブのため数秒〜数十秒) は
  「採点中」状態の UI 表示で許容する

## 出典

- Fable レビュー (2026-08-01): 4 条件
- Kimi-Fable 議論 (2026-08-01): NSM 先行指標 / プライバシー表現 /
  採点失敗モードの決着
- docs/product-brief.md (v2)

## 追記（2026-08-16）: diffSnapshot のローカル専用保存

§8 の「diff / 採点コンテキストは DB に一切保存しない」を一部変更する。

実測（2026-08-07）で、worktree 削除後に queue flush されたイベント6件が `gen_failed_diff` で恒久に出題不能になった。`git show` による都度取得は repo 移動・rebase・worktree 削除で壊れる。

変更:

- hook がコミット時点の diff（9KB 上限・base64）を payload に添付し、`DevEvent.diffSnapshot` に切り詰め保存する
- 出題生成・再採点は snapshot 優先、git 取得はフォールバック（取得成功時は backfill）
- `gen_failed*` の再試行は `npm run requeue:gen`

プライバシー境界の扱い: `diffSnapshot` は `Gate.answer` / `gradeNote` と同じ**ローカル専用・クラウド同期除外**とする（schema コメントに明示）。「信頼済みプロバイダにのみ送る」境界は変わらない。
