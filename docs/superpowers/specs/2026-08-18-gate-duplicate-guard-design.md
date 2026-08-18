---
type: design
status: draft
date: 2026-08-18
tags: [living-atlas, gate, misconception, capture, dedup, llm-guard, mcp]
source_refs:
  [
    src/lib/gate.ts,
    src/lib/capture.ts,
    src/lib/harness-patterns.ts,
    src/lib/headless-llm.ts,
    src/lib/inbox-score.ts,
    src/app/api/mcp/route.ts,
    src/components/living-atlas/ukebako-view.ts,
    src/components/living-atlas/atlas-inbox-triage.tsx,
    src/components/living-atlas/atlas-inbox-detail.tsx,
    prisma/schema.prisma,
    docs/adr/0021-gate-duplicate-guard.md,
  ]
---

# しれん重複の入口ガード（B案）実装設計

## 改訂履歴

- 2026-08-18: koki実機ドッグフーディングの持ち越し項目（「しれん重複のB: 入口ガード」）として、Fableへ独立設計相談（`Agent`ツール・`model: "fable"`、実コード読み込みあり）を実施。結果をkoki確認の上、spec + ADR-0021として文書化。**実装は次セッション**

## 背景・問題

`Misconception`の重複排除は現状 `Capture`（受信箱）の完全一致文字列（`dedupeKey`）のみ。意味的に近い概念は無条件で別行の`Misconception`になる。

過去セッションのDB実測で意味的に近いクラスタが実在したが、内容は「重複」ではなく**誤解の精緻化チェーン**だった（詳細・実例は ADR-0021 参照）。完全自動マージは学習軌跡を破壊するため却下し、「LLM判定＋人間の最終選択」による入口ガードという方針は ADR-0021 で確定済み。本specはその実装アーキテクチャを定める。

## 前提の訂正（Fable調査で判明）

着手前の想定は「うけばこ一覧/詳細画面の『さいよう』ボタン→サーバーアクションで即 `confirmMisconception`」だったが、これは実architectureと異なる。実際は:

- `atlas-ukebako-fumi.tsx` / `atlas-inbox-triage.tsx` の「さいよう/みおくり」ボタンは、DBに書き込まない。`buildInboxTriageContext()`（`ukebako-view.ts:221`）で1件スコープのcontext文字列を組み、じゅもん（`AtlasAssist`、in-app terminal の Claude/Codex）へ渡すだけ（ADR-0018「アプリにアクションフォームを増やさない」）
- 実際の書き込みは、じゅもんの対話内でエージェントが MCPツール `triage_inbox`（`src/app/api/mcp/route.ts:490`）を呼んだときに初めて起きる。`triage_inbox` → `triageCapture()`（`capture.ts:16`）→ `confirmMisconception()`（`gate.ts:977`）という一本の経路
- この経路は in-app terminal 経由でも、外部の Claude Code / Cursor から直接手元 MCP を叩く経路でも**必ず`triageCapture`を通る**。したがって入口ガードのフック地点は UI ではなく `triageCapture` 内が正しい

## 検討した案と却下理由

| 案 | 概要 | 判定 |
|---|---|---|
| UI発の事前チェックAPI + 2段階accept | `/inbox/[id]`から先に類似チェックAPIを叩き、人間が選んでから本来のacceptを呼ぶ | **却下**。UIに新規の書き込み系APIを増やすことになりADR-0010/0018（アクション面はMCP）に反する。かつ外部からMCPを直接叩く経路がノーガードのまま素通りする穴が残る |
| `triageCapture`内の同期ガード（1ツール2往復） | `triage_inbox`呼び出し1回目で類似検知→`needs_decision`を返し何も書かない→エージェントが人間に確認→2回目の呼び出しで`resolution`付きで確定 | **採用**。唯一のチョークポイントを塞げる。既存の`buildInboxTriageContext`の「実行前に確認を取れ」慣習をそのまま拡張できる |
| `approve_goal_link`/`reject_goal_link`方式（新規ツール2つを追加） | 判定結果を保留行として保存し、承認/却下の専用MCPツールを新設 | **不採用（今回）**。既存の`GoalLink.confidence: "llm_suggested"`と同型で一貫性はあるが、ツール数が増える。`triage_inbox`の`resolution`パラメータ拡張の方が変更差分が小さいため今回はこちらを採用。将来ツールが増えて一貫性を優先したくなったら乗り換え可能な設計にしておく |
| embedding類似度検索 | 既存Misconceptionをベクトル化し類似度で比較 | **却下**。BYO-CLI経路（`headless-llm.ts`）にembedding手段がなく、実測件数（10件）の規模では過剰実装 |
| rootCauseで比較対象を絞り込む | 同じrootCauseのMisconceptionのみ比較 | **却下**。rootCauseがnullのケースがあり、精緻化チェーンの実例もverification→knowledgeとrootCauseの系統をまたいでいる |

## スコープ

### 対象（本設計）

- `triageCapture`内、`confirmMisconception`呼び出し直前にLLM判定ガードを追加
- LLM判定は `duplicate` / `refinement` / `unrelated` の分類のみ。割り込むか否かはコードが決定（`duplicate × 既存が open/regressed` の時だけ）
- `triage_inbox` MCPツールに `resolution` / `misconceptionId` パラメータを追加（省略可・後方互換）
- `Capture`に判定ログ列・選択結果列を追加
- `/inbox/[id]`に判定結果を表示する読み取り専用のDQ風ウィンドウ
- `link_existing`実行時: 該当gateを既存`Misconception`にconnectし、`nextReviewAt`を「現在値が null なら now+72h、値があれば min(現在値, now+72h)」に前倒し、statusは据え置き（ADR-0021で確定）

### 対象外（v2以降・別トラック）

- `duplicate × resolved`（再発疑い）専用の「regressedに戻す」選択肢（ADR-0021でv2送り確定）
- `onGateFailed`のCapture側dedup（`status: pending`のみ→`{in:["pending","accepted"]}`）は**別件として2026-08-18セッション内で既に修正済み**（このガードの前提修正ではあるが、本specのスコープではない）
- embedding検索・rootCause絞り込み（却下済み、上表参照）

## 設計

### データフロー

**現状**:
```
triage_inbox(captureId, action: "accept")
  → triageCapture(captureId, "accept")
    → confirmMisconception(title, gateId, rootCause)  ← 無条件でMisconception新規作成
    → Capture.status = "accepted"
```

**変更後**:
```
1回目: triage_inbox(captureId, action: "accept")
  → triageCapture(captureId, "accept", resolution: undefined)
    → checkMisconceptionOverlap(title)  ← 既存Misconception全件とLLM比較
      - duplicate × (open|regressed) が0件 → 通常通り confirmMisconception 実行して確定（v1と体感は変わらない）
      - duplicate × (open|regressed) が1件以上 → 何も書かず、Captureへ判定結果(overlapCheckJson)を保存
                                                  → { ok: "needs_decision", candidates: [...] } を返す
    → MCPツールは isError:false のテキスト＋候補一覧で応答
    → エージェントが対話でユーザーに2択を提示（buildInboxTriageContextの「実行前に確認を取れ」を拡張）

2回目: triage_inbox(captureId, action: "accept", resolution: "create_new" | "link_existing", misconceptionId?)
  → triageCapture側で「保存済みのoverlapCheckJsonが存在する場合のみresolutionを受理」（素通りゲート）
    - "create_new" → 通常通りconfirmMisconception実行
    - "link_existing" → 該当gateをmisconceptionIdへconnect、nextReviewAtを
      「現在値が null なら now+72h、値があれば min(現在値, now+72h)」に前倒し
      （**要注意**: `Math.min(null, x)` は null が 0 に強制変換され epoch になり
      「常に期限切れ」の誤動作を起こす。open/regressed な候補は出題中でまさに
      nextReviewAt=null であることが多く、これは稀なエッジケースではなく主要
      パスなので、必ず null 分岐を明示すること。opusレビュー指摘）
    → Capture.status = "accepted"
```

### スキーマ変更（`prisma/schema.prisma`）

```prisma
model Capture {
  // ...既存フィールドは変更なし...
  overlapCheckJson String?  // 判定ログ: {comparedIds, matches:[{id,concept,status,relation,reason}], checkedAt, error?}
  // 実装時にprovider列は落とした（runHeadlessLLMがどのCLIで応答したか返さず、書き込み専用の
  // フィールドになるため。全callerへの影響が大きい返り値変更を伴うため見送り）
  misconceptionId  String?  // 人間が選んだ最終的な Misconception id (紐付け先 or 新規作成id)
  misconception    Misconception? @relation(fields: [misconceptionId], references: [id], onDelete: SetNull)
}
```

`entryId`と対称な形（既存の学び側と同じ「紐付け先を持つ」パターン）。副次効果として、gate由来acceptのMisconceptionへのトレーサビリティが今まで無かったのも埋まる。

マイグレーション: `npx prisma migrate dev --name capture_overlap_guard` 相当（ローカルSQLiteのみ、dev.db/prisma/dev.dbの分裂に要注意 — 別件の既知issue、後述「余談」参照）。

### LLM判定（`checkMisconceptionOverlap`、新規関数）

配置候補: `src/lib/gate.ts`（`confirmMisconception`と同居）または新規 `src/lib/misconception-overlap.ts`。既存の`headless-llm.ts`呼び出しパターン（`inbox-score.ts`の`parseLLMJson`流儀）に揃える。

- **入力**: 新概念（`Capture.title` + `note` + gateの`contextSummary`）と、既存`Misconception`全件（`{id, concept, status, rootCause}`、実測10件のため全件でよい。保険として200件キャップ）
- **出力**: `{ matches: [{ id: string, relation: "duplicate" | "refinement" | "unrelated", reason: string }] }`（`unrelated`は明示的に返させず、matchesに載らないもの＝unrelated扱いでもよい。実装時にトークン節約の観点で判断）
- **プロンプトに明記する教訓**: 「resolved 済みの概念をより精密に言い直したものは duplicate ではなく refinement」（ADR-0021の実例をそのまま例示に使う）
- **タイムアウト**: `headless-llm.ts`の既定`TIMEOUT_MS=120_000`はMCPクライアント側のタイムアウトと競合しうるため、このガード用に短縮タイムアウト（30〜45秒）をオプション引数で渡す

### `triage_inbox` MCPツール変更（`src/app/api/mcp/route.ts:490`）

```ts
inputSchema: {
  captureId: z.string(),
  action: z.enum(["accept", "skip"]),
  resolution: z.enum(["create_new", "link_existing"]).optional()
    .describe("2回目の呼び出し専用。1回目でneeds_decisionが返った後にのみ有効"),
  misconceptionId: z.string().optional()
    .describe("resolution=link_existing のときの紐付け先"),
}
```

`TriageResult`型を3値に拡張:
```ts
export type TriageResult =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | { ok: "needs_decision"; message: string; candidates: Array<{ id: string; concept: string; relation: string; reason: string }> };
```
`needs_decision`時のMCP応答は`isError: false`（エージェントが失敗扱いして無闇にリトライしないよう、候補一覧をテキストに含めた正常応答として返す）。

### UI変更

- `/inbox/[id]`（`atlas-inbox-detail.tsx`）: `Capture.overlapCheckJson`が存在し`needs_decision`相当なら、DQ風の表示専用ウィンドウ（紺＋白ふち）で「にた ごかいが みつかった:『XXX』（わけ: …）」を出す。ボタンはDBを叩かず、`buildInboxTriageContext`に候補と2択の選び方をcontextとして積んでじゅもんへ渡すだけ（今日追加した単独完結じゅもんパターンを再利用）
- うけばこ一覧（`atlas-ukebako-fumi.tsx`）: 最小はneeds_decision状態のバッジ表示程度（Fable提案の最小案を採用）
- `Capture.status`は`"pending"`のまま据え置き（新規status値を増やすとfumi一覧クエリ・UI分岐に波及するため、判定はcolumnで持つ）

### エラー処理・フェイルセーフ

- LLM呼び出し失敗（レート制限・タイムアウト等）時は**fail-open**: ガードなしで`confirmMisconception`を実行し、応答メッセージに「類似判定は実行できなかった（理由）。未判定のまま新規作成した」と明示する
- `overlapCheckJson`にエラー内容も記録し、後から「未判定のまま作成されたMisconception」を検索できるようにする（サイレント失敗の禁止、ai-feature-preflight Q7）
- fail-openを選ぶ理由: ガード失敗でaccept自体をブロックすると、コアループ（うけばこ仕分け）が従属機能（重複チェック）の人質になる。最悪ケースでも「今日と同じ重複が1件できる」だけで非破壊

## ゴールデンケース

1. **duplicate**: 既存open「useEffectの依存配列は参照比較で判定されると誤解」に対し、新規「useEffect の deps は毎レンダー浅い比較される、という理解のずれ」→ `duplicate × open` → `needs_decision`
2. **refinement（実データを模す）**: 既存resolved「キャッシュのヒットを『識別子や意味の近さで引き当てる参照』だと捉えており…」に対し、新規「キャッシュのヒット判定を『全体が完全一致しているか』という全体一致モデルで捉えており、『先頭からの連続一致＝プレフィックス』という構造を…」（ADR-0021の実例そのもの）→ `refinement` → 割り込まず新規作成＋注記
3. **unrelated**: 既存「SQLiteのWALモードは並行読み取り可能」に対し、新規「Reactのuseeffectは…」→ `unrelated` → 素通し
4. **LLM失敗時のフェイルセーフ**: `headless-llm.ts`をモックしてエラーを投げさせ、fail-open（新規作成＋メッセージにその旨明記＋`overlapCheckJson.error`記録）を確認
5. **同一バッチ連続accept**: 1件目のacceptで新規作成された`Misconception`を、2件目のacceptの類似判定が正しく比較対象に含められるか（accept時点でクエリすることの検証。capture時点で事前計算する設計だとここが漏れる）

### テスト方針

- 二段構え（ai-feature-preflight Q3-a）:
  - 決定論的に保証すべき部分（状態機械・`resolution`受理ゲート・fail-openの分岐）は`headless-llm.ts`をモックした通常の単体テスト（`node:test`）
  - LLM分類そのもの（ゴールデンケース1〜3）は「関係カテゴリが一致するか」という性質のみをアサートする手動evalスクリプト（`grading-probe`と同様の位置づけ）。CIには入れない
- 実機確認: 実データ（10件のMisconception）に対し、ADR-0021の実例ペア（ケース2）が実際に`refinement`と判定され割り込まないことを確認

## 要koki確認だった論点（2026-08-18 解決済み）

| 論点 | 結論 |
|---|---|
| link_existing実行時の挙動 | Fable案通り（gate connect + nextReviewAt前倒し + status据え置き） |
| refinement/resolved類似の扱い | 注記のみ、割り込まない |
| duplicate×resolved（再発疑い） | v1は注記のみ、v2で「regressedに戻す」選択肢を検討 |
| 今回の実装範囲 | spec + ADR化のみ。実装は次セッション |

## 余談（スコープ外・次回以降の別件）

Fableの調査中に`prisma/dev.db`が0バイト（本物は`./dev.db`、2.7MB）である事実が見つかった。`.env`の`DATABASE_URL="file:./dev.db"`が相対パスのため、cwd次第で分裂しうる状態。今回の変更・マイグレーションはリポジトリルートから実行する限り実害はないが、別途koki確認の上で対応要否を判断する。
