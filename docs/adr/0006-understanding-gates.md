
## 追記（2026-08-16）: diffSnapshot のローカル専用保存

§8 の「diff / 採点コンテキストは DB に一切保存しない」を一部変更する。

実測（2026-08-07）で、worktree 削除後に queue flush されたイベント6件が `gen_failed_diff` で恒久に出題不能になった。`git show` による都度取得は repo 移動・rebase・worktree 削除で壊れる。

変更:

- hook がコミット時点の diff（9KB 上限・base64）を payload に添付し、`DevEvent.diffSnapshot` に切り詰め保存する
- 出題生成・再採点は snapshot 優先、git 取得はフォールバック（取得成功時は backfill）
- `gen_failed*` の再試行は `npm run requeue:gen`

プライバシー境界の扱い: `diffSnapshot` は `Gate.answer` / `gradeNote` と同じ**ローカル専用・クラウド同期除外**とする（schema コメントに明示）。「信頼済みプロバイダにのみ送る」境界は変わらない。
