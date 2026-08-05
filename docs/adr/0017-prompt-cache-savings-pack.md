---
type: decision
status: accepted
date: 2026-08-04
tags: [harness, prompt-cache, savings, multi-repo]
source_refs:
  [
    docs/product-brief.md,
    docs/adr/0009-harness-comprehension.md,
    docs/adr/0016-harness-canon-module.md,
  ]
---

# ADR-0017: プロンプトキャッシュ節約パック（実行層）

## 背景

ADR-0016 はプロンプトキャッシュを **理解・観測** の正典モジュールにした。
一方、全プロジェクトでトークンを実際に減らすには、安定プレフィックス規約と
repo 別の処方（どう直すか）が必要だった。Fable までの設計は学習ループまでで、
節約の実行層は未決だった。

product-brief は「ユーザーのプロジェクトルールの上書き・大量注入」を非目標と
している。強制適用はできない。

## 決定

### 1. 二層の実行メカニズム

| 層 | 役割 | スコープ |
|---|---|---|
| **共有ハーネスパック** | 安定プレフィックス規約・テンプレ断片・チェックリスト | 横断（どの repo でも同じ） |
| **Applied Loop 処方** | `cache-decline-repo` / repo 再利用率から advisory パッチ案 | 局所（repo） |

両方とも **差分提案のみ**。ファイルへの強制書き込みはしない。

### 2. 共有パックの置き場

- 正典: `docs/harness-pack/`（Applied Loop リポジトリ内）
- 配布・適用手順: my-copy skill `my-copy-harness-prefix-pack`
  （提案 diff を出す。`--apply` による自動上書きは持たない）

安定プレフィックスの順序（不変 → 可変）:

1. Identity / 不変の作業方針（短い）
2. ツール横断の不変ルール（短いポインタ）
3. **ここから後ろ** — プロジェクト固有・日付付き・頻繁に変わる指示

### 3. Applied Loop 処方

- 入力: `repoCacheReadRates` / 検出パターン `cache-decline-repo:*`
- 出力: 安定プレフィックス違反の疑い・チェックリスト・候補パッチ（文言レベル）
- UI: `/harness` の repo 表から「処方を見る」→ `/harness/prescriptions/[repo]`
- MCP: `suggest_cache_prefix_fix`（repo 必須）
- 適用証跡: 既存 `record_application`。`appliedTo` に対象 repo を必ず含める
  （ADR-0016 運用規約。スキーマ変更なし）

### 4. 含めないもの

- ルールの自動 force-write / 全 repo 一括注入
- 節約額・ROI の数値 UI（ADR-0009 §6 / ADR-0016）
- Cursor への会話本文解析

## 理由

- 概念は横断・証拠と処方は局所（ADR-0016）を実行層にも適用する
- 上書き禁止を守りつつ、観測→提案→本人適用→再観測のループを閉じられる
- 共有パックだけでは悪化 repo に刺さらない。AL 処方だけでは横断の共通言語がない

## 結果・トレードオフ

- 得られる: 全プロジェクトで使える規約 + 悪化 repo への具体的次の一手
- 失う: 「ワンクリックで全 repo を直す」体験（意図的。本人の合意が必要）

## 出典

- ADR-0016 ハーネス正典モジュール
- product-brief「やらないこと」: プロジェクトルールの上書き禁止
- プラン: Cache Pack Plus Goals (2026-08-04)
