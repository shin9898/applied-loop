import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cliArgsForModel,
  resolveModelValue,
  TERMINAL_MODEL_OPTIONS,
} from "./terminal-models";

describe("terminal-models", () => {
  it("maps claude/codex flags", () => {
    assert.deepEqual(cliArgsForModel("claude", "sonnet"), [
      "--model",
      "sonnet",
    ]);
    assert.deepEqual(cliArgsForModel("codex", "gpt-5.6-sol"), [
      "-m",
      "gpt-5.6-sol",
    ]);
    assert.deepEqual(cliArgsForModel("claude", null), []);
  });

  it("resolves presets and custom", () => {
    assert.equal(resolveModelValue("claude", "opus"), "opus");
    assert.equal(resolveModelValue("claude", "default"), null);
    assert.equal(
      resolveModelValue("claude", "claude-opus-4-8"),
      "claude-opus-4-8",
    );
    assert.equal(resolveModelValue("codex", "gpt-5.6-luna"), "gpt-5.6-luna");
    assert.equal(resolveModelValue("codex", "custom", " gpt-5 "), "gpt-5");
  });

  it("labels mention current generation for claude aliases", () => {
    const labels = TERMINAL_MODEL_OPTIONS.claude.map((o) => o.label).join(" ");
    assert.match(labels, /Sonnet/);
    assert.match(labels, /Opus/);
    assert.match(labels, /Fable 5/);
    assert.match(labels, /4\.8/);
  });

  it("codex presets track 5.6 catalog", () => {
    const ids = TERMINAL_MODEL_OPTIONS.codex.map((o) => o.id);
    assert.ok(ids.includes("gpt-5.6-sol"));
    assert.ok(ids.includes("gpt-5.6-terra"));
    assert.ok(ids.includes("gpt-5.6-luna"));
    assert.ok(!ids.includes("o3"));
  });
});
