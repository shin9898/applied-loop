import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractNarrationLines,
  parseNarrationLine,
  NARRATION_PERSONA,
} from "./narration-persona";

describe("narration-persona", () => {
  it("normalizes legacy さやか to ルミナ", () => {
    const r = parseNarrationLine("さやか: こんにちは");
    assert.equal(r.speaker, NARRATION_PERSONA.name);
    assert.equal(r.text, "こんにちは");
  });

  it("parses ルミナ lines", () => {
    const r = parseNarrationLine("ルミナ: 霧を晴らそう");
    assert.equal(r.speaker, "ルミナ");
    assert.equal(r.text, "霧を晴らそう");
  });

  it("extracts dialogue and drops md chrome", () => {
    const md = [
      "# title",
      "> quote",
      "",
      "ルミナ: 一行目",
      "",
      "さやか: 旧行",
    ].join("\n");
    const lines = extractNarrationLines(md);
    assert.deepEqual(lines, ["一行目", "旧行"]);
  });
});
