---
type: decision
status: accepted
date: 2026-08-03
tags: [ux, mcp, dashboard]
source_refs: [docs/product-brief.md, docs/adr/0010-action-surface-mcp.md]
---

# ADR-0013: タスク起点ビューの保存方式と 4 象限マップ

## 背景

product-brief v4 の「タスク起点ビュー」と「D 4象限マップ」の実装設計。

- タスク起点: 「今日のタスク → 関連する学び・誤解」のマッピングを
  ダッシュボードに出したいが、タスクの正典は Hermes / TODO であり
  サーバーはその構造を知らない（所有権分離の原則）
- 4象限マップ: 認知4象限の週次の状態遷移を可視化する。
  競合にない独自機能

## 決定

### 1. タスク起点ビューは「LLM がマッピングして保存」方式

タスクを知っているのは LLM セッション側 (Hermes/TODO を読める)。
サーバーが外部システムを読みにいくのではなく、
**LLM が朝のセッションでマッピング結果を保存する**:

```prisma
model DailyTaskMap {
  id       String   @id @default(cuid())
  dateKey  String   @unique  // "2026-08-03" (JST)
  mappings String   // JSON: [{task, related: [{type: "entry"|"misconception"|"gate", id, reason}]}]
  createdAt DateTime @default(now())
}
```

- MCP ツール `save_task_mappings` (dateKey?, mappings) で保存
  (同日は上書き upsert)
- 朝ブリーフィングの応答で、LLM に
  「今日のタスクを `find_related_learnings` でマッピングし
  `save_task_mappings` で保存する」よう促す定型文を含める
- ダッシュボードは当日の DailyTaskMap を読んで
  「今日のタスクと関連する学び」セクションに表示
  (タスク → 関連学び/誤解/ゲートのリンクつき)
- LLM が保存しなかった日はセクション非表示 (フォールバック不要)

### 2. 4 象限マップの集計定義

週次 (JST 週) の象限間の流れを以下で集計:

| 遷移 | 集計対象 |
|---|---|
| 未知の未知の発見 | 今週作成された Misconception (open/regressed) 件数 + ハーネスパターン検出数 (Phase 3 以降) |
| 知の未知 → 知の知 | 今週 resolved になった Misconception 件数 |
| 未知の知 → 知の知 | 今週の合格ゲートのうち `answerMode="researched"` の件数 (調べて解けた = 実はできていたの自覚化) |
| 知の知の維持 | 今週の合格ゲートのうち `kind="sr_review"` の件数 (忘れる頃の再出題で確認) |

- `src/lib/quadrant.ts` に集計ロジックを実装
- UI: ダッシュボードに「認知の4象限」セクション。
  4 象限のボックスと遷移矢印 + 件数を SVG で描画
  (チャートライブラリは使わない)
- 件数ゼロの遷移はグレーアウト。「流れが止まっている象限」が
  一目で分かるようにする (それ自体が重要なシグナル)

## 却下した案

- **サーバー側から Hermes/TODO を直接読む案**: 所有権分離の原則に
  反する。Hermes の構造変更に Applied Loop が引きずられる
- **マッピングをリアルタイム生成 (表示時に LLM 呼び出し)**: 
  ダッシュボード表示のたびに LLM コストがかかる。朝 1 回の保存で十分
- **4象限を蓄積値 (ストック) で表示**: 「今どの象限に何件あるか」は
  誤解の総数でしかなく変化が見えない。週次の流れ (フロー) で見せる
