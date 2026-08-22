---
type: decision
status: accepted
date: 2026-08-03
tags: [audio, meteofall, llm]
source_refs: [docs/product-brief.md, docs/adr/0006-comprehension-gate.md]
---

# ADR-0014: 音声ダイジェストとメテオフォール品質保証ループ (v4.1)

## 背景

product-brief v4 の C (音声ダイジェスト) と B (メテオフォール品質保証
ループ)。v4.1 フェーズの実装設計。

- C: release-video パイプライン (workbench、VOICEVOX さやか) の資産を
  転用し、週次の学びダイジェストを音声化する。
  **前提としてパイプライン自体のブラッシュアップが必要** (開発者認識)
- B: 要件 (人間) → 実装 (AI 委譲) → ゲートで理解確認 → 次の要件へ、
  という閉ループ。vibe coding しても comprehension debt を残さない
  開発プロセスの完成形

## 決定

### 1. 音声ダイジェスト (C)

責務の分離:

- **Applied Loop 側**: 週次ダイジェストの「ナレーション原稿」
  (セリフ形式のテキスト) を生成するところまで
- **release-video パイプライン側**: 原稿の音声化 (VOICEVOX) と
  パイプライン自体のブラッシュアップ

実装:

- `src/lib/audio-digest.ts` を新規作成:
  - 先週 (JST 週) のデータを集約: 解消した誤解 / 新規の誤解と根因 /
    象限の流れ (ADR-0013) / accept された学び / 目標の証跡と週次評価 /
    来週の焦点 (open 誤解の再出題予定)
  - ヘッドレス LLM でナレーション原稿を生成
    (さやかのキャラクターに合う口調。5 分以内・600 字×4 段落程度の
    セリフ形式。聞き流せる長さ)
  - 出力: `OBSIDIAN_DIGEST_DIR/weekly/<weekKey>-narration.md`
- 週次実行: 月曜 briefing の generateWeeklyReviews と同じタイミングで
  `after()` 起動
- 音声化は別途: 原稿 MD を release-video パイプラインの `tts.mjs`
  (VOICEVOX) に渡すスクリプト `scripts/weekly-audio.sh` を用意し、
  出力 wav/mp3 を同じく `OBSIDIAN_DIGEST_DIR/weekly/` に配置
  (Obsidian でそのまま再生できる)
- **パイプラインのブラッシュアップは本タスクのスコープ外**。
  別途、改善点の洗い出しレポートを作成して開発者と協議する

### 2. メテオフォール品質保証ループ (B)

```prisma
model Requirement {
  id        String   @id @default(cuid())
  title     String
  why       String?  // 目的・背景
  criteria  String?  // 受入条件 (自由記述)
  status    String   @default("active") // active / understood / done / abandoned
  createdAt DateTime @default(now())
  links     RequirementLink[]
}

model RequirementLink {
  id           String      @id @default(cuid())
  requirementId String
  requirement  Requirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  targetType   String      // gate / entry
  targetId     String
  createdAt    DateTime    @default(now())

  @@unique([requirementId, targetType, targetId])
}
```

- **紐付け**: コミットイベントからゲート生成時、直前の会話または
  コミットメッセージから要件を LLM が推定して `RequirementLink` を作成
  (高信頼度のみ自動、それ以外は提案制)
- **「理解確認済み」判定**: 要件に紐づくゲートが全て pass になったら
  `status="understood"` (人間が理解を確認した状態)。
  要件の実務完了は `done` (手動 or LLM 提案)
- **MCP ツール**:
  - `register_requirement` (title, why?, criteria?): 要件定義を登録
  - `list_requirements`: active な要件と各ゲート合格状況
  - `link_requirement` (requirementId, targetType, targetId): 手動紐付け
- **表示**: `/requirements` ページ (要件一覧 + 各要件のゲート状況) と
  ダッシュボードに「メテオフォール」セクション
  (理解確認済みの要件・次に進むべき要件)
- briefing に「理解確認済みになった要件」と「次の要件候補」を表示し、
  「合格したら次へ」のリズムを作る

### 3. 段階制限

- 要件の自動推定は誤紐付けのリスクがあるため、初期は
  **登録・紐付けとも LLM 提案 → ユーザー承認制** (Goal と同じ段階導入)
- 要件管理をフル機能のタスク管理にしない (正典は Hermes。
  あくまで「理解確認の単位」としての要件)

## 却下した案

- **音声化まで Applied Loop に内製**: VOICEVOX 制御は
  release-video パイプラインの責務。二重実装を避け、
  Applied Loop は原稿生成までに留める
- **Requirement に進捗率・ステータス遷移の複雑な管理**: 
  タスク管理化を防ぐ。understood/done の 2 状態だけ
- **コミット単位の要件必須化**: 全コミットが要件に紐づくわけではない
  (雑多な修正もある)。紐付かないコミットは従来通り独立ゲートとして扱う

## 追記 (2026-08-06)

ナレーション話者を Living Atlas オリジナルのナビ姫「ルミナ」に差し替えた
（`src/lib/narration-persona.ts`）。VOICEVOX 側の声色マッピングは外出しのまま。
旧原稿の「さやか:」は UI / TTS 抽出で互換表示する。歴史的経緯（さやか転用）は
上記背景節に残す。

## 追記 (2026-08-22): 音声化オーケストレーションを my-copy へ移管

上記「1. 音声ダイジェスト (C)」決定時点では想定していなかった論点
(他 repo の実行ファイルを絶対パスで起動する越境実行) が判明したため、
`scripts/weekly-audio.sh`・`weekly-audio-auto.sh`・
`com.applied-loop.weekly-audio.plist` を削除し、起動オーケストレーションを
`~/tools/workbench/my-copy`(`scripts/weekly_audio.py`)へ移管した。

- **変わらないもの**: 「音声化まで Applied Loop に内製しない」という
  却下案の結論、責務分離の原則そのもの、原稿生成 (`src/lib/audio-digest.ts`、
  `OBSIDIAN_DIGEST_DIR/weekly/` への出力)
- **変わるもの**: 音声化の**起動元**。従来は Applied Loop がドライバーだったが、
  Applied Loop はナレーション原稿を書くところで完結し、my-copy 側が
  vault の原稿を読みに行く形にした(越境の向きの逆転)
- 詳細・設計判断: `docs/adr/0024-weekly-audio-orchestration-moves-to-my-copy.md`
