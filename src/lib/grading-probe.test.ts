import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedGradingProbeResult,
  formatCheckedLabel,
  readGradingProbeCache,
} from "./grading-probe";

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "al-grading-probe-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readGradingProbeCache", () => {
  it("returns null when file does not exist", () => {
    withTmpDir((dir) => {
      const missing = join(dir, "no-such-file.json");
      assert.equal(readGradingProbeCache(missing), null);
    });
  });

  it("returns null for malformed JSON", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      writeFileSync(file, "{not json", "utf8");
      assert.equal(readGradingProbeCache(file), null);
    });
  });

  it("returns the parsed row when valid", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      const row = {
        at: 1000,
        result: {
          ok: true,
          provider: "claude" as const,
          detail: "dry-run OK",
          howTo: "",
          dryRun: true,
        },
      };
      writeFileSync(file, JSON.stringify(row), "utf8");
      assert.deepEqual(readGradingProbeCache(file), row);
    });
  });
});

describe("formatCheckedLabel", () => {
  it("shows たった今確認 for under 1 minute", () => {
    assert.equal(formatCheckedLabel(0), "たった今確認");
    assert.equal(formatCheckedLabel(59_000), "たった今確認");
  });

  it("shows minutes", () => {
    assert.equal(formatCheckedLabel(5 * 60_000), "5分前に確認");
  });

  it("shows hours", () => {
    assert.equal(formatCheckedLabel(3 * 60 * 60_000), "3時間前に確認");
  });

  it("shows days", () => {
    assert.equal(formatCheckedLabel(2 * 24 * 60 * 60_000), "2日前に確認");
  });
});

describe("cachedGradingProbeResult", () => {
  it("returns 未確認 default when no cache file", () => {
    withTmpDir((dir) => {
      const missing = join(dir, "no-such-file.json");
      const result = cachedGradingProbeResult(missing);
      assert.equal(result.ok, false);
      assert.equal(result.detail, "まだ確認しておらぬ");
    });
  });

  it("appends freshness label to cached detail", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      const at = Date.now() - 5 * 60_000;
      writeFileSync(
        file,
        JSON.stringify({
          at,
          result: {
            ok: true,
            provider: "claude",
            detail: "dry-run OK — claude CLI: /usr/local/bin/claude",
            howTo: "",
            dryRun: true,
          },
        }),
        "utf8",
      );
      const result = cachedGradingProbeResult(file);
      assert.equal(result.ok, true);
      assert.ok(result.detail.includes("分前に確認"));
    });
  });
});
