"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import "xterm/css/xterm.css";

type ConnState =
  | "connecting"
  | "ready"
  | "exited"
  | "auth_failed"
  | "disconnected"
  | "error";

type TerminalCmd = "claude" | "codex";

const STATE_LABEL: Record<ConnState, string> = {
  connecting: "接続中…",
  ready: "接続済み",
  exited: "終了 — 再起動できます",
  auth_failed: "認証失敗",
  disconnected: "切断",
  error: "エラー",
};

const WS_URL = "ws://127.0.0.1:3101";

export function TerminalPanel({
  gateId,
  wsToken,
  cmd: initialCmd = "codex",
}: {
  gateId: string;
  wsToken: string;
  cmd?: TerminalCmd;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [restartCmd, setRestartCmd] = useState<TerminalCmd>(initialCmd);
  const restartRef = useRef<(nextCmd: TerminalCmd) => void>(() => {});
  const ptyAliveRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: import("xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let authenticated = false;

    const sendResize = () => {
      if (!term || !ws || ws.readyState !== WebSocket.OPEN || !authenticated) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        })
      );
    };

    const fit = () => {
      try {
        fitAddon?.fit();
        sendResize();
      } catch {
        /* ignore fit errors during teardown */
      }
    };

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        theme: {
          background: "#1c1917",
          foreground: "#f5f5f4",
          cursor: "#f5f5f4",
          selectionBackground: "#44403c",
        },
        convertEol: true,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      // レイアウト確定後にフィットさせないと行数計算がずれる
      requestAnimationFrame(() => {
        fit();
        term?.focus();
      });
      // コンテナクリックで必ずフォーカスを取る
      containerRef.current.addEventListener("mousedown", () => {
        term?.focus();
      });

      ws = new WebSocket(WS_URL);
      setConnState("connecting");

      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: "auth",
            token: wsToken,
            gateId,
            cmd: initialCmd,
          })
        );
      };

      ws.onmessage = (ev) => {
        let msg: {
          type?: string;
          data?: string;
          message?: string;
          restartable?: boolean;
          cmd?: string;
        };
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          term?.write(typeof ev.data === "string" ? ev.data : String(ev.data));
          return;
        }

        switch (msg.type) {
          case "ready":
            authenticated = true;
            ptyAliveRef.current = true;
            setConnState("ready");
            setStatusMessage(null);
            if (msg.cmd === "claude" || msg.cmd === "codex") {
              setRestartCmd(msg.cmd);
            }
            fit();
            term?.focus();
            break;
          case "output":
            if (typeof msg.data === "string") term?.write(msg.data);
            break;
          case "error":
            setConnState(authenticated ? "error" : "auth_failed");
            setStatusMessage(msg.message ?? "エラーが発生しました");
            term?.writeln(`\r\n\x1b[31m${msg.message ?? "エラー"}\x1b[0m`);
            break;
          case "exit":
            ptyAliveRef.current = false;
            // WS は維持。再起動 UI を出す（自動再起動はしない）
            if (msg.restartable !== false && authenticated) {
              setConnState("exited");
              setStatusMessage(msg.message ?? "プロセスが終了しました");
            } else {
              setConnState("disconnected");
              setStatusMessage(msg.message ?? "切断しました");
            }
            term?.writeln(`\r\n\x1b[33m${msg.message ?? "終了"}\x1b[0m`);
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        if (disposed) return;
        setConnState("error");
        setStatusMessage(
          "ターミナルサーバーに接続できません。ENABLE_TERMINAL=true で npm run dev:terminal を起動してください。"
        );
      };

      ws.onclose = () => {
        if (disposed) return;
        ptyAliveRef.current = false;
        setConnState((prev) =>
          prev === "auth_failed" || prev === "error" ? prev : "disconnected"
        );
      };

      term.onData((data) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) return;
        if (!ptyAliveRef.current) return;
        ws.send(JSON.stringify({ type: "data", data }));
      });

      // Shift+Enter を TUI の改行にマッピングする。
      // xterm.js は Shift+Enter を通常の Enter (\r) として送ってしまうが、
      // codex / Claude Code 等の TUI は kitty キーボードプロトコル (CSI-u) の
      // ESC [ 13 ; 2 u を Shift+Enter として解釈して改行を挿入する。
      // LF (\n) では改行にならないことを実機検証済み (scripts/test-shift-enter.mjs)
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type === "keydown" && ev.key === "Enter" && ev.shiftKey) {
          if (
            ws &&
            ws.readyState === WebSocket.OPEN &&
            authenticated &&
            ptyAliveRef.current
          ) {
            ws.send(JSON.stringify({ type: "data", data: "\x1b[13;2u" }));
          }
          return false;
        }
        return true;
      });

      restartRef.current = (nextCmd) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) return;
        term?.clear();
        term?.writeln(
          `\x1b[33m── ${nextCmd} を再起動します（ゲート文脈を再注入）──\x1b[0m\r\n`
        );
        setConnState("connecting");
        setStatusMessage(null);
        ptyAliveRef.current = false;
        ws.send(JSON.stringify({ type: "restart", cmd: nextCmd }));
      };

      resizeObserver = new ResizeObserver(() => fit());
      resizeObserver.observe(containerRef.current);
      window.addEventListener("resize", fit);
    })();

    return () => {
      disposed = true;
      restartRef.current = () => {};
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fit);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      term?.dispose();
    };
    // initialCmd はマウント時のみ使う。終了後の切替は restart UI 側。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId, wsToken]);

  const handleRestart = () => {
    restartRef.current(restartCmd);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            connState === "ready"
              ? "font-bold text-accent"
              : connState === "connecting"
                ? "text-ink-secondary"
                : "font-bold text-warn"
          }
        >
          {STATE_LABEL[connState]}
        </span>
        {statusMessage && (
          <span className="text-ink-secondary">{statusMessage}</span>
        )}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold text-ink-secondary transition-colors hover:bg-accent-muted"
        >
          {isFullscreen ? (
            <Minimize2 className="h-3 w-3" strokeWidth={2.2} />
          ) : (
            <Maximize2 className="h-3 w-3" strokeWidth={2.2} />
          )}
          {isFullscreen ? "縮小" : "拡大"}
        </button>
      </div>
      <div
        className={
          isFullscreen
            ? "fixed inset-0 z-50 overflow-hidden bg-[#1c1917]"
            : "relative h-[60vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-border bg-[#1c1917]"
        }
      >
        <div ref={containerRef} className="h-full w-full" />
        {connState === "exited" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1c1917]/85 px-4">
            <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-5 text-center shadow-lg">
              <p className="text-sm font-bold text-ink">プロセスが終了しました</p>
              <p className="text-xs leading-5 text-ink-secondary">
                rate limit や Ctrl+C のあとは、ここから同じ理解チェックの文脈付きで
                開き直せます。自動では再起動しません。
              </p>
              <div className="flex justify-center overflow-hidden rounded-[10px] border border-border text-xs font-bold">
                {(["claude", "codex"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setRestartCmd(c)}
                    className={
                      restartCmd === c
                        ? "bg-accent px-4 py-2 text-surface"
                        : "bg-surface px-4 py-2 text-ink-secondary transition-colors hover:bg-accent-muted"
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleRestart}
                className="inline-flex items-center gap-2 rounded-[10px] bg-accent px-5 py-3 text-sm font-bold text-surface transition-opacity hover:opacity-90"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2.2} />
                {restartCmd} を再起動
              </button>
            </div>
          </div>
        )}
      </div>
      {!isFullscreen && (
        <p className="text-[11px] leading-5 text-ink-faint">
          回答が固まったら「この内容で提出して」と伝えてください。採点完了後はこのページを再読み込みするか、採点中表示の自動更新を待ってください。
        </p>
      )}
    </div>
  );
}
