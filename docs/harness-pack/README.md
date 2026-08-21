# ハーネスパック: 安定プレフィックス（ADR-0017）

正典は `~/.claude/docs/harness-pack/README.md`（llm-config リポジトリで版管理）
へ移動した。テンプレート（`templates/claude-stable-prefix.md` 等）も同様。

このリポジトリ側は実行時依存を一切持たない（`cache-prefix-prescription.ts` の
`checklist` はハードコードされた派生コピーで、正典と手動同期する。観測・
局所処方（`/harness`・`suggest_cache_prefix_fix` 等）は引き続きこのリポジトリ
が正典。詳細は `docs/adr/0017-prompt-cache-savings-pack.md` §2改訂参照）。

my-copy: `/my-copy-harness-prefix-pack`（正典パスは llm-config 側を指す）
