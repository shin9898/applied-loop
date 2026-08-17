import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDiffBase64, truncateDiffForGate, DIFF_MAX_CHARS } from "./gate";

test("decodeDiffBase64: 正常な base64 を復号する", () => {
  const diff = "feat: add foo\n\n+const foo = 1;\n";
  const b64 = Buffer.from(diff, "utf8").toString("base64");
  assert.equal(decodeDiffBase64(b64), diff.trim());
});

test("decodeDiffBase64: undefined / 空文字 / 空白は null", () => {
  assert.equal(decodeDiffBase64(undefined), null);
  assert.equal(decodeDiffBase64(""), null);
  assert.equal(decodeDiffBase64("   "), null);
});

test("decodeDiffBase64: 復号結果が空なら null（イベント受理は妨げない）", () => {
  const b64 = Buffer.from("   \n  ", "utf8").toString("base64");
  assert.equal(decodeDiffBase64(b64), null);
});

test("decodeDiffBase64: 上限超は truncateDiffForGate と同じ切り詰め", () => {
  const long = "x".repeat(DIFF_MAX_CHARS + 500);
  const b64 = Buffer.from(long, "utf8").toString("base64");
  const decoded = decodeDiffBase64(b64);
  assert.ok(decoded);
  assert.equal(decoded, truncateDiffForGate(long));
  assert.ok(decoded.endsWith("...(truncated)"));
});

test("decodeDiffBase64: 日本語コミットメッセージを保持する", () => {
  const diff = "fix(living-atlas): ちずのチラつき対策\n\n-old\n+new";
  const b64 = Buffer.from(diff, "utf8").toString("base64");
  assert.equal(decodeDiffBase64(b64), diff);
});
