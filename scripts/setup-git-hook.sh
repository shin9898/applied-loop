#!/bin/sh
# Applied Loop git hook セットアップ (ADR-0006 §1)
# 使い方: setup-git-hook.sh /path/to/repo [/path/to/another-repo ...]
#
# hook 本体を ~/.applied-loop/hooks/post-commit にインストールし、
# 指定リポジトリの .git/hooks/post-commit から呼び出す一行を追記する。
# リポジトリのトラッキングファイル (CLAUDE.md 等) は一切触らない。
# 既存の post-commit hook がある場合は末尾に追記して共存する。

set -e

HOOK_DIR="$HOME/.applied-loop/hooks"
HOOK_BODY="$HOOK_DIR/post-commit"
MARKER="# applied-loop-hook"
CALL_LINE="sh \"$HOOK_BODY\" || true $MARKER"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 認証情報を ~/.applied-loop/env に書き出す (.env の MCP_TOKEN を転記)
ENV_FILE="$HOME/.applied-loop/env"
MCP_TOKEN=$(grep "^MCP_TOKEN=" "$SCRIPT_DIR/../.env" 2>/dev/null | cut -d= -f2)
if [ -z "$MCP_TOKEN" ]; then
  echo "警告: .env に MCP_TOKEN がありません。認証なしで動作します"
else
  mkdir -p "$HOME/.applied-loop"
  printf 'MCP_TOKEN=%s\n' "$MCP_TOKEN" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "installed: $ENV_FILE (chmod 600)"
fi

mkdir -p "$HOOK_DIR"
cp "$SCRIPT_DIR/git-hook-post-commit.sh" "$HOOK_BODY"
chmod +x "$HOOK_BODY"
echo "installed: $HOOK_BODY"

for repo in "$@"; do
  # --absolute-git-dir を使う (--git-dir は相対パスを返しうるため誤配置の元になる)
  git_dir=$(git -C "$repo" rev-parse --absolute-git-dir 2>/dev/null) || {
    echo "skip: $repo は git リポジトリではありません"
    continue
  }
  hook_file="$git_dir/hooks/post-commit"
  if [ -f "$hook_file" ] && grep -q "$MARKER" "$hook_file"; then
    echo "skip: $repo (既に設定済み)"
    continue
  fi
  if [ ! -f "$hook_file" ]; then
    printf '#!/bin/sh\n' > "$hook_file"
    chmod +x "$hook_file"
  fi
  printf '%s\n' "$CALL_LINE" >> "$hook_file"
  echo "ok: $repo の post-commit に追記しました"
done

echo ""
echo "完了。hook は ~/.applied-loop/env の認証情報で動作します。"
echo "URL を変える場合は ~/.applied-loop/env に APPLIED_LOOP_URL を追記してください。"
