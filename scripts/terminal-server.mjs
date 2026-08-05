#!/usr/bin/env node
/**
 * ADR-0015: アプリ内ターミナルハーネス用 WebSocket サーバー
 *
 * ブラウザ (xterm.js) ←→ ws://127.0.0.1:3101 ←→ node-pty (claude/codex CLI 直起動)
 *
 * ライフサイクル:
 * - CLI プロセス終了後も WS は維持し、{type:"restart"} で再スポーン可能
 * - WS 切断時に pty を殺す（ページ離脱 = セッション終了。再アタッチはしない）
 * - 自動再起動はしない（rate limit 直後のクラッシュループを避ける）
 *
 * ENABLE_TERMINAL=true の時のみ起動。未設定なら即終了。
 * 使い方: npm run dev:terminal  /  npm run dev:all
 */

import { readFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import Database from "better-sqlite3";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const HOST = "127.0.0.1";
const PORT = 3101;
/** spawn 可能な先頭コマンド。実行サンドボックスではない (ADR-0015) */
const ALLOWED_CMDS = new Set(["claude", "codex", "bash"]);
/** 子プロセス環境から除去する秘密。APPLIED_LOOP_MCP_TOKEN は CLI の MCP 認証に必要なので残す */
const SCRUB_ENV_KEYS = ["MCP_TOKEN", "APPLIED_LOOP_WS_TOKEN"];

loadDotEnv(join(REPO_ROOT, ".env"));
ensureSpawnHelperExecutable(REPO_ROOT);

if (process.env.ENABLE_TERMINAL !== "true") {
  console.error(
    "[terminal] ENABLE_TERMINAL=true が未設定のため起動しません。"
  );
  process.exit(0);
}

const MCP_TOKEN = process.env.MCP_TOKEN;
if (!MCP_TOKEN) {
  console.error("[terminal] MCP_TOKEN が未設定です。起動を中止します。");
  process.exit(1);
}

const SHELL_CMD = (() => {
  try {
    return resolveCmdPath(process.env.TERMINAL_SHELL_CMD ?? "claude");
  } catch (e) {
    console.error(`[terminal] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
})();
const DB_PATH = resolveDbPath(process.env.DATABASE_URL);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("applied-loop terminal server\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  let authenticated = false;
  /** @type {ReturnType<typeof pty.spawn> | null} */
  let ptyProcess = null;
  /** @type {Record<string, unknown> | null} */
  let sessionGate = null;
  let lastCols = 120;
  let lastRows = 36;
  let closed = false;

  const killPty = () => {
    if (!ptyProcess) return;
    try {
      ptyProcess.kill();
    } catch {
      /* ignore */
    }
    ptyProcess = null;
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    killPty();
    sessionGate = null;
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  const startPty = (shellCmd) => {
    if (!sessionGate) {
      sendJson(ws, { type: "error", message: "セッションにゲートがありません" });
      return;
    }
    if (ptyProcess) {
      sendJson(ws, {
        type: "error",
        message: "まだプロセスが実行中です。終了してから再起動してください。",
      });
      return;
    }
    try {
      ptyProcess = spawnPty(ws, sessionGate, shellCmd, {
        cols: lastCols,
        rows: lastRows,
        onExit: () => {
          // CLI 終了後も WS は維持。再起動 UI から restart を受ける。
          ptyProcess = null;
        },
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const hint =
        detail.includes("posix_spawnp")
          ? " (node-pty の spawn-helper 実行権限か、CLI の PATH を確認してください)"
          : "";
      sendJson(ws, {
        type: "error",
        message: `シェル起動に失敗しました: ${detail}${hint}`,
      });
    }
  };

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");

    if (!authenticated) {
      handleAuth(ws, text, (ok, gate, shellCmd) => {
        if (!ok || !gate || !shellCmd) {
          ws.close();
          return;
        }
        authenticated = true;
        sessionGate = gate;
        startPty(shellCmd);
      });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      if (ptyProcess) ptyProcess.write(text);
      return;
    }

    if (msg?.type === "restart") {
      let shellCmd = SHELL_CMD;
      if (typeof msg.cmd === "string" && msg.cmd.trim()) {
        try {
          shellCmd = resolveCmdPath(msg.cmd);
        } catch (e) {
          sendJson(ws, {
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      // 実行中なら一度殺してから再起動（ユーザー明示操作）
      killPty();
      startPty(shellCmd);
      return;
    }

    if (msg?.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
      lastCols = Math.max(2, Math.floor(msg.cols));
      lastRows = Math.max(1, Math.floor(msg.rows));
      if (ptyProcess) {
        try {
          ptyProcess.resize(lastCols, lastRows);
        } catch {
          /* ignore resize errors */
        }
      }
      return;
    }

    if (msg?.type === "data" && typeof msg.data === "string") {
      if (ptyProcess) ptyProcess.write(msg.data);
      return;
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[terminal] listening on ws://${HOST}:${PORT} (cmd=${SHELL_CMD}, db=${DB_PATH})`
  );
});

function handleAuth(ws, text, done) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    sendJson(ws, { type: "error", message: "認証メッセージが不正です" });
    done(false);
    return;
  }

  if (msg?.type !== "auth" || typeof msg.token !== "string" || typeof msg.gateId !== "string") {
    sendJson(ws, {
      type: "error",
      message: '初回メッセージは {type:"auth", token, gateId} である必要があります',
    });
    done(false);
    return;
  }

  if (msg.token !== MCP_TOKEN) {
    sendJson(ws, { type: "error", message: "認証に失敗しました" });
    done(false);
    return;
  }

  const gate = loadGate(msg.gateId.trim());
  if (!gate) {
    sendJson(ws, {
      type: "error",
      message: `ゲートが見つかりません (id: ${msg.gateId})`,
    });
    done(false);
    return;
  }

  // 接続ごとの CLI 指定 (許可リスト内のみ)。未指定なら起動時のデフォルト
  let shellCmd = SHELL_CMD;
  if (typeof msg.cmd === "string" && msg.cmd.trim()) {
    try {
      shellCmd = resolveCmdPath(msg.cmd);
    } catch (e) {
      sendJson(ws, {
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      done(false);
      return;
    }
  }

  done(true, gate, shellCmd);
}

/**
 * @param {import("ws").WebSocket} ws
 * @param {Record<string, unknown>} gate
 * @param {string} shellCmd
 * @param {{ cols: number, rows: number, onExit: () => void }} opts
 */
function spawnPty(ws, gate, shellCmd, opts) {
  const { cols, rows, onExit } = opts;
  const childEnv = buildChildEnv();
  const ptyProcess = pty.spawn(shellCmd, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: REPO_ROOT,
    env: childEnv,
  });

  const cmdName = shellCmd.includes("/")
    ? shellCmd.split("/").pop()
    : shellCmd;
  sendJson(ws, { type: "ready", gateId: gate.id, cmd: cmdName });

  // ゲートコンテキストの注入は TUI の起動完了を待つ。
  // CLI によって初期化時間が大きく異なる (codex は MCP 接続待ちで数秒)
  // ため、pty 出力が落ち着いたタイミングで送る。最長 10 秒で強制注入。
  // bash 直起動時は注入しても害は少ないが、対話シェルでは邪魔なのでスキップ。
  const skipBootstrap = cmdName === "bash" || cmdName === "zsh" || cmdName === "sh";
  const bootstrap = skipBootstrap ? null : buildBootstrapPrompt(gate);
  let injected = skipBootstrap;
  let injectTimer = null;
  let forceTimer = null;
  const inject = () => {
    if (injected || !bootstrap) return;
    injected = true;
    if (injectTimer) clearTimeout(injectTimer);
    if (forceTimer) clearTimeout(forceTimer);
    try {
      ptyProcess.write(bootstrap);
    } catch {
      /* ignore if already exited */
    }
  };
  const armInject = () => {
    if (injected) return;
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(inject, 1500);
  };
  if (!skipBootstrap) {
    forceTimer = setTimeout(inject, 10000);
  }

  ptyProcess.onData((data) => {
    if (!injected) armInject();
    if (ws.readyState === ws.OPEN) {
      sendJson(ws, { type: "output", data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (injectTimer) clearTimeout(injectTimer);
    if (forceTimer) clearTimeout(forceTimer);
    sendJson(ws, {
      type: "exit",
      message: `プロセスが終了しました (code: ${exitCode ?? "?"})`,
      exitCode: exitCode ?? null,
      restartable: true,
    });
    onExit();
  });

  return ptyProcess;
}

/** WS 認証用トークンを子 CLI に漏らさない */
function buildChildEnv() {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  for (const key of SCRUB_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

function buildBootstrapPrompt(gate) {
  const resources = parseJsonArray(gate.resources);
  const rubric = parseJsonArray(gate.rubricCriteria);
  const resourceLines =
    resources.length === 0
      ? "(なし)"
      : resources
          .map((r, i) => {
            if (r && typeof r === "object") {
              const o = /** @type {Record<string, unknown>} */ (r);
              const label = typeof o.label === "string" ? o.label : `resource-${i + 1}`;
              const ref = typeof o.ref === "string" ? o.ref : "";
              const kind = typeof o.kind === "string" ? o.kind : "";
              return `- [${kind || "ref"}] ${label}${ref ? ` (${ref})` : ""}`;
            }
            return `- ${String(r)}`;
          })
          .join("\n");

  const hasRubric = rubric.length > 0;

  const context =
    (typeof gate.contextSummary === "string" && gate.contextSummary.trim()) ||
    "(文脈なし)";

  // Claude CLI 等は起動時にプロンプト入力を受け付ける想定で改行付きテキストを送る
  return [
    "※これは LLM への指示書です。編集せずこのまま送信 (Enter) すると対話が始まります。回答はこのテキスト内に書くのではなく、送信後の対話で練ってください。",
    "",
    "以下の理解度ゲートについて対話しながら回答を練りたい。",
    "",
    "【対話のルール — 必ず守れ】",
    "- 目的はユーザーの理解を深めること。答えや模範解答を直接教えてはいけない。",
    "- ヒント・質問・確認で導け (ソクラテス式)。ユーザー自身に説明させる。",
    '- ユーザーの発言だけでは提出とみなすな。「この内容で提出して」という明示的な指示があるまで answer_gate を呼ぶな。',
    "- 提出前に必ず、ユーザー自身の言葉で書かれた回答文を提示し、ユーザーの承認を取れ。",
    hasRubric
      ? "- 採点観点はアプリ側に保持されている。内容を開示せず、対話で導くこと。"
      : "",
    "",
    `【質問】`,
    gate.question,
    "",
    `【文脈】`,
    context,
    "",
    `【リソース一覧】`,
    resourceLines,
    "",
    `gateId: ${gate.id}`,
    "",
    'ユーザーが明示的に提出を指示したら、MCP ツール answer_gate(gateId, answer, source: "terminal") で提出して。',
    "採点は非同期の独立ヘッドレス LLM が行う。合否は get_gate_result かアプリのゲート詳細で確認する。",
    "",
  ].join("\n");
}

function loadGate(gateId) {
  if (!existsSync(DB_PATH)) {
    throw new Error(`データベースが見つかりません: ${DB_PATH}`);
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        `SELECT id, question, contextSummary, resources, rubricCriteria, status
         FROM Gate WHERE id = ?`
      )
      .get(gateId);
    return row ?? null;
  } finally {
    db.close();
  }
}

function resolveCmdPath(raw) {
  const base = String(raw).trim().split(/\s+/)[0] ?? "";
  const name = base.includes("/") ? base.split("/").pop() : base;
  if (!name || !ALLOWED_CMDS.has(name)) {
    throw new Error(
      `コマンド "${raw}" は許可されていません。許可: ${[...ALLOWED_CMDS].join(", ")}`
    );
  }
  // 相対名なら PATH から絶対パスへ解決 (node-pty の検索失敗を避ける)
  if (!base.includes("/")) {
    try {
      const resolved = execFileSync("which", [base], {
        encoding: "utf8",
        env: process.env,
      }).trim();
      if (resolved) return resolved;
    } catch {
      throw new Error(`コマンド "${base}" が PATH 上に見つかりません。`);
    }
  }
  return base;
}

/** npm が prebuild の実行ビットを落とすことがあるため起動時に直す */
function ensureSpawnHelperExecutable(repoRoot) {
  const helper = join(
    repoRoot,
    "node_modules/node-pty/prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper"
  );
  if (!existsSync(helper)) return;
  try {
    chmodSync(helper, 0o755);
  } catch (e) {
    console.warn(
      `[terminal] spawn-helper の chmod に失敗: ${e instanceof Error ? e.message : e}`
    );
  }
}

function resolveDbPath(databaseUrl) {
  if (!databaseUrl) return join(REPO_ROOT, "dev.db");
  let path = databaseUrl;
  if (path.startsWith("file:")) path = path.slice("file:".length);
  if (path.startsWith("./") || path.startsWith("../") || !path.startsWith("/")) {
    return resolve(REPO_ROOT, path);
  }
  return path;
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}
