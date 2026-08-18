---
type: decision
status: accepted
date: 2026-08-18
tags: [gate, misconception, capture, dedup, llm-guard, harness]
source_refs:
  [
    src/lib/gate.ts,
    src/lib/capture.ts,
    src/lib/harness-patterns.ts,
    src/lib/headless-llm.ts,
    docs/adr/0010-action-surface-mcp.md,
    docs/adr/0012-goal-os-inbox-triage.md,
    docs/adr/0018-reachable-mcp-cloud.md,
    docs/superpowers/specs/2026-08-18-gate-duplicate-guard-design.md,
  ]
---

# ADR-0021: しれん重複の入口ガード（LLM判定＋人間選択、自動マージはしない）

## 背景

`Misconception`（誤解）の重複排除は現状、`Capture`（受信箱）の完全一致文字列（`dedupeKey`）のみ。意味的に近い概念同士の重複はノーガードで、うけばこで「さいよう」した数だけ`Misconception`が増える。

過去セッションのDB実測で、意味的に近い誤解のクラスタが実在した。しかし内容を読むと「重複」ではなく**誤解の精緻化チェーン**だった:

- `cmsfz2p590003f1qys2lfo95h`（resolved, 2026-08-05）:「キャッシュのヒットを『識別子や意味の近さで引き当てる参照』だと捉えており、実際は内容そのものの先頭からの逐語一致…」
- `cmssbczzj00q6v1qyv06ovdqz`（open, 2026-08-14）:「キャッシュのヒット判定を『全体が完全一致しているか』という全体一致モデルで捉えており、『先頭からの連続一致＝プレフィックス』という構造と、無効化がその位置より後ろだけに及ぶという局所性…」

前者は一度 resolved（理解済み）になった後、9日後に後者としてより精密な誤解が新規行として生まれている。これは健全な学習の進み方であり、もしここを「重複」として自動マージしていたら、粗い理解から精密な理解への軌跡が消えていた。

## 決定

**完全自動マージはしない。** `confirmMisconception`が呼ばれる直前（`capture.ts`の`triageCapture`内）に、LLM判定＋人間の最終選択による**入口ガード**を置く。

- LLMは「新しい概念と既存`Misconception`の関係」を`duplicate` / `refinement` / `unrelated`に分類するだけ。**割り込むかどうかはコードが決定論的に判定する**（LLM出力を鵜呑みにしない）
- 割り込む条件は `duplicate × 既存が open または regressed` のときのみ。人間に「既存◯◯に紐付ける／新規作成する」を選ばせる
- `refinement`（精緻化）や `resolved`済みとの類似は、割り込まず注記のみで素通しする（v1）。健全な精緻化チェーンに毎回確認を挟むコストの方が、まれな見逃しより大きいと判断
- 実行経路はうけばこの単一のチョークポイント（`triageCapture`）。ADR-0010/0018の「アクション面の正典はMCP」に従い、UI側に新規の書き込みAPIは作らない

## スコープ（v1 / v2）

| 項目 | v1 | v2以降 |
|---|---|---|
| duplicate × open/regressed | 人間に確認（既存へ紐付け／新規作成） | — |
| refinement、または resolved のみとの類似 | 注記のみ、素通し | — |
| duplicate × resolved（再発疑い） | 注記のみ（v1は「regressedに戻す」選択肢を持たない） | 専用の「regressedに戻す」選択肢を検討 |
| link_existing 実行時の挙動 | 該当gateを既存`Misconception`にconnectし、`nextReviewAt`を「現在値が null なら now+72h、値があれば min(現在値, now+72h)」に前倒し（現在値nullをそのままMath.minに渡すと0=epochになり誤動作するため明示分岐が必須。opusレビュー指摘）。statusは据え置き | — |

（2026-08-18、koki確認済み。設計詳細は `docs/superpowers/specs/2026-08-18-gate-duplicate-guard-design.md`）

## 理由

- 精緻化チェーンの実例（上記）がある以上、「意味的に近い＝重複」という単純な自動化は学習履歴を破壊するリスクが実証済みで採用できない
- LLMに最終判断（マージする/しない）まで委ねず、分類だけをやらせてコード側の決定論的ゲートと人間の選択を挟むことで、誤分類の被害が両方向とも非破壊で収まる設計にできる（refinement→duplicate誤りは「聞かれるだけ」、逆は「今と同じ重複が1件できるだけ」）
- 既存の`headless-llm.ts`（koki自身のサブスク枠を使うBYO-LLM呼び出し）と`GoalLink.confidence: "llm_suggested"` + `approve_goal_link`（LLM提案→人間承認）の前例に乗せることで、新しい実行経路や新しい課金経路を増やさない

却下した案:

| 案 | 却下理由 |
|---|---|
| 完全一致 + 近似判定を自動マージ | 精緻化チェーンの実例で学習軌跡が消えることが判明済み |
| embedding検索での類似度判定 | BYO-CLI経路にembedding手段がなく、既存Misconception件数（実測10件）の規模では過剰実装 |
| rootCauseで比較対象を絞り込む | rootCauseがnullのケースがあり、かつ精緻化チェーンはrootCauseの系統をまたいで起きうる（上記実例もverification→knowledgeで系統が変わっている） |
| UI（`/inbox/[id]`）発の事前チェックAPI + 2段階accept | ADR-0010/0018の「アクション面はMCP」原則に反し、外部からMCPを直接叩く経路をノーガードのまま素通りさせる穴が残る |

## 結果・トレードオフ

得られるもの:

- 意味的重複によるMisconception肥大を防ぎつつ、精緻化チェーンという学習の進み方を壊さない
- 既存のLLM呼び出し・承認フロー資産（`headless-llm.ts`、goal linkの承認UI）を再利用でき、新しい運用コスト（監視・コスト帰属）をほぼ増やさない

失うもの / コスト:

- accept時に同期LLM呼び出しが1回増える（`headless-llm.ts`の応答時間分、体感レイテンシが伸びる）
- `Capture`に判定ログ列（`overlapCheckJson`）と選択結果列（`misconceptionId`）の追加が必要
- v1では「再発疑い（duplicate×resolved）」を拾いきれない（意図的にv2送り）

## 出典

- 2026-08-18 DB実測: `Misconception`全10件中、精緻化チェーンの実例1件を確認（`cmsfz2p590003f1qys2lfo95h` → `cmssbczzj00q6v1qyv06ovdqz`）
- Fableへの独立設計相談（2026-08-18、実コード読み込みの上でADR-0018/0010準拠の訂正込み）
- koki確認: 4論点（紐付け仕様／割り込み方針／再発疑いのv1スコープ／今回はspec+ADR化のみで実装は次回）すべてFable推奨案で確定
- 先行: ADR-0010（アクション面はMCP）、ADR-0012（goal-os inbox triage、`llm_suggested`パターンの前例）、ADR-0018（reachable MCP cloud）
