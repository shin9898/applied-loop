---
type: design
status: draft
date: 2026-08-17
tags: [living-atlas, setup, performance, grading-probe, async-wait]
source_refs:
  [
    src/app/(app)/setup/page.tsx,
    src/lib/setup-diagnosis.ts,
    src/lib/grading-probe.ts,
    src/lib/requeue-failed-grading.ts,
    src/lib/headless-llm.ts,
    src/lib/actions.ts,
    src/components/living-atlas/atlas-onboarding.tsx,
    src/components/living-atlas/atlas-spell-wait.tsx,
  ]
---

# `/setup` 採点CLI診断（グレーディングprobe）タイミング見直し 設計

## 改訂履歴

- 2026-08-17: koki実機ドッグフーディングで発覚した「じゅんび（/setup）の遷移が重い」課題の対応方針として、Fableへ2回の独立調査・相談（①実測での原因特定、②実装コスト度外視でのUX観点の比較検討）を経て、`superpowers:brainstorming`（architectural）で設計を確定

## 背景・問題

`/setup`（じゅんび）ページを開くたびに、キャッシュが失効していると約8秒間レンダーがブロックされる。

Fableによる実測調査で原因を特定済み:

- `src/app/(app)/setup/page.tsx:21` が `loadSetupDiagnosis({ gradingDryRun: true })` を呼び、`setup-diagnosis.ts:163-165` 経由で `grading-probe.ts` の `probeGradingCliLive()` を**レンダー中に同期await**している
- `probeGradingCliLive()` はヘッドレスLLM（`claude -p ...`）を実際に呼び出す dry-run で、応答に約8秒かかる（実測 8.0〜8.4秒、複数回確認済み）
- キャッシュTTLは成功時1時間・失敗時5分。つまり「1時間以上ぶりに`/setup`を開くたびに、毎回8秒ブロックする」のが体感の正体
- サーバーレンダそのもの・バンドルサイズ・フォント・DOMノード数は他ページと比べ健全（このprobeが唯一のボトルネック、devモード特有の一時的症状ではない）

## 検討した案と却下理由

Fableへ実装コストを度外視した純UX比較を依頼し、以下の案を検討した。

| 案 | 概要 | 判定 |
|---|---|---|
| (a) 即時レンダ＋後追い表示 | `/setup`は即座に開き、probe結果だけ後から埋まる | 骨格として採用 |
| (b) stale-while-revalidate | 古いキャッシュを返しつつ裏で再検証 | (a)に「前回結果＋鮮度表示」として部分的に採用。単独では初回コールド時に結局ブロックするか「不明」を返すため不採用 |
| (c) probe専用の短いtimeout | ブロック時間の上限を下げるだけ | 不採用（根本解消にならない） |
| (d) バックグラウンド定期ポーリング（5〜10分おきに勝手に再probe） | ページ体感は最速になる | **不採用**。サブスク枠を常時消費し続け、枠切れ時は本命の採点機能自体がサイレント故障する（「診断を新鮮に保つために診断対象を壊す」本末転倒）。koki運用（従量課金は使わずサブスク枠のみ）とも相性が悪い |
| (e) probeのタイミングを「答えが必要な瞬間」へ移す＋手動トリガーの演出化 | `/setup`は前回結果＋経過時間を即表示するだけに留め、live probeは「賢者に伺いを立てる」明示ボタン（`AtlasSpellWait`演出付き）に限定する | **採用**。「不意打ちの8秒」が「自分で選んだ儀式としての8秒」に変わり、機能面・世界観面の両方で最良とFableが結論 |

コード調査で追加判明した点: `/setup/page.tsx` の live probe結果は、表示だけでなく「保留中しれんの自動再採点」（`requeueFailedGradingIfCliReady()`、B5-3）を呼ぶかどうかのゲートにも使われていた。しかし `requeueFailedGradingIfCliReady()` 自体が内部で別の軽量・同期的なPATH存在確認（`probeGradingCli()`、LLM呼び出しなし）を独自に行ってから動くため、外側のゲートは実質冗長。**live probeをレンダーパスから外しても自動再採点機能は壊れない**（別経路で独立して動作する）。

## スコープ

### 対象（本設計）

- `/setup` の「採点の賢者」診断項目を、live probe呼び出しから**キャッシュ読み出し専用**に変更（レンダーをブロックしない）
- キャッシュが一度もない場合は「未確認」表示（自動での初回live probeは行わない）
- 保留中しれんの自動再採点トリガーを、live probe結果への依存から切り離す（無条件呼び出しに変更、内部の軽量probeがそのままガードになる）
- `/setup`限定の手動「賢者に伺いを立てる」ボタン新設。押下時のみlive probeを実行し、待機中は`AtlasSpellWait`（既存コンポーネント、2026-08-17の「AI回答待ち演出」設計・実装で導入済み）を表示

### 対象外（別トラック）

- `AtlasWaitCompanion`（めくりん）の追加。既存設計では「大きい待ち」（しれん採点）限定としており、今回の単発ボタン待機は`AtlasSpellWait`単体で十分（過剰実装回避、既存設計の実装時の注意点3を踏襲）
- `/setup`以外の画面（例: 個別の`grading_failed`しれん表示）への手動probeボタンの追加。今回は`/setup`のみに限定（koki確認済み）
- probe自体のロジック（`probeGradingCliLive()`・`probeGradingCli()`・キャッシュTTL）の変更。今回は「いつ呼ぶか」の見直しのみで、probe本体の実装は無変更

## 設計

### データフロー変更

**現状**:
```
/setup GET → loadSetupDiagnosis({ gradingDryRun: true })
           → probeGradingCliLive()（キャッシュ失効時、最大8秒await）
           → grading_cli.ok を見て requeueFailedGradingIfCliReady() を条件呼び出し
```

**変更後**:
```
/setup GET → loadSetupDiagnosis()（gradingDryRunなし）
           → readGradingProbeCache()（ファイル読むだけ、即時）
           → grading_cli は「キャッシュのok/detail + 確認時刻」または「未確認」
           → requeueFailedGradingIfCliReady() を無条件呼び出し（内部の軽量PATHチェックでガード済み）

「賢者に伺いを立てる」ボタン押下 → runGradingProbeLiveAction()（サーバーアクション）
                              → probeGradingCliLive()（無変更、最大8秒）
                              → 結果をクライアントへ返す（キャッシュ更新は関数内部で完結）
                              → ボタン隣の表示をその場で更新
```

### 変更対象ファイル

- **`src/lib/grading-probe.ts`**: 既存の内部関数`readCache()`を外部公開する`readGradingProbeCache(): { result: GradingProbeResult; at: number } | null`を追加。live probe本体（`probeGradingCliLive()`）・キャッシュ書き込みロジックは無変更
- **`src/lib/setup-diagnosis.ts`**: `grading_cli`チェックの算出を、`gradingDryRun`指定時のlive呼び出しから`readGradingProbeCache()`ベースに変更。キャッシュなしの場合は`ok: false`＋「未確認」を表す`detail`／`plain`文言にする。`gradingDryRun`オプション自体は当面残す（呼び出し元がなくなるため実質未使用になるが、probe本体のテスト等で使う可能性を考慮し、今回の変更で強制的に消さない）
- **`src/app/(app)/setup/page.tsx`**: `loadSetupDiagnosis({ gradingDryRun: true })` → `loadSetupDiagnosis()`に変更。`requeueFailedGradingIfCliReady()`の呼び出しを、`grading_cli.ok`チェックを外して無条件化
- **`src/lib/actions.ts`**: 新規サーバーアクション`runGradingProbeLiveAction()`を追加。`probeGradingCliLive()`を呼んで結果を返すだけの薄いラッパー（既存の`retryGrading`等と同じ形式に揃える）
- **新規: `src/components/living-atlas/atlas-grading-probe-button.tsx`**（クライアントコンポーネント）: 「賢者に伺いを立てる」ボタン＋`AtlasSpellWait variant="inline"`＋結果表示。押下で`runGradingProbeLiveAction()`を`useTransition`等で呼び出し、pending中は`AtlasSpellWait active={isPending}`、完了後は返り値の`GradingProbeResult`＋「たった今確認」ラベルでその場を更新
- **`src/components/living-atlas/atlas-onboarding.tsx`**: 「採点の賢者」（`grading_cli`）の診断行に、上記ボタンコンポーネントを組み込む

### 「未確認」の`ok`値について

`SetupCheck.ok`は`boolean`（三値ではない）。「未確認」を`ok: false`として扱うのは、既存の他チェック項目（例: `tutorial_sample`＝サンプル未提出、`first_gate`＝しれん0件）も同様に「まだ真になっていない」を`ok: false`で表現しており、既存の設計規約と整合する。「壊れている」ではなく「まだ確認・達成していない」という意味であることは、`detail`/`plain`文言側で明示する（下記）。

### UI文言

- 未確認時: 既存の`grading_cli.plain`文言（採点はヘッドレスLLM云々）に、「まだ確認しておらぬ。下のボタンで賢者に伺いを立てよ」を追加
- 確認済み時: 既存の`detail`表示に「（◯分前に確認）」等の鮮度ラベルを付す
- 待機中: `AtlasSpellWait`の`label`に「めくりんが賢者に伺いを立てておる……」を使う（既存の「AI回答待ち演出」設計のトンマナに揃える）

### エラー処理

- 手動probeが失敗（CLI未検出・認証切れ等）した場合は、既存の`grading.detail`/`grading.howTo`のメッセージ形式をそのまま使う（新規の失敗文言は作らない）
- サーバーアクション自体が例外を投げた場合はボタン側でcatchし、「確認できなかった。もう一度試してほしい」旨の短い案内を表示してスピナーを止める（無限ペンディングを防ぐ）

## テスト方針

- `readGradingProbeCache()`の単体テスト（新規。キャッシュなし／ok／failの3パターン）
- 既存の`probeGradingCliLive`・`requeueFailedGradingIfCliReady`のテストはロジック無変更のため回帰確認のみ
- 実機確認: 冷えたキャッシュ（`~/.applied-loop/grading-probe-cache.json`を一時退避）でも`/setup`が即座に開くこと、ボタン押下で`AtlasSpellWait`表示→結果更新が動くこと、CLI復帰後の自動再採点（B5-3）が引き続き動くこと
