import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  HOOK_MARKER,
  isRepoHookConnected,
  normalizeRepoPathInput,
  summarizeWatched,
  type WatchedRepoStatus,
} from "./watched-repos";

describe("normalizeRepoPathInput", () => {
  it("rejects empty", () => {
    assert.equal(normalizeRepoPathInput("  "), null);
  });

  it("expands ~/", () => {
    const p = normalizeRepoPathInput("~/tools/applied-loop");
    assert.ok(p?.endsWith("/tools/applied-loop"));
    assert.ok(p?.startsWith("/"));
  });
});

describe("isRepoHookConnected", () => {
  it("detects marker in post-commit", () => {
    const root = mkdtempSync(join(tmpdir(), "al-watch-"));
    try {
      execFileSync("git", ["init"], { cwd: root });
      const gitDir = execFileSync(
        "git",
        ["-C", root, "rev-parse", "--absolute-git-dir"],
        { encoding: "utf8" },
      ).trim();
      const hooks = join(gitDir, "hooks");
      mkdirSync(hooks, { recursive: true });
      writeFileSync(
        join(hooks, "post-commit"),
        `#!/bin/sh\nsh "$HOME/.applied-loop/hooks/post-commit" || true ${HOOK_MARKER}\n`,
      );
      assert.equal(isRepoHookConnected(root), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("summarizeWatched", () => {
  it("counts connected", () => {
    const rows: WatchedRepoStatus[] = [
      {
        path: "/a",
        addedAt: "t",
        isGit: true,
        connected: true,
        hookBodyPresent: true,
      },
      {
        path: "/b",
        addedAt: "t",
        isGit: true,
        connected: false,
        hookBodyPresent: true,
      },
    ];
    const s = summarizeWatched(rows);
    assert.equal(s.total, 2);
    assert.equal(s.connected, 1);
    assert.equal(s.anyConnected, true);
  });
});
