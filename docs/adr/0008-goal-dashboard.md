---
type: decision
status: accepted
date: 2026-08-02
tags: [goal, dashboard, nsm, llm]
source_refs: [docs/product-brief.md]
---

# ADR-0008: 目標ダッシュボード — Goal モデルと証跡の密度可視化

## 背景

product-brief v3 の③。v2 で v2 フェーズ送りだった目標機能を v1 に前倒し。
開発者の要求: 「立てた目標がどの証跡（ナレッジ）によってどのくらい
進んでいるのか見える化したい」。

ただし「進捗率」の数値化は LLM 推定依存で偽の精度感を生むため、
**証跡の密度と種類の可視化 + 週次の定性評価**で代替する
（product-brief「やらないこと」に明記）。

## 決定

### 1. Goal モデル

```prisma
model Goal {
  id        String   @id @default(cuid())
  title     String
  period    String   // "2026-H2" など自由形式
  kdi       String?  // 自由記述 ("週次 Goal OS 運用定着率 80%")
  status    String   @default("active") // active / archived
  createdAt DateTime @default(now())
  links     GoalLink[]
  reviews   GoalReview[]
}
```

### 2. 紐付けは汎用中間テーブル GoalLink

Entry / Gate / Application / Misconception のいずれにも紐付くよう、
各モデルに goalId を足すのではなく中間テーブルにする:

```prisma
model GoalLink {
  id         String   @id @default(cuid())
  goalId     String
  goal       Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  targetType String   // entry / gate / application / misconception
  targetId   String
  confidence String   // manual / llm_suggested / llm_auto
  createdAt  DateTime @default(now())

  @@unique([goalId, targetType, targetId])
}
```

- v1 の紐付け導線:
  - **手動**: Entry / Gate 詳細ページに目標選択 UI
  - **LLM 提案の確認制**: キャプチャ accept 時や採点後に LLM が
    active な Goal への紐付けを `llm_suggested` で提案し、
    ダッシュボードの「確認待ち」でユーザーが 1 クリック承認/却下
- v1.5 で `llm_auto`（高信頼度は自動承認）に移行
- 中間テーブルなので、1 つの学びが複数目標に紐付くのも自然に表現できる

### 3. ダッシュボードに表示するもの (目標ごと)

- **今週の証跡**: 紐付いた Entry 数 / Application 数 /
  解消した Misconception 数の 3 種を週次で集計
- **証跡リスト**: 直近の紐付きアイテム（タイトル + 種別 + 日付）
- **最新の週次評価**: GoalReview のコメント
- **出さないもの**: 進捗率・パーセント・バー

### 4. 週次定性評価 (GoalReview)

```prisma
model GoalReview {
  id        String   @id @default(cuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  weekKey   String   // "2026-W31" (JST 基準)
  comment   String   // LLM の定性コメント (根拠つき)
  createdAt DateTime @default(now())

  @@unique([goalId, weekKey])
}
```

- 週次 Goal OS のタイミング (または週初の morning_briefing 初回) に
  ヘッドレス LLM へ active な Goal ごとの今週の証跡リストを渡し、
  「この目標は進んでいるか」を根拠つきの定性コメントで生成
- 証跡 0 件の週は LLM を呼ばず「証跡なし」と記録（コスト節約 +
  「動いていない」ことが最も重要なシグナルなので明示）

### 5. UI

- 新規ページ `/goals` (目標一覧 + 登録) と `/goals/[id]` (目標詳細)
- 目標詳細の構成: KDI 表示 / 今週の証跡 3 種カウント /
  証跡タイムライン / 週次評価の履歴
- ダッシュボードのゲート・ナレッジカードの目標チップは
  GoalLink の `confidence != rejected` から解決して表示

## 却下した案

- **進捗率の LLM 推定表示**: 偽の精度感。NSM 設計の誤解
  「NSM はゲーム化される」と同型の罠 (product-brief 参照)
- **Entry 等への goalId 直接追加**: 複数目標への紐付けが
  表現できず、後から必ず中間テーブルに移行することになる
- **KPI/KDI の構造化モデル** (指標名・目標値・現在値):
  数値を持ち出すと進捗率を出したくなる。v1 は自由記述に留める
