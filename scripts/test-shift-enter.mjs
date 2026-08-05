// Shift+Enter の各エンコードを codex TUI (composer) に送り、
// ヘッドレス xterm で画面を描画して「改行として認識されたか」を検証する。
// 各候補ごとに codex を新規起動して独立判定する (画面クリア操作を避けるため)。
// 判定: "aaa" → 候補シーケンス → "bbb" と送り、composer が
//   2 行 (aaa / bbb) になれば改行成功、1 行のまま or 送信されれば失敗。
// 使い方: node scripts/test-shift-enter.mjs
import pty from "node-pty";
import headless from "@xterm/headless";
import { readFileSync } from "node:fs";

const { Terminal } = headless;

const envFromFile = {};
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) envFromFile[m[1]] = m[2];
  }
} catch {}

const COLS = 100;
const ROWS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCandidate(label, seq) {
  const p = pty.spawn("codex", [], {
    name: "xterm-256color",
    cols: COLS,
    rows: ROWS,
    cwd: process.cwd(),
    env: { ...process.env, ...envFromFile, TERM: "xterm-256color" },
  });

  const screen = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  let writeChain = Promise.resolve();
  p.onData((d) => {
    writeChain = writeChain.then(
      () => new Promise((res) => screen.write(d, res))
    );
  });
  // codex からの問い合わせ (DA / DSR / OSC) への応答を pty に返す
  screen.onData((d) => p.write(d));

  async function screenText() {
    await writeChain;
    const lines = [];
    for (let i = 0; i < ROWS; i++) {
      lines.push(screen.buffer.active.getLine(i)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }

  // 入力可能になるまで待つ: フッターが出て MCP ブート表示が消え、
  // かつ打鍵がエコーされること (Ctrl-C はブート中断になるので使わない)
  async function waitInteractive(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = await screenText();
      if (/· ~\//.test(text) && !/esc to interrupt/.test(text)) {
        p.write("zzz");
        await sleep(700);
        if ((await screenText()).includes("zzz")) {
          p.write("\x7f\x7f\x7f"); // backspace で掃除
          await sleep(500);
          return true;
        }
      }
      await sleep(800);
    }
    return false;
  }

  let result;
  try {
    if (!(await waitInteractive(120000))) {
      result = "結果: composer が入力可能にならなかった (timeout)";
      console.log(`\n===== ${label} =====\n${result}`);
      console.log(await screenText());
      return;
    }

    p.write("aaa");
    await sleep(600);
    if (!(await screenText()).includes("aaa")) {
      console.log(`\n===== ${label} =====`);
      console.log("composer に aaa が入らなかった。画面:");
      console.log(await screenText());
      return;
    }
    p.write(seq);
    await sleep(500);
    p.write("bbb");
    await sleep(800);

    const text = await screenText();
    const lines = text.split("\n");
    const idxA = lines.findIndex((l) => l.includes("aaa"));
    const twoLine =
      idxA >= 0 && idxA + 1 < lines.length && lines[idxA + 1].includes("bbb");
    const oneLine = idxA >= 0 && lines[idxA].includes("aaabbb");

    console.log(`\n===== ${label} =====`);
    console.log(
      twoLine
        ? "結果: 改行された (aaa / bbb が 2 行)"
        : oneLine
          ? "結果: 無視された (aaabbb が 1 行)"
          : idxA === -1
            ? "結果: 送信された (composer から aaa が消えた)"
            : "結果: 不明"
    );
    if (!twoLine) {
      console.log(
        lines
          .filter((l) => l.trim())
          .slice(-6)
          .join("\n")
      );
    }
  } finally {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
}

const candidates = [
  ["LF (\\n) 現在の実装", "\n"],
  ["CSI-u shift+enter (\\x1b[13;2u)", "\x1b[13;2u"],
  ["modifyOtherKeys legacy (\\x1b[27;2;13~)", "\x1b[27;2;13~"],
  ["Alt+Enter (\\x1b\\r)", "\x1b\r"],
];

for (const [label, seq] of candidates) {
  await runCandidate(label, seq);
}
process.exit(0);
