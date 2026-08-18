/**
 * scheduleDueGates は retry/sr_review gate を生成すると同時に、対象
 * Misconception の nextReviewAt を null にリセットする（採点結果で
 * 再設定される前提）。しかし見送り・悪問スキップ・stale sweep など
 * 採点フローを経ない終端では再設定が起きず、null のままだと due
 * クエリ（nextReviewAt: {lte: now}）に二度とヒットしなくなる。
 * 既に non-null（採点済みで正しく再設定された）なら触らない。
 *
 * delayMs は呼び出し元で使い分ける（koki判断、2026-08-18）:
 * - stale sweep（未回答放置）: gate.ts の RETRY_DELAY_MS（72h）— 単なる
 *   取りこぼしからの復旧なので短くてよい
 * - 明示的な見送り・悪問スキップ: DISMISS_RECOVERY_DELAY_MS（14日）—
 *   「悪問だ」と判断した直後に同一文面の問いがすぐ戻る不快感を避ける
 */
export function computeDismissRecoveryNextReviewAt(
  currentNextReviewAt: Date | null,
  now: Date,
  delayMs: number,
): Date | null {
  if (currentNextReviewAt !== null) return null;
  return new Date(now.getTime() + delayMs);
}
