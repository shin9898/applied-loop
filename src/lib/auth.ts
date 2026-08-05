// MVP は単一ユーザー (認証なし)。公開フェーズで Supabase Auth + userId
// スコープをここに実装する。全 write 系 Server Action / MCP ツールは
// この関数を入口に通すこと。公開時の作業を「1関数の実装」に縮める保険。
export async function requireAuth(): Promise<void> {
  // no-op (単一ユーザー MVP)
}
