---
type: design
status: draft
date: 2026-08-16
tags: [living-atlas, harness, nikki, daily-textbook, material-capture]
source_refs:
  [
    prisma/schema.prisma,
    src/lib/daily-textbook-shared.ts,
    src/lib/daily-textbook.ts,
    src/lib/harness-repo-match.ts,
    src/components/living-atlas/atlas-harness.tsx,
    src/components/living-atlas/atlas-daily-textbook.tsx,
    docs/adr/0020-daily-retro-knowledge-loop.md,
  ]
---

# 日次教科書「とりこぼし」解消 — 三層契約＋週のしょ 設計

## 改訂履歴

- 2026-08-16: koki への実機FB（`/harness`の捕捉率39〜44%の日が複数）を発端に、Fable探索2ラウンド（案A〜C→D・E・Fの発見）を経て確定

## 背景・問題

`/harness`（どうぐ）の「しくみのこどう」パネルは、材料（commit）が日次教科書へどれだけ届いたかの捕捉率を出す。直近9日間で捕捉率が39〜44%まで落ちる日が複数確認された。

原因は `src/lib/daily-textbook-shared.ts` の `clusterMaterialsIntoChapters`（824行〜）:

- 材料を `repo` 単位でグルーピングし、件数上位 `TEXTBOOK_MAX_CHAPTERS`(5) repo だけを章にする。6 repo 目以降は**丸ごと全件**`droppedMaterialIds`行き
- 章になった repo でも、直近 `TEXTBOOK_MAX_MATERIALS_PER_CHAPTER`(8) 件だけが残り、残りは overflow としてやはり `droppedMaterialIds` へ

UI（`atlas-harness.tsx`）には「かまどでこぼれた6は、まだ消えてはおらぬ。いまひろえばきょうの教科書に間に合う」という文言があるが、**実際に拾い直す導線は存在しない**。DevEvent 自体はDBに全量残っているため実データは消えていないが、教科書という「読む形」には二度と現れない。

`docs/adr/0020-daily-retro-knowledge-loop.md` §6-3 は既に「あふれた分は`parked`枠へ」と明記していたが、その枠（回収導線）は未実装のままだった。本設計はその実装である。

### koki の要件（本人の言葉）

> 上限設定して学びたかったことが拾えないほうがダメだと思う。レベル別に保存してユーザーが学ぶものを選択できたりそういった方法で、学びが多すぎて大変とならないような仕組みにしよう。

1. 材料を上限で切り捨てて実質消すのは絶対ダメ。全部どこかに保存し、発見可能にする
2. 1日に全部読ませる強制は避ける（学びすぎて大変、という懸念も本物）
3. ユーザーが「今日はこれを学ぶ」を選べるようにする

## 検討した案と却下理由

Fableに2ラウンドの独立探索を依頼した（1ラウンド目: 案A/B/C比較、2ラウンド目: 他ドメイン調査による対抗案探索）。

| 案 | 概要 | 判定 |
|---|---|---|
| 案B | 材料1件単位でトリアージ | 却下: 受信箱の仕分けと二重の決断疲れになる |
| 案C | キャップ維持＋翌日へ自動繰り越し | 却下: 「選べる」を満たさず、忙しい週に雪だるま式に溜まり「その日の物語」が崩れる |
| 案A | 材料は全量を必ず「章」として保存し、あふれた分は畳んだ「あとまわしの章」として1タップで開閉できる | **構造的な欠陥が判明**: `clusterMaterialsIntoChapters`の品質不変条件（章が2つ以上あるとき本文が相互に異なること）を守る安全網`ensureChapterCopyDiversity`は、テンプレ衝突時に機械的に「（章N）」を付けるだけ。案Aは章数が増えるほどこの機械サフィックスに頼る場面が増え、**保存すればするほど文章の質が劣化する**自己矛盾を抱える |
| **案D** | 材料に「章という形」を強制せず、「保存と発見可能性」だけを契約する。章（精読）／よみもの帯（1行サマリ、既読管理なし）／書庫（検索のみ、読む前提ゼロ）の三層に分離（HEYメールのImbox/Feed/Paper Trail型） | **採用** |
| **案E** | 週に1回、その週の未消化材料だけを再圧縮して「週のしょ」を1冊生成する（GTD週次レビュー×Spotify Discover Weekly型。案Cのキュー方式とは異なり「編み直す」ため雪だるまにならない） | **採用**（D単体では「保存先はあるが定期的な回収儀式がない」というGTDが警告する墓場化を避けられないため必須） |
| 案F | あふれた材料を「討伐依頼」として残数表示する掲示板（DQ的スキン） | 保留。Dの書庫に被せる動機付けレイヤーとして将来検討。実装面積が大きく今回のスコープ外 |

**推奨: 案D＋E。** Dが要件1〜3を満たし、Eが唯一の持続的な回収導線になる。

### 他ドメイン調査で見つかった採用済みの工夫

- **未読数バッジを出さない**（HEYの"countless"設計）。よみもの帯の件数表記は控えめな地の文とし、警告色にしない
- **滞留の可視化と正直な減衰**（Kanban aging + read-it-later系の自動アーカイブ）。よみもの帯の各項目に経過日数を出し「あとN日で書庫へ」と宣言する
- **自動キュレーションのデフォルトは変えない**（Duolingoが2022年にスキルツリーを廃止し単線に戻した教訓）。今日の5章は変更せず、「選ぶ」は降りたい時だけ効くオプトインに留める
- **KPIの再定義**（Discover Weekly型の教訓）。「日次ビューへの捕捉率」ではなく「必要な時に組み込まれたか」を測る

## スコープ

### 対象（本設計）

- `MaterialBand`（よみもの帯・書庫）の新設
- `DevEvent.incorporatedAt` の追加（捕捉の正典）
- 「編纂する」server action（帯の材料を正式な章に昇格）
- `WeeklyTextbook` / `WeeklyTextbookChapter` / `WeeklyTextbookCheck`（週のしょ）
- にっき・どうぐ双方のUI変更
- しくみのこどう指標の再定義

### 対象外（別トラック）

- 案F（クエスト掲示板スキン）
- `droppedMaterialIds` 列自体の削除（読み出し互換のため当面残す。新規生成では常に `[]`）
- LLMベースの重要度分類（規則ベースのみ。第一段はLLM呼び出しゼロを維持）

## データモデル

### 新規: `MaterialBand`（よみもの帯・書庫の実体）

```prisma
model MaterialBand {
  id                String   @id @default(cuid())
  dateKey           String   // 材料を受け取った日 (JST, "2026-08-16")
  repo              String
  materialIds       String   // JSON string[]（あふれた DevEvent.id 全量）
  digest            String   // 1行サマリ（既存 summary の結合。LLM不要）
  count             Int
  compiledChapterId String?  // 「編纂する」で章に昇格したらセット
  createdAt         DateTime @default(now())

  @@unique([dateKey, repo])
}
```

「帯」と「書庫」は別モデル・別状態を持たない。**dateKeyの新旧だけで表示を出し分ける**（直近7日＝帯、それ以前＝書庫の検索対象）。余計な「アーカイブ移動」の状態遷移を作らないための意図的な単純化。

### 既存モデルへの追加: `DevEvent.incorporatedAt`

```prisma
model DevEvent {
  // ...既存列...
  incorporatedAt DateTime? // 章（きょう／編纂／週のしょ）のいずれかに組み込まれた瞬間にセット
}
```

これが「捕捉」の唯一の正典になる。しくみのこどうの指標は「直近N日で受信した材料のうち `incorporatedAt` が付いている割合」で直接計算でき、章側の状態から逆算しないためズレが起きない。

### 新規: `WeeklyTextbook` / `WeeklyTextbookChapter` / `WeeklyTextbookCheck`

`DailyTextbook` 系とほぼ同型（フィールド構成を揃え、実装・クエリパターンを流用しやすくする）:

```prisma
model WeeklyTextbook {
  id            String   @id @default(cuid())
  weekKey       String   @unique // ISO週 "2026-W33"（JST基準）
  title         String
  lead          String?
  status        String   @default("ready")
  materialCount Int      @default(0)
  chapterCount  Int      @default(0)
  createdAt     DateTime @default(now())
  chapters      WeeklyTextbookChapter[]
  checks        WeeklyTextbookCheck[]
}

model WeeklyTextbookChapter {
  id           String   @id @default(cuid())
  weeklyId     String
  weekly       WeeklyTextbook @relation(fields: [weeklyId], references: [id], onDelete: Cascade)
  index        Int
  title        String
  oneLiner     String
  bodyPlain    String
  bodyDeep     String?
  diagramKind  String   @default("generic")
  evidenceJson String   @default("[]")
  materialIds  String   @default("[]")
  checks       WeeklyTextbookCheck[]

  @@unique([weeklyId, index])
}

model WeeklyTextbookCheck {
  id         String   @id @default(cuid())
  weeklyId   String
  weekly     WeeklyTextbook @relation(fields: [weeklyId], references: [id], onDelete: Cascade)
  chapterId  String?
  chapter    WeeklyTextbookChapter? @relation(fields: [chapterId], references: [id], onDelete: SetNull)
  index      Int
  question   String
  mastery    String?
  answeredAt DateTime?

  @@unique([weeklyId, index])
}
```

### `DailyTextbookChapter` への追加（再生成の安全性のため）

```prisma
model DailyTextbookChapter {
  // ...既存列...
  source String @default("auto") // "auto"（毎日自動生成の5章）/ "compiled"（帯から編纂）
}
```

**理由（Fable 1ラウンド目が発見した落とし穴の応用）**: `generateDailyTextbook` は現状 delete→create で作り直す。「編纂する」で追加した章がこのサイクルに巻き込まれると、再圧縮のたびに編纂済み章とその回答（Mastery）が消える。`source="compiled"` の章は再生成時に**削除対象から除外**し、`source="auto"` の5章だけを作り直す。

## 生成ロジックの変更

`clusterMaterialsIntoChapters` 自体（824〜865行）は**変更しない**。案Aと異なり全量を章にしようとしないため、既存の品質不変条件と衝突しない。

### 1. 日次生成（`generateDailyTextbook`）— 追加処理のみ

```
既存: materials → clusterMaterialsIntoChapters → { chapters(5), droppedMaterialIds }
                                                          │
                                                          ▼
新規: droppedMaterialIds を repo 単位で再グルーピング → MaterialBand へ upsert（dateKey, repo キー）
新規: chapters の keptMaterialIds に対応する DevEvent に incorporatedAt をセット
```

`droppedMaterialIds` 列自体は互換のため書き込みを維持するが、実質の「とりこぼし」の正典は `MaterialBand` に移る。

### 2. 「編纂する」server action（新規）

```
入力: MaterialBand.id
処理:
  1. band.materialIds から DevEvent を取得
  2. draftChapterFromRepo（既存関数、clusterMaterialsIntoChapters 内で使用中のものを export して再利用）で章 draft を作る
  3. 今日の DailyTextbook に source="compiled" の章として追加（index は既存 max+1）
  4. distillChecks 相当のロジックで確認問いを1つだけ追補（既存の @@unique([textbookId, index]) と整合するよう連番で追加）
  5. 対象 DevEvent の incorporatedAt をセット
  6. band.compiledChapterId をセット（以後この帯項目は「編纂済み」表示に切り替え、再編纂はさせない）
```

今日の5章（source="auto"）は無傷のまま。ページ遷移なしでその場に章が展開される想定（`atlas-daily-textbook.tsx` の既存レンダリングパスにそのまま乗る）。

### 3. 週次生成（新規バッチ、既存の夜間ジョブ相当の仕組みに追加）

```
対象: 直近7日（JST週境界）の DevEvent のうち incorporatedAt が null のもの
処理: clusterMaterialsIntoChapters をそのまま再利用して呼ぶ（最大5章・章あたり8件は据え置き。
      週単位だと repo の重複が減り自然に収まりやすい）
      → 生成された章の keptMaterialIds に対応する DevEvent へ incorporatedAt をセット
      → それでも溢れた分（droppedMaterialIds）は書庫のみの扱いに留まる（週のしょでもキャップは維持。
        「選べる」の担保は日次の編纂で既に満たしているため、週のしょ自体は自動キュレーションでよい）
```

## UI変更

### にっき（`atlas-daily-textbook.tsx`）

- 今日の5章（source="auto"）: 変更なし
- 章列の末尾に「よみもの帯」セクションを新設:
  - repoごとに1行: repo名・1行digest・件数（地の文、警告色にしない）・経過日数（「3日前」「あと4日で書庫へ」）・「編纂する」ボタン
  - 個別の「読まぬ」操作は置かない。時間経過で書庫（検索専用）へ静かに移る。罪悪感を発生させないための意図的な省略（Kanban aging の考え方）
  - 「もっと古いものを見る」リンクで書庫（`/retro/archive` 想定、新規軽量ページ。検索・フィルタのみ、既読管理なし）
  - **`/entries`（うけばこ）は流用しない**: うけばこは Capture→Entry という確立知識のパイプラインで、意味の異なるデータ（学びカード）を扱う。生の commit 材料を混在させると概念が濁るため、書庫は専用の新規ビューとする

### どうぐ（`atlas-harness.tsx`）

- 「材料のながれ」フロー図の「とりこぼし」ボックス: 名前は維持。リンク先を実際の「よみもの帯」（今日のにっき下部）に直す（現状は行き止まり）
- 「かまどで灰になった」という文言は実態と合わなくなるため改稿（灰＝消滅の含意を、「かまどの下の袋に落ちた」等の消えない含意へ）
- 「しくみのこどう」指標: `incorporatedAt` ベースの「7日以内捕捉率」に再定義。90/70の閾値・心電図表現は流用可

### 週のしょ

新規の最上位ナビは作らない。`/retro` 画面上部の既存「月ごとのぼうけんにっき」リンクの隣に「週のしょ」を追加する形で、既存の棚を流用する。

## 過負荷防止の担保（Anki的な燃え尽きの回避）

1. 自動で読む量は増えない（今日の5章は不変）
2. 増えるのは編纂を選んだ分だけ、章単位1タップ（材料1件ずつの判断は要求しない）
3. 帯項目に「読まぬ」の手動操作は無い＝時間減衰で自然消滅。督促・通知はしない
4. 山は「しくみのこどう」指標としてだけ見せる。プッシュ通知やCTAには出さない
5. 週のしょが唯一の持続的な回収儀式（GTDの週次レビューに相当）。これが無いと帯・書庫は保存されるだけの墓場になる、というのがFable探索の核心の指摘

## 実装時の注意点

1. **再生成の巻き込み事故**: `generateDailyTextbook` の delete→create は `source="auto"` の章のみを対象にする。`source="compiled"` を巻き込むと編纂した章とMasteryが消える
2. **`incorporatedAt` の単一正典化**: 捕捉判定はこの列からのみ算出する。章の存在から逆算する経路を並存させない（ズレの温床になる）
3. **品質不変条件**: `chaptersHaveDistinctCopy` 等は `source="compiled"` の章にも適用する（編纂した瞬間に規則文が完成している前提を崩さない）
4. **書庫の新規ページ**: `/retro/archive`（案）は検索・フィルタのみのシンプルな一覧。じゅもん注入・LLM研磨などの重い機構は持たせない（読む前提ゼロという契約を壊さない）
5. **既存 `droppedMaterialIds` の互換**: 新規生成では常に `[]`。旧データの健全性指標フォールバックのためだけに列を残す（削除マイグレーションは別トラック）

## テスト方針

- `src/lib/harness-repo-match.test.ts` 等と同様、純関数（帯へのグルーピング、`incorporatedAt` 集計）は `node:test` でユニットテスト
- `clusterMaterialsIntoChapters` 自体は無変更のため既存テストはそのまま通る想定。回帰確認のみ
- 「編纂する」action は既存 `distillChecks` の `@@unique` 制約と整合するか、統合テストで確認（index 連番の衝突がないこと）
- 再生成時に `source="compiled"` 章が生き残ることの回帰テストを新設

## 参照

- Fable設計提案（1ラウンド目・案A〜C比較）: 本セッションのAgent呼び出し記録
- Fable探索提案（2ラウンド目・案D/E/F発見、他ドメイン調査）: 同上
- `docs/adr/0020-daily-retro-knowledge-loop.md` §6-3, §6-8
