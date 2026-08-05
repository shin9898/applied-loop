---
type: decision
status: accepted
date: 2026-08-04
tags: [harness, prompt-cache, learning-loop, multi-repo]
source_refs:
  [
    docs/product-brief.md,
    docs/adr/0009-harness-comprehension.md,
    docs/adr/0006-comprehension-gate.md,
  ]
---

# ADR-0016: ハーネス正典モジュール（プロンプトキャッシュ第1号）

## 背景

プロンプトキャッシュの理解は、Applied Loop のハーネス観測グラフを
読めるようにするため、かつユーザー自身がどのプロジェクトで LLM を
使うときにも必要な横断知識である。

一方 product-brief v4 は「学習コンテンツの作成」を非目標としている。
記事全文をアプリに置くと汎用ブログ化し、競合の説明機能と差がなくなる。

Fable レビュー (2026-08-04): **GO with conditions**。
観測データの解釈レイヤーとして正典モジュール化し、本人の
HarnessRun で問う。収集は既に全プロジェクト横断だが、検出・
集計が repo 次元を捨てている穴を塞ぐ。

## 決定

### 1. ハーネス正典モジュール (Harness Canon)

- 汎用教材ではなく **観測データの解釈レイヤー**
- 第1号: プロンプトキャッシュ
- 置き場: `/harness/concepts/prompt-cache`（短い原理ページ）
- 記事フル版はアプリ外（Zenn 等の④アウトプット層）
- 図は権利を確認し、アプリのデザイン言語で再作画する
  （外部スクショの直置き禁止）

### 2. 原則: 概念は横断、証拠と処方は局所

| 層 | スコープ |
|---|---|
| 原理・誤解シード・Misconception | **横断**（どの repo でも同一の概念） |
| cache-decline 検出・module ゲートの差し込みデータ・適用・効果確認 | **局所（repo）** |

- `HarnessRun.repo` を第一級次元として検出・UI・出題に使う
- `Application.appliedTo` には対象 repo を必ず含める（スキーマ変更なし、運用規約）
- NSM に新指標は作らない。効率の数字で殴らない（ADR-0009 §6）

### 3. Gate.kind = `module`

既存 `initial` / `retry` / `sr_review` に加え:

- `kind: "module"` — 正典モジュール起点の理解チェック
- 出題プロンプトに **repo 別 cache read 率**（悪化上位）を差し込む
- 採点は既存ヘッドレス LLM。`answerMode` 規約は変更なし

### 4. 正典に含める / 含めない

**含める（構造的普遍）**

- 毎回短い指示でも長い文脈が送られる
- キャッシュ = 同じ先頭の計算再利用（人間的記憶ではない）
- 「意味」ではなく「同じ並び」；途中変更で後ろも再計算
- ツール定義の位置が履歴より前だと破壊点になる
- 待ち時間による失効がありうる（数値は脚注・一次情報へ）
- 履歴削除も並びを変え、得にならないことがある
- 見るべきは「新規処理 vs 再利用」

**含めない**

- TTL 等の具体数値の正典化
- プロバイダ別仕様の網羅比較表・節約額 UI
- インタラクティブ・シミュレータ（MVP 外）
- キャッシュヒット率の KPI 化

### 5. 学習ループ

```
観測 (HarnessRun, 全 repo)
  → 検出 (全体 + repo 単位 cache-decline)
  → Inbox / 原理ページ
  → Misconception (横断)
  → module ゲート (repo 別データを差し込み)
  → record_application (appliedTo に repo)
  → 再観測 (repo 別 cache read 率)
```

## 却下した案

- 記事全文のアプリ内掲載
- workbench 専用モジュール（収集は既に全プロジェクト）
- 全体合算のみの検出・出題（特定 repo の破壊を見逃す）
- 新 NSM / 節約額メトリクス

## 影響

- product-brief「やらないこと」に carve-out を追記
- `detectCacheReadDecline` を repo 単位でも実行
- `/harness` に repo 別内訳と原理ページへの導線
- Gate.kind コメント規約に `module` を追加
