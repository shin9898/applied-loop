import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMcpClientSnippets,
  getMcpEndpointInfo,
  isLocalRequestHost,
  isLoopbackBaseUrl,
  mcpEndpointUrl,
  resolveAppliedLoopBaseUrl,
  resolveReachableBaseUrl,
} from "./mcp-endpoint";

describe("mcp-endpoint", () => {
  it("defaults to localhost:3100", () => {
    const env = {};
    assert.equal(resolveAppliedLoopBaseUrl(env), "http://localhost:3100");
    assert.equal(mcpEndpointUrl(env), "http://localhost:3100/api/mcp");
    const info = getMcpEndpointInfo(env);
    assert.equal(info.reachable, false);
    assert.equal(info.localMcpUrl, "http://localhost:3100/api/mcp");
    assert.equal(info.reachableMcpUrl, null);
    assert.equal(info.mcpUrl, info.localMcpUrl);
  });

  it("keeps localMcpUrl when Reachable is set", () => {
    const env = {
      APPLIED_LOOP_URL: "https://a.example/",
      MCP_PUBLIC_URL: "https://b.example/",
    };
    assert.equal(resolveAppliedLoopBaseUrl(env), "https://b.example");
    assert.equal(resolveReachableBaseUrl(env), "https://b.example");
    const info = getMcpEndpointInfo(env);
    assert.equal(info.reachable, true);
    assert.equal(info.localMcpUrl, "http://localhost:3100/api/mcp");
    assert.equal(info.reachableMcpUrl, "https://b.example/api/mcp");
    assert.equal(info.mcpUrl, "https://b.example/api/mcp");
  });

  it("ignores loopback APPLIED_LOOP_URL for reachable", () => {
    const env = { APPLIED_LOOP_URL: "http://127.0.0.1:3100" };
    assert.equal(resolveReachableBaseUrl(env), null);
    assert.equal(getMcpEndpointInfo(env).reachable, false);
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
    assert.match(s.cursorJson, /"type": "http"/);
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
