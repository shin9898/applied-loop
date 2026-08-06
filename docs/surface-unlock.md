# 面・周辺の解放条件（P3 B1-5）

隠す≠捨てる。いつ視界に戻すかを1行ずつ固定する（ADR-0019）。

## MCP 面

| 対象 | 解放条件 |
|---|---|
| core 5本（`morning_briefing` / `list_pending_gates` / `request_gate` / `answer_gate` / `get_gate_result`） | 既定（`MCP_SURFACE` 未設定 or `core`） |
| capture / triage / record_application / find_related_learnings | `MCP_SURFACE=full` |
| goals 系（`register_goals` 等） | `MCP_SURFACE=full`（UI のもくひょうは初 CLEAR 後） |
| requirements 系 | `MCP_SURFACE=full`（UI のようけんは初 CLEAR 後・P3 復帰） |
| `suggest_cache_prefix_form` | `MCP_SURFACE=full` + `/harness`（どうぐ） |
| `enrich_gate_places` / `save_task_mappings` | `MCP_SURFACE=full` |

## UI ナビ

| 対象 | 解放条件 |
|---|---|
| コア4面（ちず / しれん / ずかん / じゅんび） | 初回から |
| にっき / もくひょう / どうぐ | 初 CLEAR（サンプル以外）後（B3-3） |
| ようけん（`/requirements`） | 同上（P3 B12-5）。直 URL は常時可 |
| Cloud ウィザード本体 | 明示オープンのみ（既定たたみ・B12-3）。コア完走後に CTA 強調（B12-3b） |
| 4象限 | `/zukan` 内（ホーム CTA は増やさない） |
| 週次ナレーション | `/entries` → `/digest`（`docs/digest/weekly/` を表示） |

## 復帰順（一括禁止）

1. 本ドキュメント（B1-5）  
2. harness 観測グラフ → canon リンク（B12-4）  
3. goals 確認 → requirements ナビ（B12-5）  
4. Cloud 導線強調（B12-3b・既定オープンには戻さない）  
5. 4象限 → 週次/音声リンク  

各ステップの前後で Activation / 回答率を見て、悪化したら再降格。

詳細手順: [mcp-setup.md](./mcp-setup.md) · [ops-logs.md](./ops-logs.md) · [cloud-mcp.md](./cloud-mcp.md)
