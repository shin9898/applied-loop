import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { requireBearerToken } from "./api-auth";

const ORIGINAL = process.env.MCP_TOKEN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = ORIGINAL;
});

function req(auth?: string): Request {
  return new Request("http://localhost:3100/api/events", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

test("MCP_TOKEN 未設定なら 503 で拒否（素通りさせない）", () => {
  delete process.env.MCP_TOKEN;
  const res = requireBearerToken(req("Bearer whatever"));
  assert.ok(res);
  assert.equal(res.status, 503);
});

test("MCP_TOKEN が空白のみでも未設定扱い", () => {
  process.env.MCP_TOKEN = "   ";
  const res = requireBearerToken(req("Bearer whatever"));
  assert.ok(res);
  assert.equal(res.status, 503);
});

test("トークン不一致は 401", () => {
  process.env.MCP_TOKEN = "correct-token";
  const res = requireBearerToken(req("Bearer wrong"));
  assert.ok(res);
  assert.equal(res.status, 401);
});

test("Authorization ヘッダなしは 401", () => {
  process.env.MCP_TOKEN = "correct-token";
  const res = requireBearerToken(req());
  assert.ok(res);
  assert.equal(res.status, 401);
});

test("一致すれば null（通過）", () => {
  process.env.MCP_TOKEN = "correct-token";
  const res = requireBearerToken(req("Bearer correct-token"));
  assert.equal(res, null);
});
