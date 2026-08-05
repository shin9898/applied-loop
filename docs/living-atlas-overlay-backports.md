# Living Atlas — workbench overlay に戻す候補

applied-loop ローカルで直したうち、workbench 正典
(`docs/plans/living-atlas/impl/applied-loop-overlay/`) へ戻す価値があるもの。

参照 PR（workbench）:

- WORKBENCH PR [#28](https://github.com/triple-three-inc/workbench/pull/28)
- WORKBENCH PR [#29](https://github.com/triple-three-inc/workbench/pull/29)
- WORKBENCH PR [#30](https://github.com/triple-three-inc/workbench/pull/30)

## 戻す価値あり

1. **`load-atlas-data.ts` をデモ固定から外す設計メモ**  
   applied-loop 固有の Prisma / lib 依存のため overlay にはそのまま載せない。  
   overlay 側は「差し替えポイント」コメント＋薄い demo のまま、APPLY.md に
   「本番は applied-loop の loaders を正」と明記するのがよい。

2. **`submitGateAnswer` Server Action パターン**  
   `onCastSpell` → MCP `answer_gate` 同ロジック + `after(gradeGate)`。  
   overlay の `atlas-gate-battle-client.tsx` スタブをこの形に更新する。

3. **layout 掃除**  
   - `(app)/layout.tsx` から旧 `Header` を外す  
   - `body` に `atlas-dq`（`html` ではなく）  
   - `body.atlas-dq::before/::after` で紙トーン ambient を無効化  
   apply スクリプト / `atlas-living.css` に取り込む価値あり。

4. **バトル文言**  
   空欄回答を許可しないナレーター／プレースホルダ（MCP は answer 必須）。

5. **`atlas-world-map.tsx` の `ctx` null ガード**（tsc）

## applied-loop ローカルのみでよい

- Prisma 実クエリ本体（`load-atlas-data.ts`）
- `better-sqlite3` rebuild などの環境修復
- 詳細ページ（`entries/[id]` 等）の PageShell 残存 — 対象外ルート
