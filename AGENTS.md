<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Applied Loop harness-pack ADR-0017: Identity → 不変 → 可変。先頭はバイト安定に保つ。 -->

## Identity

- Applied Loop: 実装の足跡を材料として貯め、1日の教科書に圧縮し、確認で理解状態を振り分けて翌日を進めるローカルツール(Next.js + Prisma)。
- 長い手順は skill / docs へのポインタ。日付・一時メモは **可変** より下だけ。

## 不変の作業方針

- 安定プレフィックス規約(ADR-0017)の正典は `~/.claude/docs/harness-pack/README.md`（llm-config。ADR-0022でこのリポジトリから移動済み）。このリポジトリ側は`docs/harness-pack/README.md`にポインタのみ残す。
- ADR は `docs/adr/`。進捗正本は `docs/phase-progress.md`。
- **`main` への直接 push はしない。変更は PR 経由**(`gh pr create --repo shin9898/applied-loop --base main`)。`main` には PR 必須の ruleset があるが、owner 権限では直接 push が `Bypassed rule violations` として**通ってしまう**ため、ゲートは人間側の規約で守る。
- ADR の連番は**採番の直前に `git fetch`** し、`git ls-tree --name-only origin/main docs/adr/` で origin 側の最大番号を見る。ローカルの `ls` は最後に fetch した時点の番号でしかなく、過去に衝突と renumber が発生している(`53669a5`)。

## ここから後ろ（可変）
