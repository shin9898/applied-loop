---
type: decision
status: accepted
date: 2026-08-02
tags: [mcp, ux, architecture, sr]
source_refs: [docs/product-brief.md, docs/adr/0006-comprehension-gate.md, docs/adr/0007-gate-resources-rubric.md]
---

# ADR-0010: 形態転換 — アクションの MCP 集約・SR 廃止・Obsidian ダイジェスト

## 背景

product-brief v4 の中核決定。開発者の実態は「LLM セッション中心の生活」
であり、アプリのフォーム UI を操作する行為自体が friction。
v3 までの「アプリで回答・登録・承認」は使われない体験だった。

あわせて、v3 まで併存していた SR カード (0-5 自己採点) は
ゲートの思想 (LLM 採点・概念理解+調査力) と哲学が矛盾するため廃止する。

## 決定

### 1. アクションは全て MCP ツールに集約

新規 MCP ツール (src/app/api/mcp/route.ts):

| ツール | 役割 |
|---|---|
| `list_pending_gates` | 出題中ゲートを返す (question / contextSummary / resources / rubric 観点 / gateId)。セッション内回答の入口 |
| `answer_gate` | 回答を受理 (gateId, answer)。Gate.answer に保存し `status="answered"` → ヘッドレス採点を `after()` で非同期起動。**採点結果 (合否) は返さない** (会話中 LLM の迎合・自己採点化を防ぐ)。結果は `get_gate_result` かダッシュボードで確認するよう促す定型文を返す |
| `get_gate_result` | gateId の採点結果 (verdict / feedback / rubric / answerMode) を返す。未採点なら grading 状態を返す |
| `triage_inbox` | Capture の仕分け (captureId, action: accept/skip)。accept 時は既存 acceptCapture と同じ Entry/Misconception 化 + LLM 提案 (goal_suggestions / domain) を `after()` 起動 |
| `approve_goal_link` / `reject_goal_link` | GoalLink の確認待ちを承認 (manual 化) / 却下 (削除) |
| `register_goals` | Goal OS から読んだ目標を登録 (goals: [{title, period, kdi, focusDomains}])。LLM が Goal OS ドキュメントを読み、構造化提案したものをユーザー承認後に呼ぶ。既存 active Goal との重複は title 近似で検出して警告 |
| `suggest_cache_prefix_fix` | repo の cache 再利用率から安定プレフィックス向け advisory 処方を返す（ADR-0017）。強制書き込みしない。適用後は `record_application` で appliedTo に repo |
| `find_related_learnings` | タスク起点ビュー用。クエリ (タスク名・キーワード) に関連する Entry / open Misconception / pending Gate を LLM 検索 (別呼び出し) で返す |

- 既存 `capture_learning_candidate` / `record_application` / `morning_briefing` は維持
- 全ツール Bearer 認証 (既存と共通)

### 2. morning_briefing の刷新

- 「アプリの /gates で回答してください」「アプリを開いて仕分けしてください」
  という誘導文を廃止し、`list_pending_gates` / `triage_inbox` を
  使ったセッション内完結を促す文言に変更
- 「今日の問いかけ」(学び起点) を廃止。
  briefing は「出題中ゲート / 受信箱件数 / 未解消誤解 / 今週の目標証跡」を返し、
  **タスクとのマッピングは LLM 側が `find_related_learnings` で行う** 構成に
  (タスクの正典は Hermes / TODO であり、LLM が既に知っている)

### 3. アプリは読み取り専用に縮小

以下のアクション UI を撤去:

- `/gates/[id]`: 回答フォーム → 撤去 (質問・文脈再現・リソース・採点結果の表示のみ)
- `/goals`: 登録フォーム → 撤去 (一覧・確認待ち表示のみ。承認ボタンも撤去)
- 受信箱セクション: accept/skip ボタン → 撤去
- `/cards`: ページごと削除 (SR 廃止に伴う)

表示用の Server Action 群 (submitAnswer / acceptCapture / createGoal /
approveGoalLink / rejectGoalLink / reviewCard / linkToGoal) は削除し、
同等機能は MCP ツール側に一本化する (二重実装を残さない)。

**例外として残すもの**: `recordResourceAccess` (リソースリンクの
クリック記録。閲覧行為の記録でありアクションではない)、
QuestionCard の「今日は見送る」(localStorage のみ)。

### 4. SR カード廃止 → ゲート一本化

- 移行スクリプト `scripts/migrate-sr-to-gates.mjs`:
  - active な SrCard を `kind="sr_review"` の Gate に変換
    (question = card.question, targetConcept = card.topic,
    scheduledAt = card.nextReview)
  - 移行後に SrCard を削除
- `prisma/schema.prisma` から `SrCard` モデルと `CardReview` を削除
- 反復間隔の可変化 (旧 v1.5 計画の前倒し):
  採点 verdict=pass かつ rubric 全観点 score=2 なら次回間隔を
  延長 (現行の固定 24h/72h に倍率。上限 14 日)、
  部分点以下は従来通り
- morning_briefing の「期限切れカード」節を削除
  (ゲートに一本化されるため)

### 5. Obsidian ダイジェスト (日次 MD 生成)

- `src/lib/obsidian-digest.ts` を新規作成:
  - `generateDailyDigest(dateKeyJST)` が前日分の MD を生成
    (出題・採点結果 / 新規・解消した誤解 / accept された学び /
    目標の証跡 / ストリーク)
  - 出力先: 環境変数 `OBSIDIAN_DIGEST_DIR`
    (例: `~/Knowledge/koki-central/learning/daily/`)。
    未設定時は `docs/digest/` にフォールバック
  - morning_briefing の初回呼び出し時に前日分を `after()` で生成
- MD のみ生成し、Obsidian 側の表示は標準機能に任せる
  (プラグインは作らない。product-brief「やらないこと」)
- my-copy-obsidian-capture との住み分け: capture は単発ノート、
  digest は日次の集約ビュー。digest は専用ディレクトリに書き、
  capture 側の生成物には触れない

### 6. 回答サーフェスの安全弁 (v4 再検討の実装)

- `answerMode` に `"in_session"` を追加 (既存: self / researched)
- セッション内回答でも `accessedResource` 記録は維持
  (リソース URL は list_pending_gates の応答に含め、
  LLM が開いたかを self-report させるのではなく、
  Web アプリ側のクリック記録のみを信用する)
- NSM 計算への影響なし (product-brief NSM 節)

## 却下した案

- **アプリのアクション UI を残す併用案**: 二重実装の保守コストと
  「どちらでやるか」の迷いを生む。MCP に一本化する
- **セッション内で採点結果を即返す案**: 会話中 LLM が結果を
  先回りして話す (迎合) リスク。受理と採点を分離する
- **Obsidian プラグイン化**: EngramQuest の領土。MD 生成に留める
- **SrCard のデータを残したまま併存**: 哲学の矛盾が継続する。
  ゲートへ移行して一括廃止
