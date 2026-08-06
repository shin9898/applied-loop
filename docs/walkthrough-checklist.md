# 同僚ウォークスルー・チェックリスト（P1 B10-3）

無介入で初回完走できるかを見る。詰まったら下表に書く。合否はこのリストの完走＋ファネル欠測ゼロ。

## 前提

- クリーンな clone（または `npm run setup` 済み）
- Node ≥20（`npm run preflight`）
- Claude / Cursor / Codex のいずれかで MCP 登録できること
- 採点 CLI（claude または codex）にログイン済み（`/setup` の採点診断が dry-run ✓）

## 手順（介入なし）

1. [ ] `npm run setup` → `npm run dev:all`
2. [ ] http://localhost:3100/setup が開く（合言葉・採点 dry-run が ✓）
3. [ ] サンプルしれんを提出（たたかう）
4. [ ] 採点結果（CLEAR / miss / 保留）を画面で確認できる
5. [ ] miss のとき観点別フィードバックが見える
6. [ ] LLM を選び、貼る文で `list_pending_gates` が自発で呼ばれる（空でもサンプル判定への誘導が出る）
7. [ ] 完了画面で hook **または** `request_gate` の次の一手が分かる
8. [ ] ずかん（`/zukan`）を1回開く
9. [ ] （任意）`request_gate` で差分から1しれん生成→回答

## 合否計測（必須）

実施後に実行:

```bash
npm run funnel:report
```

- [ ] 正本7点が欠測ゼロ（スクリプトが PASS）
- [ ] 所要分 ≤ 30（`elapsed_minutes`。超えたら詰まり表に理由）

正本7点: `setup_opened` / `sample_submitted` / `mcp_touched` / `first_supply` / `first_answer` / `first_verdict` / `zukan_viewed`

※ `first_supply` は hook または `request_gate` の初生成。手順9を飛ばすと欠測になり得る → その場合は任意手順9を実施するか、欠測理由を表に書く。

## 詰まり記録

| # | 手順 | 何が起きた | 期待 | 深刻度 | 対応 |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## 完了判定

- [ ] 上記 1–8 を無介入で完走
- [ ] `funnel:report` が PASS（または欠測が wont 明示）
- [ ] 詰まりがすべてクローズ（または wont 明示）
- [ ] `docs/phase-progress.md` の B10-3 を `done` に更新

実施日: ____ / 実施者: ____ / 所要分: ____
