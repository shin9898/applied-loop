import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMcpClientSnippets,
  getMcpEndpointInfo,
  isLocalRequestHost,
  isLoopbackBaseUrl,
  mcpEndpointUrl,
  resolveAppliedLoopBaseUrl,
} from "./mcp-endpoint";

describe("mcp-endpoint", () => {
  it("defaults to localhost:3100", () => {
    const env = {};
    assert.equal(resolveAppliedLoopBaseUrl(env), "http://localhost:3100");
    assert.equal(mcpEndpointUrl(env), "http://localhost:3100/api/mcp");
    assert.equal(getMcpEndpointInfo(env).reachable, false);
  });

  it("prefers MCP_PUBLIC_URL over APPLIED_LOOP_URL", () => {
    const env = {
      APPLIED_LOOP_URL: "https://a.example/",
      MCP_PUBLIC_URL: "https://b.example/",
    };
    assert.equal(resolveAppliedLoopBaseUrl(env), "https://b.example");
    assert.equal(getMcpEndpointInfo(env).reachable, true);
  });

  it("detects loopback hosts", () => {
    assert.equal(isLoopbackBaseUrl("http://127.0.0.1:3100"), true);
    assert.equal(isLoopbackBaseUrl("https://xx.trycloudflare.com"), false);
    assert.equal(isLocalRequestHost("localhost:3100"), true);
    assert.equal(isLocalRequestHost("xx.trycloudflare.com"), false);
  });

  it("builds client snippets", () => {
    const s = buildMcpClientSnippets({
      mcpUrl: "https://ex.example/api/mcp",
      token: "secret",
    });
    assert.match(s.cursorJson, /https:\/\/ex\.example\/api\/mcp/);
    assert.match(s.cursorJson, /Bearer secret/);
    assert.match(s.claudeCli, /claude mcp add/);
    assert.match(s.claudeProjectJson, /"type": "http"/);
    assert.match(s.claudeProjectJson, /Bearer \$\{MCP_TOKEN\}/);
    assert.doesNotMatch(s.claudeProjectJson, /Bearer secret/);
    assert.match(s.codexToml, /mcp_servers\.applied-loop/);
    assert.match(s.codexToml, /bearer_token_env_var = "MCP_TOKEN"/);
    assert.doesNotMatch(s.codexToml, /Bearer secret/);
  });
});
