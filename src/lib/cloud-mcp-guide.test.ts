import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUD_MCP_CLIENT_LABELS,
  CLOUD_MCP_TUNNEL_STEPS,
  cloudMcpClientGuides,
  cloudMcpVerifyPrompt,
} from "./cloud-mcp-guide";

describe("cloud-mcp-guide", () => {
  it("covers cursor / claude / codex", () => {
    const ids = cloudMcpClientGuides().map((g) => g.id);
    assert.deepEqual(ids, ["cursor", "claude", "codex"]);
    for (const id of ids) {
      assert.ok(CLOUD_MCP_CLIENT_LABELS[id]);
    }
  });

  it("warns that desktop-only config is not enough where relevant", () => {
    for (const g of cloudMcpClientGuides()) {
      assert.match(g.desktopTrap, /載らない|効かない/);
      assert.ok(g.steps.length >= 3);
      assert.ok(g.registerWhere.length > 10);
    }
  });

  it("cursor guide calls out Agents Add MCP and Authorization header", () => {
    const cursor = cloudMcpClientGuides().find((g) => g.id === "cursor");
    assert.ok(cursor);
    assert.match(cursor.registerWhere, /cursor\.com\/agents/);
    assert.match(cursor.headerGotcha ?? "", /Authorization/);
  });

  it("claude guide prioritizes .mcp.json for web over cloud shell only", () => {
    const claude = cloudMcpClientGuides().find((g) => g.id === "claude");
    assert.ok(claude);
    assert.match(claude.registerWhere, /\.mcp\.json/);
    assert.match(claude.desktopTrap, /\.mcp\.json/);
    assert.match(claude.steps.join("\n"), /type: http/);
    assert.match(claude.confidenceNote ?? "", /未 dogfood/);
  });

  it("codex guide uses project config + bearer_token_env_var path", () => {
    const codex = cloudMcpClientGuides().find((g) => g.id === "codex");
    assert.ok(codex);
    assert.match(codex.registerWhere, /\.codex\/config\.toml/);
    assert.match(codex.steps.join("\n"), /bearer_token_env_var|MCP_TOKEN/);
    assert.match(codex.confidenceNote ?? "", /未 dogfood/);
    assert.doesNotMatch(codex.registerWhere, /Cloud ワークスペース/);
  });

  it("verify prompt forbids answer_gate until asked", () => {
    const p = cloudMcpVerifyPrompt();
    assert.match(p, /morning_briefing/);
    assert.match(p, /list_pending_gates/);
    assert.match(p, /answer_gate/);
    assert.match(p, /解く/);
  });

  it("has shared tunnel steps", () => {
    assert.ok(CLOUD_MCP_TUNNEL_STEPS.length >= 3);
    assert.match(CLOUD_MCP_TUNNEL_STEPS.join("\n"), /cloudflared/);
    assert.match(CLOUD_MCP_TUNNEL_STEPS.join("\n"), /APPLIED_LOOP_URL/);
  });
});
