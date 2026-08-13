---
type: design
status: approved
date: 2026-08-13
tags: [living-atlas, ui, mcp, realtime]
source_refs:
  [
    docs/adr/0018-reachable-mcp-cloud.md,
    docs/adr/0019-core-loop-phases.md,
    .claude/progress/living-atlas-ui-handoff.md,
  ]
---

# DS風二画面ターミナル連動UI 設計

## 背景・目的

Living Atlas のトップページには既に「ちず/ステータス（上段）」と「じゅもんターミナル（`AtlasAssist`、下段・開閉トグル式）」が存在する。この2つを Nintendo DS 風の常設二画面レイアウトに統合し、ターミナル内で Claude/Codex が MCP ツールを呼ぶたびに上画面がリアルタイムに反応する体験を作る。

koki 確定の狙い（2026-08-13 brainstorming セッションより）: **実用性（今何が起きているかの可視化）とエンタメ性（DS を操作しているような没入感）を両方高品質に実現する**。どちらかを優先して他方を犠牲にしない。

## スコープ

### MVP（本設計の対象）

- 配置: トップページ（`src/app/(app)/page.tsx` → `AtlasDashboard`）に常設
- 反応対象の MCP ツール3種（正式名、2026-08-13 実装調査で訂正済み）: `answer_gate`（しれん回答） / `save_task_mappings`（任務紐付け） / `capture_learning_candidate`（うけばこ登録）
- 単一ユーザー・ローカル `next dev` 実行のみを前提

### 明示的にスコープ外（将来検討・Obsidian human_task 起票済み）

- 他ページ（`/gates/[id]` 等）への展開
- 対象ツールの追加（`route.ts` には24件の `registerTool` 呼び出しがある）
- Vercel 等クラウドデプロイ、他者へのプラグイン配布（`00 Inbox/Tasks/2026/08/2026-08-13T140138...applied-loopのホスティング-配布戦略...md` に別途起票済み）

## アーキテクチャ

### 制約となる事実

- MCP ツール呼び出しが発生する `src/app/api/mcp/route.ts` は Next.js 本体（`next dev -p 3100`）のプロセス内で動く
- ターミナルの WebSocket（`ws://127.0.0.1:3101`）は別プロセス `scripts/terminal-server.mjs`（PTY 中継専用）
- この2プロセスは `npm run dev:all` で `concurrently` 起動される、互いに独立したプロセス

### ライブ配信経路: SSE（3100番プロセス内、新規）

Web 調査済み（2026-08-13）: Next.js App Router の Route Handler は Web Streams API で SSE をネイティブサポートしており、カスタムサーバー不要。単一ユーザー・ローカル完結という要件下では Socket.io 等の自前 WS サーバー構築や Pusher/Ably/Supabase Realtime 等のマネージド Pub/Sub は複雑度が増すだけで恩恵が薄く、不採用。

- `route.ts` と同じプロセス内に SSE 用 Route Handler を新設し、ブラウザは `EventSource` で購読する
- 3101番のターミナル WS サーバーには一切手を入れない（PTY 中継専用の責務を維持）
- 実装時の注意点（調査結果）:
  - `ReadableStream` の `start()` 内でブロッキングせず即座に `Response` を返す（でないと Next.js がハンドラ完了までバッファリングする）
  - `export const dynamic = 'force-dynamic'` を明示、Content-Type は `text/event-stream`
  - Next.js の HMR は別チャンネル（`webpack-hmr`）なので衝突リスクは低いが、SSE 接続を確実にクローズしないと接続数上限に達し HMR を巻き込んで詰まる事例報告があるため、クリーンアップ（`disposed` フラグ等）は必須

### データフロー

イベント発行ポイントはツールごとに異なる（2026-08-13 実装調査で確定）。

**`save_task_mappings` / `capture_learning_candidate`**（同期的に完結する処理）:

```
[ターミナル内 Claude/Codex]
  → MCP ツール呼び出し
  → route.ts の各ハンドラ内で DB 保存が成功した直後にイベント発行
  → SSE Route Handler が購読中の接続へ配信
  → ブラウザの EventSource が受信 → 演出発火
```

**`answer_gate`**（合否は非同期採点で確定するため、ツール呼び出し自体ではフックできない）:

```
[ターミナル内 Claude/Codex]
  → answer_gate 呼び出し → acceptGateAnswer が status:"answered" を保存し即座に応答を返す
  → （応答後、Next.js の after() フックで）gradeGate(gateId) が非同期に走る
  → gradeGate 内、status を "passed"/"failed" に更新した直後（src/lib/gate.ts:791 付近）にイベント発行
  → SSE Route Handler が購読中の接続へ配信 → ブラウザが受信 → 演出発火
```

`gradeGate` は `gate-answer.ts`（MCP/terminal/battle 共通経路）・`actions.ts`（Server Action）・`requeue-failed-grading.ts`（再採点キュー）の計4箇所から呼ばれるが、フックを `gradeGate` 内部に置くことで呼び出し元ごとの個別対応なしに全経路をカバーできる。

- イベント発行は**成功した場合のみ**（`answer_gate` は pass 判定時のみ、他2ツールは処理成功時のみ）。失敗・fail 判定時は演出を出さない
- MVP は単一ブラウザ・単一セッション想定のため、イベントに宛先ルーティング（誰宛か）は持たせない。将来の複数タブ対応は将来検討事項

## レイアウト・コンポーネント設計

koki 承認済みモック（visual companion、2026-08-13）: DS実機風の筐体。

- 上画面: 全幅。既存の「ちず（`AtlasWorldMap`）＋ステータス（`StatusCommandPanel`）」横並び構成を維持
- ヒンジ: 上下画面の間に蝶番風の装飾（実機を模した意匠要素）
- 下段: 3カラム「十字キー（装飾）｜ターミナル画面（`AtlasAssist` 内の `TerminalPanel`）｜ABXYボタン（装飾）」。十字キー・ABXYボタンは実機を模した静的な装飾要素（操作機能は持たない）
- ターミナルの開閉: 初期表示は常時開いた状態（DS体験を常時見せる）。ただし**折りたたみボタンは残す**（マップを広く見たい時のための逃げ道）
- 画面縁の演出: 金色グロー。平常時は薄く発光、MCPツール発火時にパルス発光。SSE 未接続時はグローを消灯/グレーアウトして状態を示す

## 演出設計（C軸＝ステータス数値ライブ更新を基本に、A/B軸を要所に付加するハイブリッド）

| ツール | 演出 |
|---|---|
| `answer_gate`（`gradeGate` で pass 確定時） | マップの quest ピンが撃破済み表示に変化 **＋** ステータスパネルの EXP バーがその場で伸びるアニメーション（両方同時） |
| `save_task_mappings` | 画面下部に薄い通知バナー（「今の任務と関連しそうな学びを検知」等） |
| `capture_learning_candidate` | マップ／ステータス脇に小さなアイコンがバウンドする軽量アニメーション |

**制約（2026-08-13 実装調査で判明）**: `AtlasWorldMap` の quest ピン（！マーク）は `pendingGate`（単数）からのみ生成され、`id: "quest-1"` 固定。複数 gate の個別ピンは存在しない。そのため「quest ピンが撃破済みに変化」演出は、**今 pass したゲートが、現在表示中の唯一の quest ピンと一致する場合のみ**成立する。一致しない場合（別のゲートを裏で採点していた等）はピン演出をスキップし、EXP バー伸長のみ発火する。

- 通知バナーが複数同時発火した場合はスタックして縦に積み、数秒で自動フェードアウトする

## エラーハンドリング

- SSE 接続断: `EventSource` の自動再接続に委ねる（ブラウザ標準機能）。UI 上は画面縁のグローを消灯/グレーアウトして「未接続」を視覚的に示す
- MCP ツール呼び出し自体が失敗した場合: イベントを発行しない（演出なし）。既存のターミナル出力・デブリーフ表示で失敗は別途分かるため、演出面での追加のエラー表現は持たせない
- 開発中の Route Handler 再コンパイルによる SSE 切断: `EventSource` の自動再接続で実害は小さい見込み（Web 調査より）

## テスト方針

- このプロジェクトのテストは Node.js 組み込み test runner（`tsx --test src/lib/*.test.ts`、Vitest/Jest ではない）。UI コンポーネントの自動テストの慣習はなく、ブラウザ実機確認が正
- イベント発行ロジック（`gradeGate` 内フック・各ハンドラ内フックが成功時のみ発火するか）は `src/lib/*.test.ts` で単体テスト
- SSE Route Handler の疎通・イベント配信・演出はブラウザ実機で確認（`npm run dev:all` 起動状態で対象ツールを実際に叫び、演出が発火するか目視）
- 既存の `TerminalPanel` / `AtlasAssist` の動作（xterm.js 接続、認証、再起動 UI）は無改造なので回帰テスト対象外

## 追補: 筐体UIのサイズ・ディテール改善（2026-08-13 実機確認後）

koki が実機（`npm run dev:all`）でトップページを確認した結果、2点のFB:

1. **13インチデスクトップの標準的なビューポート（1440×750想定）内に筐体全体が収まらない**。旧実装は上画面（`AtlasWorldMap` aspect-[16/11] 相当）・下画面（`TerminalPanel` の `h-[60vh] min-h-[420px]`）とも高さ制約が緩く、合計すると常にスクロールが必要な高さになっていた
2. **筐体UI（`AtlasConsoleShell`）自体のディテールが単調で、内側のゲーム画面（DQ風のちず/ステータス/ターミナル）に見劣りする**。単純な3色グラデーション・3pxのシンプルな画面枠・単純な矩形/円のみのボタン装飾では実機のような質感が出ていない

koki 承認済みの方向性（visual companion、2026-08-13 追補セッション）: **横長レイアウトは許容**（"横長は仕方ないね" — 13インチの横幅に対して縦を大胆に圧縮する形で解決する）。

### 実測調査（重要な前提修正）

ブラウザ実機（`npm run dev:all`、1440×868 ビューポート）で `AtlasConsoleShell` 導入後のトップページを計測したところ、筐体全体の実測高さは **1670.78px**（ビューポート高さの約1.9倍）だった。内訳:

- 上画面（`items-stretch` でマップとステータスパネルの高い方に揃う）: 755px — マップ本体（`AtlasWorldMap`、`aspect-[16/11]`）は459pxだが、ステータスパネル側（Lv./EXP、ステータス一覧5項目、デイリークエスト4項目）がそれより高く、そちらに引き伸ばされている
- ヒンジ: 12px
- 下段（`TerminalPanel` の `h-[60vh]` が支配的）: 843px

**この時点で判明した重要な事実**: 筐体の見た目（グロー・ヒンジ・ボタン装飾）だけを調整しても 13インチには収まらない。マップの表示サイズ、ステータスパネルの情報量、ターミナルの高さという「中身のレイアウト」まで踏み込んで圧縮する必要がある。koki 確認の上、**スコープをこの3要素の圧縮まで拡大**することで合意した（旧版のこのセクションは「筐体の見た目のみ」を前提にしており、誤りだったため全面差し替え）。

### サイズ（実装中の3ラウンド調整を経て確定）

当初は実寸 1440×750 に上画面348px/下画面303pxで収める設計だったが、実装・ブラウザ実測を重ねる中で以下の事実が判明し、方針を修正した:

1. `TerminalPanel` 本体の高さ上書きだけでは足りない。**`AtlasAssist`自体のヘッダー（タイトル/セリフ/意図表示、約123px）と「ひとこと」通知バナー（約76.5px）が `TerminalPanel` の外側にあり**、下画面の実測高さが目標303pxに対し619.6pxまで膨らんだ
2. koki 実機確認の結果、**上画面（ちず/ステータス）をメイン、下画面（ターミナル）をコンパクトな脇役**とする方針に転換（当初の「ほぼ均等配分」から変更）
3. ステータスパネルの表示も、Lv./EXP行とステータス一覧タブを縦積みにする従来構成では嵩張るため、**ステータス一覧を常時 Lv. 表示の横に配置し、タブ切り替え（ステータス/弱点）自体を廃止**する構成に変更（弱点は常時表示の件数バッジのみに縮小）

**確定した数値**:
- 上画面（グロー枠込み）: **440px**（メイン画面。`.atlas-console-top-screen { height: 440px }`）
- 下画面のターミナル本体: **200px**（`.atlas-console-lower-screen [class*="min-h-[420px]"] { height: 200px; min-height: 200px; }`）。ヘッダー・接続済み表示を含む下画面全体の実測は約355px

**上画面の内訳**: `AtlasConsoleShell` 内で上画面コンテナに `height: 440px` を明示指定し、中を `display: flex` でマップ（`flex: 1.6`）とステータスパネル（`flex: 0.9`）に横並び分割する。既存の `AtlasWorldMap` の `aspect-[16/11]` は撤去し、コンテナ高さいっぱいに描画されるよう変更（Canvas は `width={320} height={160}` に変更。タイル座標系は `TW`/`TH` がCanvas解像度から自動導出されるため `fillBlob` 等の座標値自体は無改造）。ステータスパネル側は、デイリークエストの表示件数を4件から2件に絞り（3件目以降は非表示。別動線は設けない）、フォントサイズを縮小。マップ側の「いまの一手」CTA（`primaryCta` 表示）は削除済み（koki 確認済み）。**ステータス一覧（キャッシュ/ハーネス/設計判断/知識/確認の5項目、★表示）は Lv./EXP と同じブロック内、Lv. 表示の横に常時表示**し、既存の「ステータス/弱点」タブ切り替え UI は廃止する。弱点は「⚠ 弱点N件 →」の小さいバッジ表示のみ残し、クリックで詳細（`/gates` 等の既存導線）に飛べるようにする。

**下画面の内訳**: `TerminalPanel` 自体は無改造のまま、CSS 属性セレクタ（`.atlas-console-lower-screen [class*="min-h-[420px]"]`）で `TerminalPanel` のルート要素の高さだけを上書きする。加えて `AtlasAssist`（`src/components/living-atlas/atlas-assist.tsx`）に新規 `compact?: boolean` prop を追加し、`compact` 時は次を変更する（`compact` 未指定時は完全に無変更、他の呼び出し元 `gate-terminal-section.tsx` 等には一切影響しない）:
- タイトル／`AtlasVoicePlain`（セリフ・説明）／意図表示のブロックを非表示
- 「ひとこと（あなた向け）」通知バナーを非表示
- サービス選択・モデル選択・開閉ボタンの3行スタック（`flex flex-col ... sm:items-end`）を、`compact` 時のみ横一列（`flex flex-row flex-wrap items-center gap-3`）に変更。機能は完全に維持

`atlas-dashboard.tsx` の `bottomScreenContent` 内 `<AtlasAssist .../>` 呼び出しに `compact` を追加する。

**実測 shellHeight**: 853.6px（1440幅ビューポートで実測。旧目標749pxからは超過しているが、「上画面をメインにする」という方針転換によるトレードオフとして koki 承認済み）。

### ディテール（立体感）

visual companion で承認済みの意匠要素（CSSのみ、画像不使用の既存方針を継続）:

- 筐体表面: 複数レイヤーのグラデーション（左上ハイライト＋左上→右下のダークグラデーション）、底面に設置影（machine が机上に置かれている質感）
- 画面ベゼル: 厚み5px、内側グロー＋斜めグレア＋inset シャドウの多層構成
- ヒンジ: 金属シリンダー風（放射グラデーションの軸受け、複数の影レイヤー）
- 十字キー／ABXYボタン: inset ハイライト＋シャドウで凹凸感、ABXYは放射グラデーションで光沢
- ブランドプレート「Living Atlas」の刻印風テキスト、スピーカーグリル風のドットパターン装飾

### スコープ（実測後に拡大）

- `AtlasConsoleShell`（`src/components/living-atlas/atlas-console-shell.tsx`）と `src/app/atlas-living.css` の該当ルール（筐体の見た目）
- `AtlasWorldMap`（`src/components/living-atlas/atlas-world-map.tsx`）: `aspect-[16/11]` を撤去し、親コンテナの高さに追従する形へ変更。Canvas 内部解像度・地形描画座標も新比率に合わせて調整
- `StatusCommandPanel`（`atlas-dashboard.tsx` 内）: デイリークエスト表示件数の削減、フォントサイズ調整による圧縮
- `TerminalPanel` の高さをDS筐体内でのみ CSS で上書きする仕組みの追加（`TerminalPanel` 自体は無改造）
- `AtlasAssist`（`src/components/living-atlas/atlas-assist.tsx`）に `compact?: boolean` prop を追加し、DS筐体内でのみタイトル/説明/通知バナーを省略、サービス/モデル選択を横一列化（他の呼び出し元は無影響）
- `StatusCommandPanel`（`atlas-dashboard.tsx` 内）のレイアウト再構成: 「ステータス/弱点」タブ切り替えを廃止し、ステータス一覧を常時 Lv./EXP 表示の横に配置。弱点は件数バッジのみに縮小

それ以外（SSE配信・イベント発行ロジック・演出トリガーの仕組み）は無変更。

## 将来の拡張（本設計のスコープ外）

- 全ページへの展開（今回はトップページのみ検証してから判断、と koki 確定）
- 対象 MCP ツールの追加
- ホスティング・配布戦略の見直し（クラウドデプロイ時は SSE の前提「単一プロセス・単一ユーザー」が崩れるため、別途設計要。Obsidian に人間タスクとして起票済み）

## 参照

- ENTRY: `.claude/progress/living-atlas-ui-handoff.md`
- Obsidian human_task（企画練り直し起票）: `00 Inbox/Tasks/2026/08/2026-08-13T131551+0900-humantask-DS風二画面タ-ミナル連動UIを企画として練り直す-d9481581f1.md`
- Obsidian human_task（ホスティング戦略、本設計のスコープ外として分離）: `00 Inbox/Tasks/2026/08/2026-08-13T140138+0900-humantask-applied-loopのホスティング-配布戦略を検討する-Vercel等クラウドデプロイ-vs-プラグイン配布してロ-カル起動-0eebac9132.md`
- 既存実装: `src/components/terminal-panel.tsx`, `src/components/living-atlas/atlas-assist.tsx`, `src/components/living-atlas/atlas-dashboard.tsx`, `src/app/api/mcp/route.ts`
