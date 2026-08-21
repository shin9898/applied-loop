<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Applied Loop harness-pack ADR-0017: Identity → 不変 → 可変。先頭はバイト安定に保つ。 -->

## Identity

- Applied Loop: 実装の足跡を材料として貯め、1日の教科書に圧縮し、確認で理解状態を振り分けて翌日を進めるローカルツール(Next.js + Prisma)。
- 長い手順は skill / docs へのポインタ。日付・一時メモは **可変** より下だけ。

## 不変の作業方針

- 安定プレフィックス規約(ADR-0017)の正典は `docs/harness-pack/README.md`（このリポジトリが正典を保有）。
- ADR は `docs/adr/`。進捗正本は `docs/phase-progress.md`。

## ここから後ろ（可変）
