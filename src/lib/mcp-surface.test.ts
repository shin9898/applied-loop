import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MCP_CORE_TOOLS,
  mcpToolAllowedOnSurface,
  resolveMcpSurface,
} from "./mcp-surface";

describe("mcp-surface", () => {
  it("defaults to core", () => {
    assert.equal(resolveMcpSurface({}), "core");
    assert.equal(resolveMcpSurface({ MCP_SURFACE: "" }), "core");
    assert.equal(resolveMcpSurface({ MCP_SURFACE: "CORE" }), "core");
  });

  it("accepts full", () => {
    assert.equal(resolveMcpSurface({ MCP_SURFACE: "full" }), "full");
  });

  it("core allows briefing/list/request/answer/get_result only", () => {
    assert.equal(MCP_CORE_TOOLS.length <= 6, true);
    assert.ok(MCP_CORE_TOOLS.includes("request_gate"));
    for (const t of MCP_CORE_TOOLS) {
      assert.equal(mcpToolAllowedOnSurface(t, "core"), true);
    }
    assert.equal(mcpToolAllowedOnSurface("capture_learning_candidate", "core"), false);
    assert.equal(mcpToolAllowedOnSurface("register_goals", "core"), false);
  });

  it("full allows everything", () => {
    assert.equal(mcpToolAllowedOnSurface("register_goals", "full"), true);
    assert.equal(mcpToolAllowedOnSurface("capture_learning_candidate", "full"), true);
  });
});
