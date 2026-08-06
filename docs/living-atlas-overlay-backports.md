# Living Atlas — workbench overlay に戻す候補

applied-loop ローカルで直したうち、workbench 正典
(`docs/plans/living-atlas/impl/applied-loop-overlay/`) へ戻す価値があるもの。

参照 PR（workbench）:

- WORKBENCH PR [#28](https://github.com/shin9898/workbench/pull/28)
- WORKBENCH PR [#29](https://github.com/shin9898/workbench/pull/29)
- WORKBENCH PR [#30](https://github.com/shin9898/workbench/pull/30)

## 戻し済み / APPLY.md に反映済み

1. **`load-atlas-data.ts` はデモ固定のまま＋本番は applied-loop 正** — APPLY.md に明記
2. **`submitGateAnswer` パターン** — overlay `atlas-gate-battle-client.tsx` にコメント stub
3. **layout: `body.atlas-dq`** — APPLY.md に明記
4. **敵10種** — `atlas-enemies.ts` + `enemyForGate` を overlay に同期
5. **`atlas-world-map.tsx` の `ctx` null ガード** — overlay 側に既存

## 追加で overlay に載せたもの（2026-08-06）

- `atlas-concept-prompt-cache.tsx`（依存が Atlas 内のみ）

## applied-loop ローカルのみでよい

- Prisma 実クエリ本体（`load-atlas-data.ts`）
- `atlas-experiment-detail.tsx`（`@/lib/actions` 依存）
- `better-sqlite3` rebuild などの環境修復
- 採点パイプライン・MCP 認証・tutorial-state
