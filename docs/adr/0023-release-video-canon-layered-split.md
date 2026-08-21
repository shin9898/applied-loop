---
type: decision
status: accepted
date: 2026-08-21
tags: [release-video, multi-repo, repo-ownership]
source_refs: []
---

# ADR-0023: release-video パイプラインの正典を3層(実体/台本/導線)に分離する

## 背景

release-video(CS向け操作説明・機能紹介動画をVOICEVOX + Playwright + ffmpegで自動生成するパイプライン)は
2026-06-17に `triple-three-inc/triple-report`(ローカル `triple-report-mono`)の PR #1147 で新設され、
2026-07-27に `~/tools/workbench` へ完全ミラーされた。2026-08-12、workbench側でTRIPLE LIST横展開用の拡張
(`lib/mock.mjs`・`selectOption` step)を加えたのを機に、workbench側の README が独自に「ここが正典」と
宣言した。

2026-08-21、実コード調査 + Opus設計調査で、この宣言が3つの理由で実効性を持っていなかったと判明した。

1. **3系統フォーク、かつ宣言側が後発ではない**: triple-reportの`origin/main`には
   `setInputFiles`/`pulseSelector`/`highlightSelector`/`box`/ナレーション同期pulseの5機能があるが、
   workbench側には無い。逆にworkbench側の`selectOption`/`mock.mjs`はtriple-reportに無い。
   workbenchの`SKILL.md`は「注目枠はナレーション終わりまで保持される」という品質規約を書いているが、
   workbench自身はその挙動を実装していない(旧`setTimeout(2300)`のまま)
2. **グローバル呼び出し導線が宣言に追従していない**: 唯一cwd非依存で呼べる経路である
   `my-copy/skills/release-delivery/SKILL.md`・`references/automation-map.md`が、今も
   「release-videoは`triple-report-mono/.claude/skills/`」と明記している。宣言時にこの導線を
   書き換えなかったため、実際の呼び出しは今もstale側に流れる
3. **workbenchはtriple-three-inc org外の個人リポジトリ**(`github.com/shin9898/workbench`)。
   ここにTRIPLE REPORTのDBスキーマ・コンテナ名・認証突破手順(セッション直INSERT)・業務ロジックが
   tracked で入っている。会社プロダクト向けツールの正典が org 所有の外にある状態

加えて、台本(manifest)の永続化先が4パターン(triple-report/triple-list/triple-onboarding/workbench)に
分散し、多くが`.gitignore`で無視されているため、納品済み動画(REPORT 20本超・ONB 3本・LIST 4本)の
再生成に必要な情報がどこにも確実に残っていない問題も同時に見つかった。

## 決定

release-video の正典を以下の3層に分離する。

- **pipeline実体**: `triple-three-inc` 配下の新規専用リポジトリへ切り出す(どのプロダクトの
  fork系譜にも属さない横断ツールとして)
- **manifest(台本)**: 消費プロダクト(triple-report/triple-list/triple-onboarding等)の
  リポジトリへ各々commitする(triple-listの`feature/release-video-list-guides`ブランチが既にこの形)
- **skill(実行導線)**: `my-copy` pluginから配布し、`release-delivery/SKILL.md`・
  `automation-map.md`の参照先をこの新リポジトリへ差し替える

実装前に、triple-report `origin/main`にのみ存在する5機能をworkbench側の拡張3点
(`selectOption`/`lib/mock.mjs`/`intonationScale`)と統合するreconcileを先行させる。

## 理由

- 所有権問題(会社データが個人repoに存在)は宣言では解消できず、org repoへの移動以外に手段がない
- 3プロダクト共有の横断ツールを1消費者(triple-report)のリポジトリに戻すと、
  「どちらが正典か分からない」問題を再生産する(却下: C案)
- workbench継続(却下: A案)は個人repo所有問題を残し、workbench自身の`AGENTS.md` Identity
  (「実装の正典は`my-copy/`」)と矛盾する
- 2026-08-12の宣言が無効だった原因は行き先の選択ではなく、実行導線(automation-map.md等)を
  同時に切り替えなかったことにある。今回はpipeline/manifest/導線の3機構を同時に決定事項とする
- reconcileはどの行き先を選んでも避けられない先行タスクであり、リポジトリ切り出しの増分コストではない

## 結果・トレードオフ

得るもの: 所有と実態の一致、manifest永続化の統一(消費リポジトリへcommitする一箇所の規約に収束)、
cwdに依存しない実行導線。

意図的に失うもの: 新規リポジトリのメンテコストが増える(当面単独運用のため、org化自体の実利は限定的)。
移行完了までの間、triple-report側のstale実装は(pointer化されるまで)実行導線として残り続ける。

## 影響を受けないもの

- triple-onboarding・triple-list・triple-release-notesの消費側の使い方
  (納品先 `~/.my-copy/cs-videos/<product>/` 経由は変更なし)
- product-template PR #61 / ADR-0001(product-repo-topology)の決定。あちらはproduct系リポジトリの
  fork系譜規約であり、release-videoはどの製品にも属さない横断ツールのため独立

## 次のアクション(実装は別セッション)

1. Phase 0: reconcile — origin/main の欠落5機能をworkbench拡張3点と統合
2. Phase 1: org専用リポジトリ新設 + `paths.mjs`の`REPO_ROOT`明示化(現在はディレクトリ深さの偶然依存)
3. Phase 2: `my-copy/skills/release-video/`化 + `release-delivery`/`automation-map.md`参照差し替え
   + plugin version bump
4. Phase 3: triple-report側`scripts/release-video/`・`.claude/skills/release-video/SKILL.md`を
   pointer化 + `.gitignore`を`out/`のみへ縮小
5. Phase 4: triple-listの未pushブランチ(`feature/release-video-list-guides`、manifest 5本と
   無関係な`.env.development`変更の分離が必要)を統合

## 出典

- 2026-08-21 実コード調査(workbench/triple-report-mono/triple-list/triple-release-notes、
  `gh api search/code` による triple-three-inc org全体検索)+ Opus設計調査
  (`subagent_type: Plan`、Fableは月間支出上限エラーのため切替)
- 前例: ADR-0022(正典移動+ポインタ化の型)
