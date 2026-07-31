---
type: decision
status: accepted
date: 2026-07-31
tags: [product, core-why-what-how, mvp]
source_refs: [pm-learn/entries.jsonl, koki-central/40 Knowledge/PM土台.md]
---

# ADR-0001: プロダクト基盤（Core/Why/What/How）

## 背景

個人開発プロダクトの設計に先立ち、『プロダクトマネジメントのすべて』PART I の
4階層（Core/Why/What/How）を「検討の網羅でなく空席診断の軸」として適用した。
初版プランは What/How 中心で、Core 層（存在理由）と Why 層の半分が空席だった。

## 決定

- **Core**: 学びを「実務適用の証跡」に変えるループを提供する
  （読了 → 適用 → 格上げの記録が中核。「30日実験」はオプション機能）
- **Why**: 誰 = 技術学習を実務に活かしたいエンジニア（ユーザー#1 = 自分）。
  なぜ自分が = 課題の一次体験者 / pm-learn でドメインモデル検証済み /
  市場は「記憶定着」（Readwise・Acorny・Plemo 等）に偏り「適用証跡」が空き
- **What**: ハイブリッドループ。イベント型の適用記録が中核 +
  オプションで30日実験化 + 週次「未適用の学び」リマインド
- **How**: Web ファースト（Next.js + Supabase 予定 + Vercel）。
  appetite 8週間、業務 KDI 枠外・業務外時間、週次ふりかえりで埋もれ対策

## 理由

- pm-learn 実データ（entries.jsonl）は週3件のイベント型運用で、
  「30日実験+日次チェックイン」型は自分の習慣と合っていない可能性が高い。
  実データと整合するイベント型を中核に据えた
- 記憶定着（SR アルゴリズム）は 2026 年時点で FSRS-6 等によりコモディティ化。
  差別化は「覚える」でなく「実務で試した証跡」に置く
- 業務 KDI（要望トリアージ・Why 言語化）のリソースを食い潰さないため、
  PM土台 §6 の規律に従い業務枠外に配置

## 結果・トレードオフ

- イベント型中核により摩擦は最小。ただし習慣化の強制力は実験型より弱い
  → 週次リマインドで補う設計
- ターゲットをエンジニア層に絞ることで、読書家全般市場は後回しにする

## 出典

- 詰めの記録: pm-learn application「4階層空席診断 → 個人開発アプリの詰め」(2026-07-31)
- 競合分析: Readwise / Acorny / Plemo / SmartRecall / Chaptera（2026-07-31 Web 調査）
- PM土台: koki-central `40 Knowledge/PM土台.md` §3-3（appetite 規律）・§6（同時進行規律）
