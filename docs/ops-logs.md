# 運用ログ・復帰手順（P2）

## 失敗ログの置き場（B12-2）

生成失敗は `DevEvent.skipReason`（`gen_failed*`）、採点失敗は `Gate.status=grading_failed`、オフライン退避は `~/.applied-loop/event-queue.jsonl`。週次集計は `npm run supply:health`。

## 再出題スケジューラ（B12-1）

`scheduleDueGates()` は cron ではなく次で発火する:

1. **MCP `morning_briefing`**（朝の起点）
2. **ホーム読み込み**（`loadHomeProps`）

条件: `Misconception.nextReviewAt <= now` かつ、当該誤解に `pending` / `answered` / `grading` の Gate が無い。最大5件。生成後 `nextReviewAt` を null にする。

手動検証:

```bash
npx tsx scripts/debug-misconception.ts
# または nextReviewAt を過去に戻してから morning_briefing / ホーム再読込
```

## event-queue 復帰（B2-4）

1. アプリ停止中にコミットすると hook が `~/.applied-loop/event-queue.jsonl` に追記する
2. `npm run dev:all` でアプリを起動する
3. **次のコミット**（どの repo でも可）で queue が先に flush される（`scripts/git-hook-post-commit.sh`）
4. 送れなかった行だけ queue に残る → URL / `MCP_TOKEN` / アプリ起動を確認

再現チェック:

```bash
# アプリ停止中に1コミット → queue に1行増える
# dev:all 起動後にもう1コミット → queue が空（または未達分のみ残る）
ls -la ~/.applied-loop/event-queue.jsonl
```
