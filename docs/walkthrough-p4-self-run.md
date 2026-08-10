# P4 セルフラン（C4-2）チェックリスト

ADR: [0020-daily-retro-knowledge-loop.md](./adr/0020-daily-retro-knowledge-loop.md)  
進捗: [phase-progress.md](./phase-progress.md) の C4-2

実装の多い1日を想定し、**材料が増えても沈黙せず**、夜に教科書→確認→Mastery まで閉じられるかを見る。

## 前提

- `npm run dev:all` が動いている
- 監視リポジトリが1つ以上つながっている（または DevEvent が既にある）
- pending しれんが溜まっていてもよい（C1-2 の退避が使える）

## 手順

| # | 操作 | 期待 |
|---|---|---|
| 1 | 監視 repo で数回 commit（または既存材料を確認） | DevEvent が増える。`skipReason=backlog` でも行は残る |
| 2 | pending ≥5 なら `/gates` で『あとまわし』または『閉じる』 | pending が5未満になり、即時生成が再開しうる |
| 3 | `/retro` → 『きょうを生成』 | 章が立つ。圧縮で畳んだ材料 ID が見える |
| 4 | 読む → 深さ（初学者/実務）→ じゅもん（1章） | 注入は開いている章＋URLのみ |
| 5 | 『確認する』→ Mastery を付ける | clear / partial / stuck / parked が保存される |
| 6 | ちず `/` または `morning_briefing` | 今日の一手が Mastery 導線（stuck→ずかん等）になる |

## 合格条件

- [ ] backlog でも材料が消えていない
- [ ] 教科書が1日分生成され、確認→Mastery まで完走した
- [ ] Mastery 後にホーム CTA または briefing の一手が変わった

成功したら `docs/phase-progress.md` の C4-2 を `done` にし、変更ログに日付を1行足す。
