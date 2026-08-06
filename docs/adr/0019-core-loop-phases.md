---
type: decision
status: accepted
date: 2026-08-06
tags: [product, onboarding, mcp, phase]
source_refs:
  [
    docs/phase-progress.md,
    docs/adr/0001-product-foundation.md,
    docs/adr/0003-self-contained-loop.md,
    docs/adr/0010-action-surface-mcp.md,
    docs/onboarding.md,
  ]
---

# ADR-0019: コア1ループ完走のための Phase 計画（v4.2）

## 背景

自分用 OS としては強いが、仲間に渡すと面が広くコアループが見えない（評価 B）。
Fable（Claude Max / `--model fable`）による網羅提案を、**Phase 分割で漏れなく消化**する。

## 決定

1. **第三者向けコア一文**  
   「AI に書かせたコードについて、コミットのたびに自分の理解を試す出題（しれん）が届き、答えるとつまずきがずかんに貯まるローカルツール」

2. **コア1ループ**  
   供給（hook / 後に `request_gate`）→ しれん → 回答 → 採点 → ずかん → 再出題。  
   capture / 適用記録 / goals / harness / requirements / Cloud は証跡または周辺（初回から隠すか Later）。

3. **進捗の正本**  
   全項目のステータスは [`docs/phase-progress.md`](../phase-progress.md) のみ。  
   実装完了時に必ず当該 ID を更新する。未更新の完了宣言は禁止。

4. **Phase**

| Phase | ねらい | 完了の定義 |
|---|---|---|
| **P0** 渡せる土台 | 初回ループが説明なしで回る | クリーン環境＋1枚 docs だけで30分以内に初回完走 |
| **P1** 供給と検証 | 供給の単一障害を消し他人で通す | 同僚1名無介入完走＋詰まり全クローズ |
| **P2** 翌日以降 | 2日目が空にならない | D2以降の自発回答＋再出題発火 |
| **P3** 周辺復帰 | 隠した資産を一つずつ戻す | 各復帰後コア指標が悪化しない（一括禁止） |

5. **Won't（全 Phase 拘束）**  
   供給経路の乱立、ツール物理削除（隠すだけ）、SaaS/マルチユーザー、サンプルコース化、DQ 演出強化、Obsidian 初回必須、ルールベース採点 fallback、ADR 歴史改ざん。

## 理由

- Wave 名は進め方の一案にすぎない。中身（Fable の全項目）を Phase で固定し、進捗表で漏れを防ぐ。
- 「いちばん効く一手」だけ進めると周辺 Must が落ちる。P0 は Must 一式、P1 で `request_gate` と同僚検証。

## 結果・トレードオフ

- 得られるもの: 渡せる体験のチェックリスト、隠す≠捨てるの明示、コア指標の優先
- 失うもの（一時）: 初回ナビから goals/harness 等。本人は `MCP_SURFACE=full` と直 URL で継続可

## 出典

- Fable 提案全文（ローカル作業ログ `/tmp/claude-fable-full-out.txt`、2026-08-06）
- 先行: Opus Max 診断（供給が hook 一本等）
