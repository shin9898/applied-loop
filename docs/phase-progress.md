# コア1ループ Phase 進捗表（正本）

ADR: [0019-core-loop-phases.md](./adr/0019-core-loop-phases.md)  
更新ルール: 実装・検証が終わったら **同じ PR/コミットで** Status を変える。推測で `done` にしない。

Status: `todo` | `doing` | `done` | `blocked` | `wont`

---

## Phase 概要

| Phase | ねらい | 完了の定義 | Status |
|---|---|---|---|
| P0 | 渡せる土台 | クリーン環境＋1枚で30分以内に初回完走 | done |
| P1 | 供給と検証 | 同僚1名無介入完走＋詰まり全クローズ | doing |
| P2 | 翌日以降 | D2以降自発回答＋再出題発火 | doing |
| P3 | 周辺復帰 | 一つずつ戻し指標悪化なし | doing |
| P4 | 日次振り返り型へ | 材料無制限＋教科書HTML＋Mastery4状態で翌日導線 | doing |

ADR（P4 正本）: [0020-daily-retro-knowledge-loop.md](./adr/0020-daily-retro-knowledge-loop.md)

---

## P0 — 渡せる土台（Must）

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-1 | MCP `MCP_SURFACE=core\|full`（既定 core） | done | 初回接続で見えるツール ≤6 | `src/lib/mcp-surface.ts`。core 5本（request_gate 含む） |
| B1-3 | コアツール description 全面書き直し | done | 貼る文後に list を自発呼び出しやすい文面 | route.ts の4本 |
| B2-1 | hook 1コマンド＋失敗時の次の一手 | done | setup-git-hook 一発、失敗で手順が出る | 引数なしで usage＋次の一手 |
| B2-2 | 供給失敗の可視化 | done | setup 診断＋しれん空に理由 | grading_cli＋genFailures／gates supply |
| B3-1 | ナビをコア4面に縮小 | done | 初回ナビ ≤4 | ちず/しれん/ずかん/じゅんび＋一般語 |
| B3-2 | ホーム単一 CTA | done | どの状態でも CTA 1個 | `resolveHomeCta` |
| B4-1 | サンプルしれん質＋採点まで体験 | done | 3分で提出、当日判定確認可 | tutorial-seed 問い短縮（新規 seed） |
| B4-2 | 貼る文統一＋ list_pending_gates を脚本に | done | 貼ってから初 MCP &lt;5分 | tutorialPastePrompt 先頭を list |
| B4-3 | 疎通直後に pending 非空保証 | done | MCP 疎通時 pending≥1 or briefing 実データ | ensureTutorialSeed＋空時はサンプル判定へ誘導（G2） |
| B4-4 | 完了画面→供給の橋（hook） | done | 完了から1クリックで次へ | request_gate 分岐は P1 |
| B5-1 | 出題3点セット（Web/MCP） | done | context→問い→リソース | Web バトルも同順 |
| B5-2 | 採点状態4表示 | done | 受理/採点中/CLEAR・miss/保留 | 一覧＋バトル状態語 |
| B5-3 | 採点失敗リカバリ導線 | done | 保留＋復帰手順＋CLI復帰後自動再採点 | 手動再採点＋`requeueFailedGradingIfCliReady`（ちず/じゅんび） |
| B6-1 | setup に採点疎通診断 | done | ✓/✗ と復帰手順 | PATH＋dry-run（`probeGradingCliLive`・G7） |
| B6-2 | `npm run setup` 等で起動集約 | done | clone→/setup までコマンド2個以内 | `npm run setup` + `dev:all`。`.env.example` 追跡＋`DATABASE_URL`（Fable G1） |
| B7-1 | 初 CLEAR/miss 後ずかん導線 | done | 初回完走者がずかんを開く | 結果画面『ずかんを見る』 |
| B7-2 | ずかん空状態 | done | データゼロでも意味が伝わる | 空＋サンプル像→しれんへ CTA |
| B7-3 | しれん空を供給状態で出し分け | done | 3状態で次の一手が違う | `resolveGatesSupplyState` |
| B8-1 | DQ語＋一般語並記 | done | 用語表なしで完走 | ナビ title/plain |
| B9-1 | Activation ファネル記録 | done | 7点がスクリプト1本で出る | 正本7点＋欠測で exit1（G8）。`npm run funnel:report` |
| B9-2 | 主指標=初回完走率・時間 | done | 完走定義がコード判定 | first_complete + minutes |
| B10-1 | 仲間向け1枚（README 冒頭） | done | その1枚だけで完走 | README「仲間向け・最短」 |
| B10-2 | 本 ADR（0019） | done | ADR 存在 | このファイルとセット |
| B12-3 | Cloud 青カードを初回視界から外す | done | 既定で閉じる／下げる | 明示オープンのみ |

### P0 完了チェック

- [x] 上表の Must がすべて `done`
- [x] クリーン環境セルフラン 30分以内成功（2026-08-06 再実測: 別dir clone → `npm run setup` EXIT0 → `/setup` 200）
- [x] `docs/phase-progress.md` の P0 Status = done

---

## P1 — 供給と検証

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-2 | `request_gate`（diff 引数・非保存） | done | hook なしで1しれん生成→回答 | `requestGateFromDiff`＋core 面 |
| B1-4 | answer_gate 固定文言 | done | 合否表現なし＋次アクション | 固定3行誘導 |
| B2-3 | チュートリアル中スロットル免除 | done | 当日初コミットで1件 | completedAt 前は時間/日次免除 |
| B4-4b | 完了画面に request_gate 分岐追記 | done | B4-4 の拡張 | hook / request_gate の2分岐 |
| B4-5 | チュートリアル完了判定テスト | done | 分岐網羅 | `computeTutorialProgress` テスト |
| B5-4 | 悪問スキップ理由 | done | DB に残り集計可 | `dismissReason`＋`npm run dismiss:report` |
| B6-3 | MCP_TOKEN 自動生成 | done | .env 編集なしで診断✓ | setup が弱い TOKEN も書き戻す |
| B6-4 | Node/ポート preflight | done | 不足時日本語理由 | `npm run preflight` |
| B11-1 | 出題 eval 回帰 | done | 代表 diff 5件 | `npm run eval:gate-gen` |
| B11-3 | サンプル miss 時フィードバック | done | 観点別 | 自動遷移オフ＋rubric フォールバック |
| B10-3 | 同僚1名ウォークスルー | todo | 無介入完走＋詰まりリスト | **P1 合否**・`docs/walkthrough-checklist.md` 整備済み |

### P1 完了チェック

- [ ] 上表すべて `done`（B10-3 は人間実施）
- [ ] 詰まり所全クローズ
- [ ] ファネル欠測ゼロ

---

## P2 — 翌日以降

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B3-3 | 段階開示（初 CLEAR で証跡面） | done | 初回に露出せず解放される | `hasFirstClear`＋dock ににっき/もくひょう/どうぐ |
| B5-5 | 再出題予告 | done | CLEAR に次回日付 | initial 合格/不合格でも `nextReviewAt` 予約（G3） |
| B9-3 | 供給健全性の週次化 | done | 週次3数値 | `npm run supply:health` |
| B10-4 | 別ハーネス検証 | todo | 2ハーネス目無介入 | **人間待ち**・`docs/walkthrough-harness-2.md` |
| B11-2 | 採点再現性スポット | done | 一致率測定 | `npm run eval:grade-spot`（LLM 要） |
| B12-1 | 再出題スケジューラ明文化＋実発火 | done | 仲間環境で発火 | briefing/home/gates/`list_pending_gates`＋滞留 dismiss（G4）。実発火は dogfood |
| B12-2 | 失敗ログ置き場一本化 | done | docs に1行 | `docs/ops-logs.md` 冒頭 |
| B2-4 | event-queue 復帰手順 | done | 再現・復帰可 | `docs/ops-logs.md`＋README |
| — | briefing を今日のしれん＋昨日の判定に | done | 冒頭に単一推奨 | `morning_briefing`「今日の一手」 |

### P2 完了チェック

- [ ] 上表の実装 Must が `done`（B10-4 は人間）
- [ ] D2以降自発回答あり
- [ ] 再出題≥1 発火・回答
- [ ] open 誤解≥1

---

## P3 — 周辺復帰（一括禁止）

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-5 | full 解放条件ドキュメント | done | docs に1行ずつ | `docs/surface-unlock.md` |
| B12-4 | harness 復帰（観測→canon） | done | コア指標悪化なし | `/harness` に TokenStackChart＋canon リンク。指標は dogfood |
| B12-5 | goals / requirements 復帰 | done | 同上 | goals=既にドック。ようけんを証跡ナビへ |
| B12-3b | Cloud MCP 導線復帰 | done | 同上 | 完走後 CTA 強調。既定オープンには戻さない |
| — | 4象限・週次/音声 | done | 同上 | 4象限=`/zukan`、週次=`/digest`（にっきから） |

### P3 完了チェック

- [ ] 上表の実装が `done`（指標悪化なしは人間確認）
- [ ] 各復帰前後で Activation / 回答率を記録
- [ ] 悪化時は再降格した（該当時）

各復帰の前後で Activation / 回答率を記録すること。

---

## P4 — 日次振り返り型ナレッジループ（ADR-0020）

重心: commit 即時しれん → **材料蓄積 → 日次教科書 → 確認 → Mastery 振り分け**。

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| C0-1 | ADR-0020 採択 | done | ADR 存在＋0019 追記 | 本セクションとセット |
| C1-1 | Material を backlog で落とさない | done | DevEvent は常に材料化。`skipReason=backlog` で生成スキップしても材料は残る／即時生成と分離 | `recordEvent` コメント明文化。Textbook が backlog 材料を章に含む |
| C1-2 | 既存 pending しれんの退避 UI | todo | parked / dismiss で pending を5未満にもできる | 移行期の呼吸 |
| C2-1 | 日次 Textbook 生成 | done | 指定日の材料→章立てデータ＋HTML 1本 | `generateDailyTextbook`（規則ベース）。正本 DB。章≤5・章内≤8 |
| C2-2 | Textbook 閲覧面 | done | Web でその日の教科書を開ける | `/retro`・`/retro/[dateKey]` |
| C2-3 | コンテキスト溢れ防止 | done | じゅもん注入は1章＋URLのみ。全量貼り禁止。圧縮落ち材料に証跡 | `buildJumonContext`＋`droppedMaterialIds` |
| C2-4 | じゅもん（AI対話）深掘り | done | 読む面に TerminalPanel。章コンテキスト注入 | 確認モードでは非表示。表記に括弧補足 |
| C3-1 | Check 蒸留（3〜7問） | done | 教科書から少数確認を生成 | `distillChecks`（規則）。材料件数に比例しない |
| C3-2 | Mastery 4状態 | done | clear / partial / stuck / parked を保存・表示 | `DailyTextbookCheck.mastery` |
| C3-3 | ステータス別翌日導線 | done | briefing / ちず CTA が状態で変わる | `textbook-guidance`＋home CTA。stuck→ずかん、partial/未確認→/retro、しれんより優先 |
| C4-1 | コアループ説明の更新 | todo | onboarding / README / LP を 0020 一文に合わせる | 即時しれん偏重をやめる |
| C4-2 | セルフラン（実装多めの1日） | todo | 材料が増えても沈黙せず、夜に教科書→確認→振り分けまで完走 | dogfood |

### P4 完了チェック

- [ ] C1〜C3 の Must が `done`
- [ ] 実装の多い日でも `backlog` 沈黙が起きない
- [ ] 教科書 HTML が1日分生成され、Mastery 振り分け後に翌日 CTA が変わる
- [ ] C4-2 セルフラン成功

---

## Should / Could（Phase 任意枠・忘れ防止）

| ID | Phase 目安 | Status | 項目 |
|---|---|---|---|
| B3-4 | P0〜P1 | done | `npm run audit:onboarding`＋正本を `npm run setup` に同期 |
| B6-5 | P1 | done | `npm run db:reset`（バックアップ→migrate→seed） |
| B7-4 | P2 | done | ずかん詳細に `rootCauseOneLiner` |
| B8-2 | P0〜P1 | done | コア面の Gate/Entry/理解度ゲート露出を一般語へ |

---

## Won't（今はやらない・再議論禁止に近い）

| 内容 | 理由 |
|---|---|
| request_gate 以外の供給乱立 | 初週は hook＋会話の2本で十分（P4 でも材料入口は増やしすぎない） |
| ツール物理削除 | 隠すだけ。本人運用を壊さない |
| SaaS / マルチユーザー | 各自ローカル clone |
| サンプル複数問・コース化 | 学習コンテンツ非作成（Textbook は自分の材料の圧縮） |
| 確認問いの無制限同時提示 | また backlog 化する（ADR-0020） |
| HTML だけを正典にする | DB 材料が正本（ADR-0020） |
| DQ 演出強化 | コア完走を助けない |
| Obsidian 初回必須 | 前提が重い |
| ルールベース採点 fallback | NSM 汚染防止 |
| ADR 歴史改ざん | 追記のみ |

---

## 変更ログ

| 日付 | 内容 |
|---|---|
| 2026-08-06 | 初版。ADR-0019 と同時作成。P0 = doing |
| 2026-08-06 | P0 着手: B1-1/1-3, B2-1, B3-1, B4-2/4-4, B6-2, B8-1, B10-1/10-2, B12-3 |
| 2026-08-06 | P0 Must 実装完了（ホームCTA・供給空・採点4状態・ファネル・診断）。セルフラン確認待ち |
| 2026-08-06 | P0 セルフラン確認クローズ。P1 着手: B1-2/1-4/2-3/4-4b |
| 2026-08-06 | P1 実装残り完了（B4-5/5-4/6-3/6-4/11-1/11-3）。B10-3 は同僚実施待ち |
| 2026-08-06 | P2 実装: B3-3/5-5/9-3/11-2/12-1/12-2/B2-4/briefing。B10-4 は別ハーネス実施待ち |
| 2026-08-06 | P3 実装: B1-5/12-4/12-5/12-3b/4象限・digest。指標確認・dogfood 待ち |
| 2026-08-06 | Fableギャップ埋め（人間不要分）: B5-3自動再採点 / B7-2サンプル像 / B7-4根因1行 / B8-2内部語 / B6-5 db:reset / B3-4同期監査 |
| 2026-08-06 | Fable再レビュー G1/G6: `.env.example` 追跡・`DATABASE_URL`・`migrate deploy`・db:reset をルート DB へ |
| 2026-08-06 | クリーンclone実測: 欠落migration補完・prisma generate・postinstall-node-pty 復元 |
| 2026-08-06 | Fable G2/G3/G4: 空list診断応答・initial再出題予約・scheduleDueGates 経路拡大 |
| 2026-08-06 | Fable G5/G7/G8/G10: P3一括定義明記・採点dry-run・ファネル正本7点・prefix_fix誤字 |
| 2026-08-10 | ADR-0020 採択。P4（日次振り返り型）を追加。コア一文を材料→教科書→Mastery へ更新 |
| 2026-08-10 | P4 縦スライス: Textbook スキーマ・生成・`/retro`・じゅもん1章注入・Mastery。C1-1/C2-1〜4/C3-1〜2 done |
| 2026-08-10 | C3-3: Mastery→翌日導線（home CTA / morning_briefing）。教科書導線をしれんより優先 |
