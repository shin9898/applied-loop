---
type: decision
status: accepted
date: 2026-08-02
tags: [gate, llm, ux]
source_refs: [docs/product-brief.md, docs/adr/0006-comprehension-gate.md]
---

# ADR-0007: ゲートの思想修正 — リソース常時提示・ルーブリック採点・調査力記録

## 背景

product-brief v3 の①②を実装可能な形に落とす。
v2 のゲートは「コードを見ずに答える記憶テスト」の思想だったが、
エンジニアの実務は「正確に記憶していること」ではなく
「正確に調べられること」が本質という開発者の指摘を受けて修正。

- ゲートが測るもの: **概念の本質の理解 + 調査力**（記憶力ではない）
- 参考リソースは出題時から常時提示（v2 の自己申告制折りたたみは廃止）
- 「調べて正解」も合格。調査行動自体を記録・評価する

## 決定

### 1. 出題生成時にリソースとルーブリック観点も同時生成

`generateGate` (src/lib/gate.ts) の LLM プロンプトを拡張し、
1 回の呼び出しで 3 つを生成させる:

```json
{
  "question": "...",
  "target_concept": "...",
  "rubric": ["観点1", "観点2", "観点3"],
  "resources": [
    { "kind": "doc",    "label": "Prisma driver adapters", "ref": "https://www.prisma.io/docs/..." },
    { "kind": "file",   "label": "リポジトリ内の該当コード", "ref": "src/lib/gate.ts" },
    { "kind": "commit", "label": "この変更の diff", "ref": "f568033" }
  ]
}
```

- `rubric`: 合否を分ける概念の本質の観点。最大 3 つ
- `resources.kind`: `doc` (一次情報 URL) / `file` (リポジトリ内パス) /
  `commit` (sha) / `adr` (docs/adr 内参照)
- リソースの `ref` は**参照のみ**保存。ファイル本文は送らない・読まない

### 2. スキーマ変更 (Gate モデル)

```prisma
model Gate {
  // ... 既存フィールド ...
  resources      String?  // JSON: [{kind, label, ref}]
  rubricCriteria String?  // JSON: ["観点1", ...] (出題生成時に保存)
  rubricResult   String?  // JSON: [{aspect, score, note}] (採点後。ローカルのみ)
  answerMode     String?  // "self" | "researched"
  accessedResource Boolean @default(false)
}
```

- `rubricResult` は回答・採点メモと同じくクラウド同期除外
- `accessedResource` / `answerMode` は構造情報のみなので同期可

### 3. ルーブリック採点

`gradeGate` のプロンプトに `rubricCriteria` を渡し、
観点別スコア付きの JSON を要求する:

```json
{
  "verdict": "pass" | "fail",
  "feedback": "...",
  "misconception": "..." | null,
  "rubric": [{ "aspect": "観点1", "score": 0|1|2, "note": "..." }]
}
```

- score: 0=欠落 / 1=部分的 / 2=押さえている
- 合否は LLM の `verdict` をそのまま使う（スコアから機械計算しない。
  ルールベース採点禁止の原則と整合）
- **ルーブリック出力の欠落時は合否のみで記録**し、
  `rubricResult` は欠損扱い（合否の信頼性を優先。product-brief 準拠）
- 失格フィードバックは「どの観点が欠けたか」を必ず含める

### 4. 調査力の記録

- ゲート詳細ページでリソースリンクをクリックすると
  Server Action `recordResourceAccess(gateId)` が走り
  `accessedResource = true` にする
- 採点合格時、`accessedResource` が true なら `answerMode = "researched"`、
  false なら `"self"` を記録
- **NSM への影響なし**: 区別は記録のみ。解消判定には使わない
  （調べて正解も合格として解消に数える。product-brief NSM 節）
- ダッシュボードに「調査後回答の割合」を診断指標として表示するのは
  あり（低下傾向 = リソースが不適切か、問題が記憶頼みかの診断）

### 5. UI への反映

- ゲートカードにリソース一覧を常時表示（kind アイコン + ラベル）
- `file` 種は `vscode://file/<abs path>` リンクで IDE を開く
- `commit` 種はリポジトリの git remote が GitHub なら
  `<remote>/commit/<sha>`、なければローカルパス
- 採点結果表示に観点別スコア（例: ●●○ のアイコン）と
  「自力回答 / 調査後回答」のバッジを追加

## 却下した案

- **リソースアクセスの自己申告制維持**: 申告は嘘をつけるし、
  そもそも「調べること」を隠す必要がない。開いて正解でよい
- **採点スコアの機械的合否判定** (合計 4 点以上で合格 等):
  ルールベース採点禁止の原則に抵触。スコアは説明可能性のための
  付帯情報で、合否は LLM の判断
- **リソースの本文を出題プロンプトに含める**: diff だけでトークンは
  十分大きい。一次情報の特定は LLM の知識に任せ、URL は事後検証
  （404 なら生成失敗として記録）する
