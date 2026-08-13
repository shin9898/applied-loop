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
    src/lib/harness-repo-match.ts,
    src/lib/harness-stats.ts,
    src/components/living-atlas/load-atlas-data.ts,
    src/components/living-atlas/atlas-world-map.tsx,
    scripts/collect-harness.mjs,
    docs/adr/0019-core-loop-phases.md,
    docs/adr/0020-daily-retro-knowledge-loop.md,
  ]
---

# 外部セッション・事後ダイジェスト 設計

## 改訂履歴

- 2026-08-13 v2: Fable による独立レビューを反映。region 型の混同・技術的事実誤りを修正、repo 正規化・外部セッションの定義・帰属ルール・とびらの配置（未生成日）を追記

## 背景・目的

koki は普段、Living Atlas 内の埋め込みターミナルではなく「手元の Claude Code CLI / Cursor / VSCode」で LLM を使う。DS風二画面ターミナル連動UI（`2026-08-13-ds-dual-screen-terminal-design.md`）はこの活動を**常時表示のライブ連動**で見せようとして撤回された。koki 確定の閉じる一言（同 doc より）:

> 基本的にはターミナル系のアプリやVSCODEでLLMを使用してこのシステムはその内容がUI上で綺麗に整理されてるかつワクワクして試練などを進めてずかんやにっきなどにまとめられているというのが最大の強み

本設計はこの「事後整理」の軸で、外部セッションでの活動（学びの捕捉・しれん回答・要件登録など）を Living Atlas 側に「綺麗に整理された・接続を感じられる」形で見せることを目的とする。

### 現状の課題（2026-08-13 ブレインストーミングで確認）

1. 外部で作業したことがここに反映された、という**接続感が見えない**（`capture_learning_candidate` 等は受信箱に静かに入るだけ）
2. 既存UIが地味でワクワク感が足りない
3. 外部で何をやったか自体を**振り返る場がない**（セッション単位の振り返りが存在しない）

技術調査で判明した重要な事実:

- `scripts/collect-harness.mjs`（launchd定期実行、1時間おき）が `~/.claude/projects` と `~/.codex/sessions` を継続的にスキャンし、koki の手元の**全**LLMセッションを `HarnessRun`（1セッション=1レコード。`tools: JSON [{name, kind, calls}]`, repo, tokensIn/Out, turns, startedAt/endedAt）として既に収集している
- `HarnessRun` は現状、「どうぐ」画面（repo単位の健全性指標）に加えてホーム画面の弱っている repo 表示（`repoCacheReadRates` → `loadHomeProps` の `weakRepos`）にも使われている。ただし**「にっき」の材料は `DevEvent`（git commit）のみ**で、commit を伴わない活動（学び捕捉・しれん回答・要件登録等）はにっきにもずかんにも一切反映されていない
- `ちず`（`atlas-world-map.tsx`）は画面の6割を占めるがほぼ情報ゼロ（自キャラ位置は固定、クリック可能なのは「！」ピン1件のみ）。「外でやってきたことが反映された」という蓄積表現がトップ画面に一切ない

## スコープ

### 対象（本設計）

- 「セッションダイジェスト」算出ロジックの新設（新規テーブルなし、読み取り時計算）
- Phase 1: にっきの日次詳細ページへの「とびら」追加（教科書 生成済み/未生成 の両分岐）
- Phase 2: ホーム（ちず）への「きょうのきろく」ストリップ追加
- Phase 3: ちずマップへの「足あとピン」追加

### 対象外（別トラックで追跡）

- 情報量・テキスト削減の残タスク（じゅんび構造整理・天の声/つまり折りたたみ・しれんナレーター全体見直し） → Issue #3
- 非機能要件リファクタリング・メニューちらつき・ロードUX新設 → Issue #2
- どうぐ画面の作り替え（今回対象外。既に良いUIとして評価済み）
- MCP呼び出し時への正確な `sessionId` 紐付け（下記「精度のトレードオフ」参照。将来拡張候補）
- `collect-harness.mjs` の収集間隔短縮（下記「収集タイムラグ」参照。将来拡張候補）
- `/digest`（ルミナの週次語り）のドック統合・にっき棚への統合（Fable調査で発見された別課題。別トラックで検討）
- 埋め込みターミナルの常時二画面化・リアルタイム連動（DS案として撤回済み。同じ方向のやり直しはしない）

## アーキテクチャ

### メカニズムの統合

当初「にっきの材料を DevEvent 以外に拡張する（A）」と「セッションダイジェストを新設する（C）」を別メカニズムとして検討したが、実装は1つに統合する。

**理由**: 既存の日次章クラスタリング（`clusterMaterialsIntoChapters`、`daily-textbook-shared.ts`）はテストが手厚く、ADR-0020 の日次圧縮思想に基づく複雑なロジックを持つ。ここに commit 以外の材料種別を混ぜ込むのは変更リスクが高い。

代わりに、**「セッションダイジェスト」という1つの算出関数を新設し、それを Phase 1〜3 の3箇所すべてで使い回す**。章クラスタリングには一切触れない。にっきの「とびら」は章とは独立したセクションとして追加する。

### 外部セッションの定義（スコープの境界）

`collect-harness.mjs` は `~/.claude/projects` 配下の**全**セッションログを対象にするため、以下も無フィルタで混入する:

- launchd 定期便（`claude -p` 等の cron 実行）のセッション
- Living Atlas アプリ内じゅもん（`TerminalPanel` 経由の embedded terminal）で起動したセッション

これらは koki が言う「手元のターミナル/VSCodeでLLMを使った」体験の主旨ではない。`buildSessionDigestForDate` は `HarnessRun` を対象に含める前に以下でフィルタする:

- アプリ内じゅもん由来のセッションは除外する（`TerminalPanel` 起動セッションを識別するマーカーが現状の `HarnessRun` に無いため、実装時に判定方法を確定する必要がある——例えば起動時の cwd が applied-loop 自身になる、または `tools` に `mcp__applied-loop__*` 系呼び出しのみで他ツール呼び出しが皆無、などのヒューリスティックを検討する）
- launchd 定期便セッションは、`turns` が極端に少ない・特定コマンド文言のみ等のヒューリスティックで除外を検討する。完全な除外が困難な場合は「集計に含めるが目立たせない」扱いも許容する

この判定方法の確定は実装時のタスクとする（設計時点でヒューリスティック案を複数残すに留める）。

**実装で確定した判定（2026-08-13 最終レビュー修正時）**:

- アプリ内じゅもん: `repo`（`normalizeRepoKey` で大小文字を吸収）が `applied-loop` かつ `tools` が `mcp__applied-loop__*` のみ → 除外。worktree ディレクトリ名（本リポジトリの規約は `.worktrees/<branch>` なので `repo` は `applied-loop` と接頭辞を共有しない）で走ったじゅもんは捕捉できない——既知の残課題として据え置く
- 定期便: `HarnessRun.turns < 2`（人間の user ターンが1回以下）→ repo によらず除外。`turns` は `collect-harness.mjs` が「role=user かつ content が文字列」の行を数えた値

### repo 名の正規化

`HarnessRun.repo` は LLM セッションの cwd basename（`collect-harness.mjs` の `repoFromPath`）、`DevEvent.repo` は git toplevel の basename（post-commit hook）で、由来が異なる。worktree（例: `applied-loop-feature-x`）やホーム直下起動（`repo` が `koki` になる等）では同一プロジェクトでも文字列が分裂しうる。

`src/lib/harness-repo-match.ts` が同種の課題（`HarnessRun.repo` と「監視対象repo」の突合、worktree接頭辞の折りたたみ）を既に解いている。`byRepo` への集約でも同じ正規化方針（basename 一致＋`{base}-`/`{base}_` 接頭辞での親への折りたたみ）を適用する。実装時は `harness-repo-match.ts` からこのロジックを抽出・共有するか、同等のヘルパーを新設する。

`HarnessRun.repo` が `null` のセッションは「不明」バケットとして `byRepo` とは別に集計し、repo別カードには出さない（`repoCacheReadRates` が `not: null` で除外している既存の扱いに揃える）。

### セッションダイジェストの算出方法

新規テーブルは作らない。既存データを読み取り時に突き合わせる、`loadMaterialsForDate`（`src/lib/daily-textbook.ts`）や `repoCacheReadRates`（`src/lib/harness-stats.ts`）と同じパターンに従う。

```
buildSessionDigestForDate(dateKey: string): SessionDigest

1. HarnessRun を dateKey の JST 日範囲で startedAt 抽出（日またぎセッションは startedAt の属する JST 日に帰属させる。他の日次集計と同じ dateKeyJST 基準）
2. 「外部セッションの定義」節のフィルタでアプリ内じゅもん・定期便セッションを除外する
3. 突き合わせは対象によって方式を分ける（時間窓の重なりではなく、repo を直接持つものは repo 一致を優先する）:
   - DevEvent（commit）/ Gate（しれん回答）: 自身が repo フィールドを持つため、「repo 正規化」節の方式で HarnessRun.repo と直接突き合わせる
   - Capture / GoalLink / RequirementLink: repo フィールドを持たないため、HarnessRun の [startedAt, endedAt] 時間窓との重なりで近似マッチする（下記「精度のトレードオフ」参照）

   **重要（ステップ2との関係）**: ステップ2で除外したセッションも、**時間窓の重なり判定には参加させる**（集計対象からは外れたままで、帰属先にはならない）。除外セッションが「最も特定的な窓」として勝った時刻の Capture 等は、**より遠い（＝窓の広い）外部セッションへ付け替えず、どこにも帰属させない**。付け替えると、実際にはアプリ内じゅもん・定期便の最中に起きた出来事を外部 repo の成果として過大計上してしまうため。除外セッションを最初から見えなくすると、まさにこの付け替えが起きる（ステップの順序だけを素直に読むとそうなるが、本設計の意図は「精度のトレードオフ」節どおり単一帰属であり、付け替えではない）。
4. repo → 領（`SystemKind`）の解決: その repo に紐づく直近の Gate（`DevEvent.repo` → `Gate.event`）に `classifySystem`（`atlas-taxonomy.ts`）を適用し多数決を取る——`load-atlas-data.ts` の `loadSystemStars` と同じ集計パターンを repo 単位に適用する。該当 Gate が無い repo は `region: null` とする（地図上の配置は Phase 3 側で `SYSTEM_REGION_POS[region] ?? FOG_REGION_POS` により解決し、`null` も含め該当エントリの無い kind は霧帯にフォールバックする——`atlas-world-map.tsx` の既存フォールバック規約どおり）
5. リポジトリ単位に集約し、SessionDigest 構造体を返す
```

```ts
type SessionDigest = {
  dateKey: string;
  sessionCount: number;
  repoCount: number;
  byRepo: {
    repo: string;
    region: SystemKind | null; // classifySystem 多数決の解決先。該当 Gate が無ければ null（地図配置は霧帯へ）
    sessionCount: number;
    captureCount: number;
    captureSamples: string[]; // Capture.title を最大3件程度、とびら展開部での想起手がかり用
    gateAnsweredCount: number;
    goalLinkCount: number;
    requirementLinkCount: number;
    commitCount: number;
    sessions: { sessionId: string; startedAt: Date; endedAt: Date | null }[];
  }[];
  unresolvedRepoSessionCount: number; // HarnessRun.repo が null のセッション数
};
```

`SystemKind` は `atlas-taxonomy.ts` 定義の8値（`cache | harness | design | ops | knowledge | verification | premise | other`）。ちずマップの5領域（知識/ハーネス/キャッシュ/設計/霧帯）とは別の軸であり、`fog` という `SystemKind` 値は存在しない——霧帯は「地図上の配置」側のフォールバック概念であることに注意する（`SYSTEM_REGION_POS` に無い kind、および `null` は `FOG_REGION_POS` に配置される）。

### 精度のトレードオフ

MCP ツール呼び出し側（`src/app/api/mcp/route.ts`）は現状どのセッションからの呼び出しかを記録していない。`HarnessRun` は別プロセス（`collect-harness.mjs`）が事後にログファイルから収集するため、書き込み時点で正確な `sessionId` を `Capture` 等に持たせることができない。

repo を直接持たない `Capture`/`GoalLink`/`RequirementLink` は時間窓の重なりによる近似マッチを採用する。複数セッションを同時並行で動かした場合、稀に取り違えが起きうる（例: 2つのターミナルで同時に Claude と Codex を動かし、ほぼ同時刻に別々の学びを捕捉した場合）。同一時間窓に複数の HarnessRun が重なった場合、対象の Capture 等は**最も時間窓が短い（＝最も特定的な）HarnessRun に単一帰属**させ、二重カウントしない。勝った HarnessRun が「外部セッションの定義」で除外されたものだった場合は、**帰属なし（どこにも数えない）**とする——次点の外部セッションへ繰り上げない。事後の振り返り・雰囲気を作ることが目的であり、監査精度は求められていないため、この近似を許容する。

正確な紐付け（MCP呼び出し時に `sessionId` を受け取り `Capture.sourceContext` 等に埋め込む）は、将来精度が問題になった場合の拡張候補として記録に留め、本設計では実施しない。

### 収集タイムラグ（許容する制約）

`collect-harness.mjs` は launchd により1時間おきにしか実行されない。そのため、外部セッションで作業した直後に Living Atlas を開いても、その活動が「きょうのきろく」やとびらに反映されるまで最大1時間の遅延がありうる。

本設計は「事後整理」を軸にしており即時反映は目的としていないため、この遅延は v1 として許容する。ただし「開いてもすぐ反映されない」体験が課題1（接続感）を損なう可能性があるため、収集間隔の短縮（例: 15分おき）は実装後の使用感を見て検討する将来候補として記録する（対象外セクション参照）。

### 集約粒度・情報量方針

1日に多数のセッションが発生しうるため、個々の `HarnessRun` をそのまま列挙しない。**repo単位に集約したカウント**を基本表示とし、詳細は展開式（`<details>` または既存の「くわしく読む」パターン）にする。Issue #3（情報量ブラッシュアップ）の方針と整合させ、新設するUI自体で情報過多を再発させない。

## Phase 1: にっきのとびら

**配置**: 日次詳細ページ（`/retro/[dateKey]`、`atlas-daily-textbook.tsx`）の冒頭。このページは教科書が**生成済み**（通常の章表示）と**未生成**（`!textbook` の早期 return、`atlas-daily-textbook.tsx:121` 以降）の2分岐があり、とびらは**両方の分岐に**表示する。commit がまだ無くセッションだけがある日（本設計が最も価値を出す日）は未生成分岐に該当するため、この分岐にとびらが無いと本設計の目的を達成できない。

生成済み分岐では既存の要約行（「材料 N · 章 M」）の直後に、未生成分岐では「材料: N件」の行の直後に、同じとびらコンポーネントを配置する。既存の PageFlip 本UI（`atlas-nikki-shelf.tsx` の月本棚・ページめくり体験）には一切触れない。

**内容**: `buildSessionDigestForDate` の結果を1行集約で表示し、`<details>` で repo別内訳を展開する。展開部には `captureSamples`（`Capture.title` の抜粋）を添え、「何をやったか」の想起手がかりを持たせる（課題1・3への効果を狙う）。

```
本日の外部セッション: 3件・2 repo → 学び +2・しれん回答 +1
▸ くわしく見る
  applied-loop: 2セッション（10:32-11:15, 14:02-14:40）・学び+2
    - 「プロンプトキャッシュは意味が近ければヒットする」
    - 「repo別のcache read率をダッシュボードに出す」
  triple-list: 1セッション（09:10-09:45）・しれん回答+1
```

セッションが0件の日は「まだ外部セッションの記録が無い」の1行のみ（うけばこ等の既存の空状態表現と揃える）。

## Phase 2: ホームのストリップ

**配置**: `atlas-dashboard.tsx`（ちず＝ホーム）のマップ直下、既存の凡例行の下。ただし「いまの一手」CTA（既存の主導線、単一CTA主義で設計されている）の**下**に置き、視線的に競合させない。マップ・凡例・いまの一手 の後、ページ末尾寄りの位置づけとする。

**内容**: 当日 `dateKeyJST()` の `SessionDigest.byRepo` を横並びカード（2〜4枚。5件超は「+N」で丸める）で表示。各カードは repo名・領アイコン・簡潔なカウント（例: 「applied-loop・2セッション・学び+2」）。クリックで `/retro/[dateKey]`（Phase 1 のとびら）へ遷移。

セッション0件の日（収集タイムラグ中を含む）は、ストリップ自体を非表示にする（空カードで場所を取らない）。

## Phase 3: 足あとピン

**配置**: `atlas-world-map.tsx` に、当日活動があった領へ足あとピンを追加。領の座標解決は `SYSTEM_REGION_POS[region] ?? FOG_REGION_POS`（`region` が `null`、または `SYSTEM_REGION_POS` に無い `SystemKind` の場合は霧帯へ）。

**視覚言語**（既存の `regionBrightness` との整理）:

- `regionBrightness` は面（領の塗りの明度）でドメイン習熟度を表す既存の別軸。今回の足あとピンは点（マーカー）なのでチャンネルが異なり、直接の衝突はない
- 足あとピンは「！」ピン（緊急アクション・金色・クリックで `/gates/[id]` へ）とは意味が違うため、**別アイコン（小さな足あと）・控えめな色**にする。「行くべき場所」ではなく「今日いた場所」を示す情報系マーカーであり、目立たせすぎない
- 同じ領に複数セッションがあれば、ピンを増やさず**数字バッジ**で集約。集約のキーは `SystemKind` の値そのものではなく**解決後の地図座標**にする——複数の `SystemKind` が同じ座標に落ちるため（`SYSTEM_REGION_POS` に無い `ops`/`other`、および `region: null` はすべて `FOG_REGION_POS`）。`SystemKind` 単位でまとめると、霧帯へフォールバックした複数 repo のピンが同座標に重なり、最後の1枚しかクリックできなくなる。ラベルは代表 repo 名＋「他N」、バッジはグループ内 `sessionCount` の合計とする
- 足あとピンを作るのは Phase 2 ストリップが実際に描く **先頭 N 件（`STRIP_MAX_CARDS`）に限る**。ストリップに存在しない repo のピンを立てると、クリックしてもハイライトすべきカードが無い「死にクリック」になるため、ピン構築とストリップ描画は同じ上限を共有する（`STRIP_MAX_CARDS` を export して両者で使う）。上限外の repo はストリップ側の「+N」表記でのみ示す
- スコープは**当日のみ**。過去の足あとは蓄積・永続表示しない（マップをクリーンに保つ）。恒久記録は Phase 1 のにっきのとびらが担う
- クリック時はページ遷移せず、同一画面内の Phase 2「きょうのきろく」ストリップの該当カードをスクロール/ハイライトする（マップとストリップは同じ ちず＝ホーム 画面にあるため、遷移なしで接続を体感できる）

## 実装順序

Fable調査での推奨順（安全な順）を踏襲する:

1. **にっきのとびら**（Phase 1）: `buildSessionDigestForDate` の新設とセットで実装。最も独立性が高く、既存画面への影響が最小。生成済み/未生成の両分岐対応を含む
2. **ホームのストリップ**（Phase 2）: Phase 1 のデータ関数を再利用するのみ。ダッシュボードへの追加、CTA競合を避ける配置
3. **足あとピン**（Phase 3）: `atlas-world-map.tsx` の改修を伴うため最後。Phase 2 のストリップとの連動（クリックでハイライト）も含む

各フェーズ独立にリリース可能。フェーズ間で `SessionDigest` のデータ形状を変更しない限り、後続フェーズを待たずに前のフェーズだけ先に使い始めてよい。

## テスト方針

- `buildSessionDigestForDate` は純粋なデータ変換関数として、既存の `loadMaterialsForDate` 系と同様にユニットテスト可能（実データ相当のフィクスチャで repo別集約・repo直接マッチ・時間窓マッチングを検証）
- 境界値テスト: HarnessRun が0件の日、repo が null のセッション、同一時間窓に複数 HarnessRun が重なるケース、日またぎセッション、`classifySystem` が `SYSTEM_REGION_POS` に無い kind を返すケースを含める
- 外部セッションのフィルタ（アプリ内じゅもん・定期便の除外）が正しく機能するかのテストを含める
- 各 Phase の UI コンポーネントは既存の 106件のテストスイートを壊さないことを `npx tsc --noEmit` / `npm test` で確認する
- ブラウザ実機確認（`npm run dev:all`、localhost:3100）を各 Phase 完了時に実施

## 非対象・懸念事項の記録

- `AtlasWorldMap` の自キャラ位置が現状ハードコード固定である点は、本設計のスコープ外（足あとピンは自キャラとは別の点として追加する。自キャラの動的化は別途検討）
- `/digest`（ルミナの週次語り）が現状ドックから孤立している問題（Fable調査で発見）も本設計のスコープ外。将来「にっき棚の週の扉」への統合が提案されているが、別トラックで検討する
- `collect-harness.mjs` の収集間隔短縮は将来候補（「収集タイムラグ」参照）
- 「外部セッションの定義」節のフィルタ判定方法は実装時に複数のヒューリスティック案から確定する
