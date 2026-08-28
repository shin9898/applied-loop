---
type: decision
status: accepted
date: 2026-08-28
tags: [harness, collector, launchd, privacy, reliability]
source_refs:
  [
    docs/adr/0009-harness-comprehension.md,
    docs/adr/0039-harness-measurement-canonicalization.md,
    scripts/collect-harness.mjs,
    scripts/harness-collect.sh,
    scripts/com.applied-loop.harness-collect.plist,
  ]
---

# ADR-0040: ハーネスメタデータ収集を15分周期のdurable pullにする

## 背景

ADR-0009 は、Claude Code / Codex のローカルsession JSONLから会話本文を除いた集約
メタデータを定期送信する方針を選んだ。collector-v3にはファイル単位のsize/mtime
checkpointと`(harness, sessionId)` upsertがあり、snapshot/max-sendsを使った検証境界もある。

一方、通常運用には次の差分が残っていた。

- 配布plistは1時間周期かつユーザー名・repo pathの手編集が必要だった。
- checkpointをrepo内へ直接書き、JSON書き込みの途中終了やclone更新に弱かった。
- checkpoint破損を黙って空状態として扱い、理由や復旧を確認できなかった。
- HTTP失敗をretryせず、エラーがあってもprocessは成功終了した。
- 最終同期、未同期件数、直近エラーを確認する診断がなかった。

## 決定

通常収集は1イベントhookではなく、per-user launchdによる15分周期の集約pullとする。

```text
Claude ~/.claude/projects/**/*.jsonl ─┐
                                      ├─ 15分 / RunAtLoad
Codex  ~/.codex/sessions/**/*.jsonl ──┘       │
                                              v
                                   metadata-only aggregate
                                              │
                         atomic checkpoint ───┼── retry 3回
                                              v
                                  POST /api/harness-runs
                                              │
                       unique(harness, sessionId) upsert

server停止 / sleep / network error
        └─ checkpointを進めない ──> 次回tickで全未同期をcatch-up
```

### 1. 配布・起動

- plistは`StartInterval=900`と`RunAtLoad=true`を持つ。
- 対話的macOSの`npm run setup`成功経路が`manage-harness-collector.mjs install`を呼ぶ。
  installerはcloneの絶対pathをテンプレートへ埋め込み、
  `~/Library/LaunchAgents/com.applied-loop.harness-collect.plist`へatomicに配置して
  bootstrapする。`RunAtLoad`が初回catch-upを開始し、ユーザー名の手編集は不要。
- CI、macOS以外、非対話環境は自動登録をskipする。非対話配布は
  `APPLIED_LOOP_INSTALL_HARNESS_COLLECTOR=1`で明示opt-inでき、任意環境では
  `APPLIED_LOOP_SKIP_HARNESS_COLLECTOR=1`で抑止できる。installは既存jobをbootoutして同じlabelを
  bootstrapするため冪等である。通常利用者はsetup以後manual collectを行わない。

### 2. checkpoint・冪等性・途中終了

- state/status/logはrepo外の`~/.applied-loop/harness-collector/`に置き、clone更新や
  worktreeにまたがって維持する。
- stateは一時ファイルをfsyncしてrenameするatomic replaceで保存する。
- 50件単位ではなく、成功したsessionごとにcheckpointする。
- SIGINT/SIGTERM handlerは最終pending走査・status確定・lock解放まで維持する。現在のrequest終了後に
  止まり、retry backoff中を含めてsignal受領後は新しいPOSTを開始せず、成功済みcheckpointを残す。
  最終走査中のsignalも`pendingCountExact=false`のinterrupted statusとして保存し、完全同期時刻を
  進めない。requestがserverで
  成功した直後にprocessが強制終了しても、次回の同一session再送はserver upsertで冪等になる。
- 壊れたstateは`.corrupt-<timestamp>`へ退避し、空checkpointから再構築する。これは全sessionを
  再送し得るが、取りこぼしより安全で、会話本文を新たに保存しない。
- repo内にある旧checkpointは初回だけ読み、新しいper-user pathへ移行する。

### 3. retry/backoffとcatch-up

- network error、HTTP 408/429/5xxのみ指数backoffで最大3回試す。4xxは即時失敗する。
- 最終失敗後は残りsessionへ同じ障害を繰り返さずrunを非0で終了し、checkpointを進めない。
- launchdの次の15分tickがcatch-upになる。アプリ停止中・network停止中・Mac sleep中に溜まった
  sessionも、復旧後のtickで同じ増分走査へ戻る。
- scheduled runはpending sessionを古い順・新しい順に交互配置し、各tickの先頭に最古のpendingを
  置く。連続して新規sessionが増えても古いbacklogをstarveさせない。12分budgetはdirectory走査前に
  開始し、filesystem discovery、候補のfingerprint/statと公平な並び替え、`pendingBefore` /
  `pendingAfter`集計、parse、POST attempt、retry backoffを同じdeadlineへ含めて正常yieldする。
  deadlineで走査または並び替えが途中停止したrunは件数を推測せず`pendingCount=null`・
  `pendingCountExact=false`の`pending`として残し、完全同期時刻を進めない。未処理sessionはcheckpointへ
  書かれないため次tickで再発見され、deadline後は新しいPOSTを開始しない。budget判定は各処理の
  呼出し境界で行い、開始済みの単一の同期filesystem syscall・`readFileSync`・parseやPOSTを途中では
  中断できない。各HTTP requestは20秒でtimeoutするが、その終了処理等により実wall-clockが12分を
  少し超える場合がある。大量の初回backlogはsession単位checkpointから次tickへ継続し、15分jobを
  常時占有しない。
- per-user lockはmacOSの`lockf -k`（Linuxでは`flock`）を保持するchild processでOS-levelに排他し、
  親collectorのpipeがcrashで閉じればkernel lockも自動解放される。owner JSONはPID・OS由来
  process-start identity・lock IDを持ち、旧lockとの互換確認でPID再利用をactive ownerと誤認しない。
  同時起動は終了コード75で送信前に拒否する。旧版のcrash等で空または不正なlockが残った場合は
  短く再読込みし、初期化猶予を過ぎたものだけkernel lock取得後に上書き回収する。pathをunlinkして
  新ownerと競合する回収窓は作らない。
- launchdの時刻はOS schedulingのbest effortであり、sleep中の厳密なwall-clock SLAは保証しない。
  wake後はRunAtLoad済みjobの次回実行でcatch-upする。

### 4. 診断と検証境界

- `npm run harness:collector:status`はlaunchd登録状態に加え、最終完全同期、最終checkpoint、
  未同期session数、連続失敗、直近errorを表示する。
- `node scripts/collect-harness.mjs --status --json`は送信もlaunchctl操作もせず機械可読診断を返す。
- launchd wrapperは引数を拒否し、run modeと12分budgetを固定して常にplain unbounded scheduled
  collectionだけを実行する。`.env`は実行せず、collectorが`MCP_TOKEN`と`APPLIED_LOOP_URL`だけを読む。
- installerはsetupを実行したNodeの`process.execPath`をplistへ埋め込み、wrapperはlogin PATHに依存せず
  その絶対pathだけを実行する。Node移動後はcollectorを再installする。
- `--dry-run --snapshot-out`、`--apply-snapshot`、`--max-sends`は検証者がcollectorを直接呼ぶ
  bounded validationのままとし、plistには含めない。
- collector payloadのallowlistとcollector-v3のcohort semanticsは変更しない。会話text、thinking本文、
  tool input/resultはstate/status/snapshot/HTTP payloadのいずれにも保存・送信しない。

## 理由

15分ごとの全session directory走査はevent hookより遅いが、Claude/Codex双方を同じ経路で扱え、
アプリ停止やhook未発火を次回走査で回収できる。session JSONLをbyte offset単位で追う案はI/Oを
減らせる一方、途中行、truncate/rotation、集約値の再計算、provider format差の復旧状態が複雑になる。
現状のfile fingerprint＋full aggregate upsertはsession単位で再計算でき、取りこぼし回避を優先する
今回の要件に対して小さく、検証済み境界を保てる。

## 結果・トレードオフ

- 通常利用者は初回install後にmanual collectを行わない。
- server停止中に送信済みcheckpointを誤って進めず、復旧後に自動catch-upする。
- 変更中の長いsessionは15分ごとに再parseされるため、session数・ファイルサイズに比例するI/Oは残る。
- state破損復旧や送信ACK直後の強制終了では重複POSTがあり得るが、server upsertにより重複行は作らない。
- launchd登録はユーザー環境への永続変更なので、CI・非対話setup・repository testでは自動実行しない。

## 却下した案

- **各LLMの終了hookから即時POST**: hook所有権、途中終了、network障害時queueの二重実装が必要。
- **ファイル監視daemon**: FSEvents lifecycleと再起動回復が増え、15分要件には過剰。
- **offset checkpoint**: I/O効率は高いが、aggregate upsertの再現性とtruncate/partial-line復旧が複雑。
- **失敗sessionを全件retryし続ける**: server停止時に送信stormと15分を超えるrunを生む。

## 出典

- ADR-0009のmetadata-only・定期pull・session upsert決定
- ADR-0039のcollector-v3 fingerprint・snapshot外のruntime activation境界
- PR #69 merge commit `504f640185efd7726ffb8d4ed97dcca98a33981c`のsnapshot/max-sends境界
