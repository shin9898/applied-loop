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

## 追記 (2026-08-06) — P3「一括禁止」の現実合わせ

Fable 再レビューで、証跡ナビが `hasFirstClear` 単一フラグで同時解放されている点と、docs の「5段復帰」記述が食い違っていると指摘された。

**決定（追記）:**

1. **証跡4面**（にっき / もくひょう / どうぐ / ようけん）は初 CLEAR（サンプル以外）で**一括解放**してよい。細かい段階フラグは持たない。
2. **一括禁止の対象**は次の2つに限定する: (a) `MCP_SURFACE=full` を既定に戻すこと、(b) Cloud ウィザードを初回から既定オープンにすること。
3. `docs/surface-unlock.md` の「復帰順」は観測・ドキュメント整備の**作業順**であり、UI フラグの5段実装ではない。

これにより実装と完了定義の嘘をやめ、個人開発の検証コストを抑える。

## 追記 (2026-08-10) — コア一文と本線の更新（ADR-0020）

AI 実装速度下で「commit のたびにしれん」＋ backlog cap は供給沈黙を起こす（実測: `skipReason=backlog` 多発）。

**決定（追記）:**

1. 第三者向けコア一文は [ADR-0020](./0020-daily-retro-knowledge-loop.md) の定義に**更新**する（材料無制限 → 日次教科書 → 確認 → 4状態）。
2. P0–P3 の成果物（初回完走・MCP・監視・ずかん等）は維持。重心移動は **P4**（`docs/phase-progress.md`）で進める。
3. `GATE_BACKLOG_CAP` による材料損失は 0020 に従い解消する。即時しれんは過渡の互換経路。

## 出典

- Fable 提案全文（ローカル作業ログ `/tmp/claude-fable-full-out.txt`、2026-08-06）
- Fable 再レビュー（`/tmp/claude-fable-rereview-body.md`、2026-08-06）
- 先行: Opus Max 診断（供給が hook 一本等）
