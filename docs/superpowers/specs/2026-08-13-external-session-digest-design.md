---
type: design
status: draft
date: 2026-08-13
tags: [living-atlas, ui, harness, nikki, dashboard]
source_refs:
  [
    docs/superpowers/specs/2026-08-13-ds-dual-screen-terminal-design.md,
    .claude/progress/living-atlas-ui-handoff.md,
    prisma/schema.prisma,
    src/lib/daily-textbook.ts,
    src/lib/atlas-taxonomy.ts,
    src/components/living-atlas/load-atlas-data.ts,
    docs/adr/0019-core-loop-phases.md,
    docs/adr/0020-daily-retro-knowledge-loop.md,
  ]
---

# 外部セッション・事後ダイジェスト 設計

## 背景・目的

koki は普段、Living Atlas 内の埋め込みターミナルではなく「手元の Claude Code CLI / Cursor / VSCode」で LLM を使う。DS風二画面ターミナル連動UI（`2026-08-13-ds-dual-screen-terminal-design.md`）はこの活動を**常時表示のライブ連動**で見せようとして撤回された。koki 確定の閉じる一言（同 doc より）:

> 基本的にはターミナル系のアプリやVSCODEでLLMを使用してこのシステムはその内容がUI上で綺麗に整理されてるかつワクワクして試練などを進めてずかんやにっきなどにまとめられているというのが最大の強み

本設計はこの「事後整理」の軸で、外部セッションでの活動（学びの捕捉・しれん回答・要件登録など）を Living Atlas 側に「綺麗に整理された・接続を感じられる」形で見せることを目的とする。

### 現状の課題（2026-08-13 ブレインストーミングで確認）

1. 外部で作業したことがここに反映された、という**接続感が見えない**（`capture_learning_candidate` 等は受信箱に静かに入るだけ）
2. 既存UIが地味でワクワク感が足りない
3. 外部で何をやったか自体を**振り返る場がない**（セッション単位の振り返りが存在しない）

技術調査で判明した重要な事実:

- `scripts/collect-harness.mjs`（launchd定期実行）が `~/.claude/projects` と `~/.codex/sessions` を継続的にスキャンし、koki の手元の**全**LLMセッションを `HarnessRun`（1セッション=1レコード。`tools: JSON [{name, kind, calls}]`, repo, tokensIn/Out, turns, startedAt/endedAt）として既に収集している
- 一方、`HarnessRun` は現状「どうぐ」画面（repo単位の健全性指標）にしか使われておらず、「にっき」の材料は `DevEvent`（git commit）のみ。commit を伴わない活動はにっきにもずかんにも一切反映されていない
- `ちず`（`atlas-world-map.tsx`）は画面の6割を占めるがほぼ情報ゼロ（自キャラ位置は固定、クリック可能なのは「！」ピン1件のみ）。「外でやってきたことが反映された」という蓄積表現がトップ画面に一切ない

## スコープ

### 対象（本設計）

- 「セッションダイジェスト」算出ロジックの新設（新規テーブルなし、読み取り時計算）
- Phase 1: にっきの日次詳細ページへの「とびら」追加
- Phase 2: ホーム（ちず）への「きょうのきろく」ストリップ追加
- Phase 3: ちずマップへの「足あとピン」追加

### 対象外（別トラックで追跡）

- 情報量・テキスト削減の残タスク（じゅんび構造整理・天の声/つまり折りたたみ・しれんナレーター全体見直し） → Issue #3
- 非機能要件リファクタリング・メニューちらつき・ロードUX新設 → Issue #2
- どうぐ画面の作り替え（今回対象外。既に良いUIとして評価済み）
- MCP呼び出し時への正確な `sessionId` 紐付け（下記「精度のトレードオフ」参照。将来拡張候補）
- 埋め込みターミナルの常時二画面化・リアルタイム連動（DS案として撤回済み。同じ方向のやり直しはしない）

## アーキテクチャ

### メカニズムの統合

当初「にっきの材料を DevEvent 以外に拡張する（A）」と「セッションダイジェストを新設する（C）」を別メカニズムとして検討したが、実装は1つに統合する。

**理由**: 既存の日次章クラスタリング（`clusterMaterialsIntoChapters`、`daily-textbook-shared.ts`）はテストが手厚く、ADR-0020 の日次圧縮思想に基づく複雑なロジックを持つ。ここに commit 以外の材料種別を混ぜ込むのは変更リスクが高い。

代わりに、**「セッションダイジェスト」という1つの算出関数を新設し、それを Phase 1〜3 の3箇所すべてで使い回す**。章クラスタリングには一切触れない。にっきの「とびら」は章とは独立したセクションとして追加する。

### セッションダイジェストの算出方法

新規テーブルは作らない。既存データを読み取り時に突き合わせる、`loadMaterialsForDate` / `listMaterialCaptureHealth`（`src/lib/daily-textbook.ts`, `src/lib/harness-stats.ts`）と同じパターンに従う。

```
buildSessionDigestForDate(dateKey: string): SessionDigest

1. HarnessRun を dateKey の JST 日範囲で startedAt 抽出
2. 各 HarnessRun の [startedAt, endedAt] 時間窓に対し、以下を時間窓の重なりで突き合わせる:
   - Capture.capturedAt
   - Gate.answeredAt
   - GoalLink.createdAt
   - RequirementLink.createdAt
   - DevEvent.receivedAt（commit。既存のにっき章材料と重複するが集計には含める）
3. repo → 領（`SystemKind`: knowledge/harness/cache/design/fog）の解決は、`placeFrom`（`atlas-taxonomy.ts`）ではなく `classifySystem`（同ファイル）を使う。`placeFrom` は repo キー自体でのグルーピング（ずかん/しれん一覧向け）であり、ちずマップの5領域とは軸が異なる。footprint 用の領決定は、その repo に紐づく直近の Gate（`DevEvent.repo` → `Gate.event`）に `classifySystem` を適用し多数決を取る——`load-atlas-data.ts` の `loadSystemStars` と同じ集計パターンを repo 単位に適用する。該当 Gate が無い repo は既存の「未対応 system は霧帯へ」規約（`atlas-world-map.tsx` の `TILE_REGION` フォールバック）に倣い 霧帯 にフォールバックする
4. リポジトリ単位・学びの系統単位に集約し、SessionDigest 構造体を返す
```

```ts
type SessionDigest = {
  dateKey: string;
  sessionCount: number;
  repoCount: number;
  byRepo: {
    repo: string;
    region: SystemKind; // classifySystem 多数決の解決先（該当 Gate が無ければ "fog"）
    sessionCount: number;
    captureCount: number;
    gateAnsweredCount: number;
    goalLinkCount: number;
    requirementLinkCount: number;
    commitCount: number;
    sessions: { sessionId: string; startedAt: Date; endedAt: Date | null }[];
  }[];
};
```

### 精度のトレードオフ

MCP ツール呼び出し側（`src/app/api/mcp/route.ts`）は現状どのセッションからの呼び出しかを記録していない。`HarnessRun` は別プロセス（`collect-harness.mjs`）が事後にログファイルから収集するため、書き込み時点で正確な `sessionId` を `Capture`/`Gate` 等に持たせることができない。

本設計は**時間窓の重なりによる近似マッチ**を採用する。複数セッションを同時並行で動かした場合、稀に取り違えが起きうる（例: 2つのターミナルで同時に Claude と Codex を動かし、ほぼ同時刻に別々の学びを捕捉した場合）。事後の振り返り・雰囲気を作ることが目的であり、監査精度は求められていないため許容する。

正確な紐付け（MCP呼び出し時に `sessionId` を受け取り `Capture.sourceContext` 等に埋め込む）は、将来精度が問題になった場合の拡張候補として記録に留め、本設計では実施しない。

### 集約粒度・情報量方針

1日に多数のセッションが発生しうるため、個々の `HarnessRun` をそのまま列挙しない。**repo単位に集約したカウント**を基本表示とし、詳細は展開式（`<details>` または既存の「くわしく読む」パターン）にする。Issue #3（情報量ブラッシュアップ）の方針と整合させ、新設するUI自体で情報過多を再発させない。

## Phase 1: にっきのとびら

**配置**: 日次詳細ページ（`/retro/[date]`、`atlas-daily-textbook.tsx`）の冒頭、既存の要約行（「材料 N件 → 章 M。…」）の直後。既存の PageFlip 本UI（`atlas-nikki-shelf.tsx` の月本棚・ページめくり体験）には一切触れない。

**内容**: `buildSessionDigestForDate` の結果を1行集約で表示し、`<details>` で repo別内訳を展開する。

```
本日の外部セッション: 3件・2 repo → 学び +2・しれん回答 +1
▸ くわしく見る
  applied-loop: 2セッション（10:32-11:15, 14:02-14:40）・学び+2
  triple-list: 1セッション（09:10-09:45）・しれん回答+1
```

セッションが0件の日は「まだ外部セッションの記録が無い」の1行のみ（うけばこ等の既存の空状態表現と揃える）。

## Phase 2: ホームのストリップ

**配置**: `atlas-dashboard.tsx`（ちず＝ホーム）のマップ直下、既存の凡例行の下に「きょうのきろく」として新設。

**内容**: 当日 `dateKeyJST()` の `SessionDigest.byRepo` を横並びカード（2〜4枚。5件超は「+N」で丸める）で表示。各カードは repo名・領アイコン・簡潔なカウント（例: 「applied-loop・2セッション・学び+2」）。クリックで `/retro/[date]`（Phase 1 のとびら）へ遷移。

## Phase 3: 足あとピン

**配置**: `atlas-world-map.tsx` に、当日活動があった領（`SessionDigest.byRepo[].region`、`classifySystem` 多数決で解決済み）へ足あとピンを追加。

**視覚言語**（既存の `regionBrightness` との整理）:

- `regionBrightness` は面（領の塗りの明度）でドメイン習熟度を表す既存の別軸。今回の足あとピンは点（マーカー）なのでチャンネルが異なり、直接の衝突はない
- 足あとピンは「！」ピン（緊急アクション・金色・クリックで `/gates/[id]` へ）とは意味が違うため、**別アイコン（小さな足あと）・控えめな色**にする。「行くべき場所」ではなく「今日いた場所」を示す情報系マーカーであり、目立たせすぎない
- 同じ領に複数セッションがあれば、ピンを増やさず**数字バッジ**で集約
- スコープは**当日のみ**。過去の足あとは蓄積・永続表示しない（マップをクリーンに保つ）。恒久記録は Phase 1 のにっきのとびらが担う
- クリック時はページ遷移せず、同一画面内の Phase 2「きょうのきろく」ストリップの該当カードをスクロール/ハイライトする（マップとストリップは同じ ちず＝ホーム 画面にあるため、遷移なしで接続を体感できる）

## 実装順序

Fable調査での推奨順（安全な順）を踏襲する:

1. **にっきのとびら**（Phase 1）: `buildSessionDigestForDate` の新設とセットで実装。最も独立性が高く、既存画面への影響が最小
2. **ホームのストリップ**（Phase 2）: Phase 1 のデータ関数を再利用するのみ。ダッシュボードへの追加
3. **足あとピン**（Phase 3）: `atlas-world-map.tsx` の改修を伴うため最後。Phase 2 のストリップとの連動（クリックでハイライト）も含む

各フェーズ独立にリリース可能。フェーズ間で `SessionDigest` のデータ形状を変更しない限り、後続フェーズを待たずに前のフェーズだけ先に使い始めてよい。

## テスト方針

- `buildSessionDigestForDate` は純粋なデータ変換関数として、既存の `loadMaterialsForDate` 系と同様にユニットテスト可能（実データ相当のフィクスチャで repo別集約・時間窓マッチングを検証）
- 時間窓が重ならないケース（セッション外で作られた Capture 等）を含めない境界値テストを含める
- 各 Phase の UI コンポーネントは既存の 106件のテストスイートを壊さないことを `npx tsc --noEmit` / `npm test` で確認する
- ブラウザ実機確認（`npm run dev:all`、localhost:3100）を各 Phase 完了時に実施

## 非対象・懸念事項の記録

- `AtlasWorldMap` の自キャラ位置が現状ハードコード固定である点は、本設計のスコープ外（足あとピンは自キャラとは別の点として追加する。自キャラの動的化は別途検討）
- `/digest`（ルミナの週次語り）が現状ドックから孤立している問題（Fable調査で発見）も本設計のスコープ外。将来「にっき棚の週の扉」への統合が提案されているが、別トラックで検討する
