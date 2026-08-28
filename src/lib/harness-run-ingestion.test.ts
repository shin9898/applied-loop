import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildHarnessRunPersistenceData,
  buildHarnessRunUpsertArgs,
  parseHarnessRunPayload,
} from "./harness-run-ingestion";
import {
  collectItems,
  countPendingCandidates,
  postRunWithRetry,
  resolvePendingStatus,
  sortCandidatesForScheduledRun,
} from "../../scripts/collect-harness.mjs";

const fingerprint = `sha256:${"a".repeat(64)}`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    harness: "codex",
    sessionId: "session-a5",
    model: "gpt-5.6",
    repo: "applied-loop",
    tools: [{ name: "functions.exec", kind: "builtin", calls: 2 }],
    tokensIn: 100,
    tokensOut: 20,
    cacheRead: 80,
    cacheCreate: 0,
    thinking: 3,
    turns: 1,
    startedAt: "2026-08-23T00:00:00.000Z",
    endedAt: "2026-08-23T00:05:00.000Z",
    collectorVersion: "harness-collector-v3",
    contextFingerprint: fingerprint,
    ...overrides,
  };
}

test("A5-CG2-T1 accepts raw/source metadata and derives evidence only on the server", () => {
  const parsed = parseHarnessRunPayload(payload());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.deepEqual(buildHarnessRunPersistenceData(parsed.data), {
    model: "gpt-5.6",
    repo: "applied-loop",
    tools: JSON.stringify([{ name: "functions.exec", kind: "builtin", calls: 2 }]),
    tokensIn: 100,
    tokensOut: 20,
    cacheRead: 80,
    cacheCreate: 0,
    thinking: 3,
    turns: 1,
    startedAt: new Date("2026-08-23T00:00:00.000Z"),
    endedAt: new Date("2026-08-23T00:05:00.000Z"),
    collectorVersion: "harness-collector-v3",
    contextFingerprint: fingerprint,
    inputTotalTokens: 100,
    inputUncachedTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: null,
    usageSemanticsVersion: "harness-usage-v1",
    usageNormalizationStatus: "supported",
    usageNormalizationReason: null,
  });
  const upsert = buildHarnessRunUpsertArgs(parsed.data);
  assert.deepEqual(upsert.where, {
    harness_sessionId: { harness: "codex", sessionId: "session-a5" },
  });
  assert.equal(upsert.create.harness, "codex");
  assert.equal(upsert.create.sessionId, "session-a5");
  assert.deepEqual(upsert.update, buildHarnessRunPersistenceData(parsed.data));
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(upsert.create).filter(([key]) => key !== "harness" && key !== "sessionId"),
    ),
    upsert.update,
  );

  const legacy = parseHarnessRunPayload(payload({ collectorVersion: undefined, contextFingerprint: undefined }));
  assert.equal(legacy.success, true);
  if (!legacy.success) return;
  const legacyPersistence = buildHarnessRunPersistenceData(legacy.data);
  assert.equal(legacyPersistence.collectorVersion, null);
  assert.equal(legacyPersistence.contextFingerprint, null);
});

test("A5-CG2-T2 rejects forged derived evidence and malformed source metadata", () => {
  const forged = parseHarnessRunPayload(payload({ inputTotalTokens: 1 }));
  assert.equal(forged.success, false);

  for (const source of [
    payload({ collectorVersion: "Collector V2" }),
    payload({ collectorVersion: "a".repeat(65) }),
    payload({ contextFingerprint: "sha256:UPPERCASE" }),
    payload({ contextFingerprint: `sha256:${"a".repeat(63)}` }),
  ]) {
    assert.equal(parseHarnessRunPayload(source).success, false);
  }
});

test("A5-CG2-T3 makes the collector identify its source without broadening its metadata allowlist", () => {
  const source = readFileSync(join(process.cwd(), "scripts/collect-harness.mjs"), "utf8");
  assert.match(source, /const COLLECTOR_VERSION = "harness-collector-v3";/);
  assert.match(source, /collectorVersion: COLLECTOR_VERSION,/);
  assert.match(source, /contextFingerprint,/);
  assert.match(source, /toPayload\(parsed, prev\?\.contextFingerprint\)/);
  assert.match(source, /contextFingerprint: payload\.contextFingerprint,/);
  assert.match(source, /"collectorVersion",/);
  assert.match(source, /"contextFingerprint",/);
  assert.doesNotMatch(source, /(?:promptBody|conversationBody|messageText|toolArguments)/);
});

type CollectorSafetyFixture = {
  home: string;
  statePath: string;
  statusPath: string;
  lockPath: string;
  snapshotPath: string;
  firstPath: string;
  writeSession: (name: string, sessionId: string, timestamp: string) => string;
  env: NodeJS.ProcessEnv;
};

type CollectorReceivedPayload = Record<string, unknown>;

const collectorSafetyScript = join(process.cwd(), "scripts", "collect-harness.mjs");

function createCollectorSafetyFixture(): CollectorSafetyFixture {
  const home = mkdtempSync(join(tmpdir(), "applied-loop-harness-collector-"));
  const sessionsPath = join(home, ".codex", "sessions");
  mkdirSync(sessionsPath, { recursive: true });

  const session = (sessionId: string, timestamp: string) =>
    [
      { type: "session_meta", timestamp, payload: { id: sessionId, cwd: "/tmp/workbench" } },
      { type: "turn_context", timestamp, payload: { model: "gpt-5.6" } },
      { type: "event_msg", timestamp, payload: { type: "user_message" } },
      {
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 20,
              cached_input_tokens: 80,
              reasoning_output_tokens: 5,
            },
          },
        },
      },
    ];
  const writeSession = (path: string, sessionId: string, timestamp: string) => {
    writeFileSync(
      path,
      session(sessionId, timestamp).map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
  };

  const firstPath = join(sessionsPath, "01-a.jsonl");
  writeSession(firstPath, "session-a", "2026-08-28T10:00:00.000Z");
  writeSession(join(sessionsPath, "02-b.jsonl"), "session-b", "2026-08-28T11:00:00.000Z");

  const statePath = join(home, "collector-state.json");
  const statusPath = join(home, "collector-status.json");
  const lockPath = join(home, "collector.lock");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    APPLIED_LOOP_COLLECT_STATE_PATH: statePath,
    APPLIED_LOOP_COLLECT_STATUS_PATH: statusPath,
    APPLIED_LOOP_COLLECT_LOCK_PATH: lockPath,
    APPLIED_LOOP_URL: "http://127.0.0.1:1",
    APPLIED_LOOP_COLLECT_RETRY_MAX_ATTEMPTS: "2",
    APPLIED_LOOP_COLLECT_RETRY_BASE_DELAY_MS: "1",
    APPLIED_LOOP_COLLECT_RETRY_MAX_DELAY_MS: "1",
    MCP_TOKEN: "",
  };
  delete env.APPLIED_LOOP_CONTEXT_FINGERPRINT;
  return {
    home,
    statePath,
    statusPath,
    lockPath,
    snapshotPath: join(home, "targets.json"),
    firstPath,
    writeSession: (name, sessionId, timestamp) => {
      const path = join(sessionsPath, name);
      writeSession(path, sessionId, timestamp);
      return path;
    },
    env,
  };
}

function runCollectorSafety(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [collectorSafetyScript, ...args], {
      cwd: process.cwd(),
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (status: number | null) => resolve({ status, stdout, stderr }));
  });
}

async function withCollectorSafetyServer<T>(
  callback: (url: string, received: CollectorReceivedPayload[]) => Promise<T>,
  responseStatuses: readonly number[] = [200],
  responseDelayMs = 0,
): Promise<T> {
  const received: CollectorReceivedPayload[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CollectorReceivedPayload);
        const status = responseStatuses[Math.min(received.length - 1, responseStatuses.length - 1)] ?? 200;
        setTimeout(() => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
        }, responseDelayMs);
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("collector test server did not expose a TCP address");
  }
  try {
    return await callback(`http://127.0.0.1:${address.port}`, received);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("A5-CG2-T5 creates a deterministic bounded snapshot without mutating checkpoint", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const result = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath, "--max-sends", "1"],
      fixture.env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(fixture.statePath), false);
    const snapshot = JSON.parse(readFileSync(fixture.snapshotPath, "utf8")) as {
      targets: Array<Record<string, unknown>>;
      summary: Record<string, unknown>;
    };
    assert.equal(snapshot.targets.length, 1);
    assert.equal(snapshot.targets[0].path, fixture.firstPath);
    assert.equal(snapshot.summary.candidateCount, 2);
    assert.equal(snapshot.summary.eligibleCount, 2);
    assert.equal(snapshot.summary.selectedCount, 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /user_message|token_count/);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("A5-CG2-T6 fails closed before sending stale targets and resumes under a hard limit", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const snapshotResult = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath],
      fixture.env,
    );
    assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
    appendFileSync(fixture.firstPath, "\n");
    await withCollectorSafetyServer(async (url, received) => {
      const stale = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /snapshot_stale/);
      assert.equal(received.length, 0);
      assert.equal(existsSync(fixture.statePath), false);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("A5-CG2-T7 applies a fresh snapshot once per target and resumes after max-sends", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const snapshotResult = await runCollectorSafety(
      ["--dry-run", "--snapshot-out", fixture.snapshotPath],
      fixture.env,
    );
    assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
    await withCollectorSafetyServer(async (url, received) => {
      const firstApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath, "--max-sends", "1"],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(firstApply.status, 0, firstApply.stderr);
      assert.match(firstApply.stdout, /sent=1/);
      assert.match(firstApply.stdout, /attempts=1/);
      assert.match(firstApply.stdout, /stoppedAtLimit=true/);
      assert.equal(received.length, 1);
      assert.equal(received[0].collectorVersion, "harness-collector-v3");
      assert.equal(Object.hasOwn(received[0], "message"), false);

      const resumedApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(resumedApply.status, 0, resumedApply.stderr);
      assert.equal(received.length, 2);

      const idempotentApply = await runCollectorSafety(
        ["--apply-snapshot", fixture.snapshotPath],
        { ...fixture.env, APPLIED_LOOP_URL: url },
      );
      assert.equal(idempotentApply.status, 0, idempotentApply.stderr);
      assert.equal(received.length, 2);
      assert.match(idempotentApply.stdout, /skippedUnchanged=2/);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T1 retries a transient server failure and records a complete sync", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    await withCollectorSafetyServer(async (url, received) => {
      const result = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(received.length, 3, "first payload retries once; second payload sends once");

      const status = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
      assert.equal(status.runState, "synced");
      assert.equal(status.pendingCount, 0);
      assert.equal(status.pendingCountExact, true);
      assert.equal(status.errorCount, 0);
      assert.equal(status.runMode, "scheduled");
      assert.equal(typeof status.lastSuccessfulSyncAt, "string");
      assert.equal(typeof status.lastCheckpointAt, "string");

      const diagnostic = await runCollectorSafety(["--status", "--json"], fixture.env);
      assert.equal(diagnostic.status, 0, diagnostic.stderr);
      const report = JSON.parse(diagnostic.stdout) as Record<string, unknown>;
      assert.equal(report.pendingCount, 0);
      assert.equal(report.stateHealth, "ok");
    }, [503, 200, 200]);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T2 leaves failed work pending, exits nonzero, and catches up next run", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const failed = await runCollectorSafety([], {
      ...fixture.env,
      APPLIED_LOOP_COLLECT_RETRY_MAX_ATTEMPTS: "1",
      APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
    });
    assert.equal(failed.status, 1);
    const failedStatus = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
    assert.equal(failedStatus.runState, "error");
    assert.equal(failedStatus.pendingCount, 2);
    assert.equal(failedStatus.pendingCountExact, true);
    assert.equal(failedStatus.errorCount, 1);
    assert.equal(typeof failedStatus.lastError, "string");

    await withCollectorSafetyServer(async (url, received) => {
      const caughtUp = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
      });
      assert.equal(caughtUp.status, 0, caughtUp.stderr);
      assert.equal(received.length, 2);
      const caughtUpStatus = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
      assert.equal(caughtUpStatus.runState, "synced");
      assert.equal(caughtUpStatus.pendingCount, 0);
      assert.equal(caughtUpStatus.consecutiveFailures, 0);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T3 quarantines a corrupt checkpoint and rebuilds it idempotently", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    writeFileSync(fixture.statePath, "{not-json\n");
    await withCollectorSafetyServer(async (url, received) => {
      const recovered = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(received.length, 2);
      const state = JSON.parse(readFileSync(fixture.statePath, "utf8")) as Record<string, unknown>;
      assert.equal(state.schemaVersion, 2);
      const quarantined = readdirSync(fixture.home).filter((name) =>
        name.startsWith("collector-state.json.corrupt-"),
      );
      assert.equal(quarantined.length, 1);
      const status = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
      assert.match(String(status.stateRecovery), /quarantined corrupt checkpoint/);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T4 renders a 15-minute RunAtLoad launch agent without test-only bounds", () => {
  const manager = join(process.cwd(), "scripts", "manage-harness-collector.mjs");
  const rendered = spawnSync(process.execPath, [manager, "render"], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: "/Users/tester" },
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(rendered.stdout, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(rendered.stdout, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered.stdout, /<key>APPLIED_LOOP_NODE_PATH<\/key>/);
  assert.match(
    rendered.stdout,
    /<key>APPLIED_LOOP_COLLECT_RUN_MODE<\/key>\s*<string>scheduled<\/string>/,
  );
  assert.match(
    rendered.stdout,
    /<key>APPLIED_LOOP_COLLECT_RUN_BUDGET_MS<\/key>\s*<string>720000<\/string>/,
  );
  assert.match(
    rendered.stdout,
    new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(rendered.stdout, /YOUR_USER|snapshot|max-sends|dry-run/);

  const wrapper = readFileSync(join(process.cwd(), "scripts", "harness-collect.sh"), "utf8");
  assert.match(wrapper, /exec "\$RENDERED_NODE_PATH"/);
  assert.doesNotMatch(wrapper, /\/usr\/bin\/env node/);
  assert.doesNotMatch(wrapper, /source "\$ROOT\/\.env"/);
});

test("AUTO-COLLECT-T4b ignores dotenv overrides of the rendered Node and scheduled budget", () => {
  const home = mkdtempSync(join(tmpdir(), "applied-loop-wrapper-"));
  try {
    const scriptsPath = join(home, "scripts");
    const capturePath = join(home, "capture.txt");
    const renderedNode = join(home, "rendered-node");
    const dotenvNode = join(home, "dotenv-node");
    mkdirSync(scriptsPath, { recursive: true });
    writeFileSync(
      join(scriptsPath, "harness-collect.sh"),
      readFileSync(join(process.cwd(), "scripts", "harness-collect.sh"), "utf8"),
      { mode: 0o755 },
    );
    writeFileSync(
      renderedNode,
      [
        "#!/bin/bash",
        'printf "%s\\n%s\\n%s\\n%s\\n" "$0" "$APPLIED_LOOP_COLLECT_RUN_MODE" "$APPLIED_LOOP_COLLECT_RUN_BUDGET_MS" "$1" > "$WRAPPER_CAPTURE"',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(dotenvNode, "#!/bin/bash\nexit 99\n", { mode: 0o755 });
    writeFileSync(
      join(home, ".env"),
      [
        `APPLIED_LOOP_NODE_PATH=${dotenvNode}`,
        "APPLIED_LOOP_COLLECT_RUN_MODE=standard",
        "APPLIED_LOOP_COLLECT_RUN_BUDGET_MS=1",
        "APPLIED_LOOP_URL=http://dotenv.invalid",
        "MCP_TOKEN=dotenv-token",
        "",
      ].join("\n"),
    );

    const result = spawnSync("/bin/bash", [join(scriptsPath, "harness-collect.sh")], {
      cwd: home,
      env: {
        ...process.env,
        APPLIED_LOOP_NODE_PATH: renderedNode,
        APPLIED_LOOP_COLLECT_RUN_MODE: "standard",
        APPLIED_LOOP_COLLECT_RUN_BUDGET_MS: "1",
        WRAPPER_CAPTURE: capturePath,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(capturePath, "utf8").trim().split("\n"), [
      renderedNode,
      "scheduled",
      "720000",
      join(home, "scripts", "collect-harness.mjs"),
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5 rejects a concurrent writer so one session is not sent twice", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    await withCollectorSafetyServer(async (url, received) => {
      const env = {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
      };
      const first = runCollectorSafety([], env);
      for (let attempt = 0; received.length === 0 && attempt < 100; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      }
      assert.equal(received.length, 1, "first collector must hold the lock while sending");
      const owner = JSON.parse(readFileSync(fixture.lockPath, "utf8")) as Record<string, unknown>;
      assert.equal(typeof owner.pid, "number");
      assert.equal(typeof owner.processStartIdentity, "string");
      assert.equal(typeof owner.lockId, "string");

      const concurrent = await runCollectorSafety([], env);
      assert.equal(concurrent.status, 75);
      assert.match(concurrent.stderr, /collector_already_running/);

      const completed = await first;
      assert.equal(completed.status, 0, completed.stderr);
      assert.equal(received.length, 2, "the concurrent collector must not duplicate either session");
    }, [200], 100);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test(
  "AUTO-COLLECT-T5a keeps the macOS lock inode across owner turnover and rejects a third collector",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = createCollectorSafetyFixture();
    try {
      await withCollectorSafetyServer(async (url, received) => {
        const env = {
          ...fixture.env,
          APPLIED_LOOP_URL: url,
          APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
        };
        const first = await runCollectorSafety([], env);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(existsSync(fixture.lockPath), true, "lockf -k must retain the path");
        const firstInode = statSync(fixture.lockPath).ino;

        fixture.writeSession("03-owner-turn.jsonl", "session-owner-turn", "2026-08-28T12:00:00.000Z");
        const second = runCollectorSafety([], env);
        for (let attempt = 0; received.length < 3 && attempt < 200; attempt += 1) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 5));
        }
        assert.equal(received.length, 3, "the second owner must hold the lock while sending");
        assert.equal(statSync(fixture.lockPath).ino, firstInode, "owner turnover must reuse one inode");

        const third = await runCollectorSafety([], env);
        assert.equal(third.status, 75);
        assert.match(third.stderr, /collector_already_running/);
        const completed = await second;
        assert.equal(completed.status, 0, completed.stderr);
      }, [200], 100);
    } finally {
      rmSync(fixture.home, { recursive: true, force: true });
    }
  },
);

test("AUTO-COLLECT-T5b fails closed while a competing lock owner is still unwritten", async () => {
  const fixture = createCollectorSafetyFixture();
  const competingDescriptor = openSync(fixture.lockPath, "wx", 0o600);
  try {
    const concurrent = await runCollectorSafety([], fixture.env);
    assert.equal(concurrent.status, 75);
    assert.match(concurrent.stderr, /collector_already_running/);
    assert.equal(existsSync(fixture.lockPath), true, "an unknown owner lock must not be unlinked");
    assert.equal(readFileSync(fixture.lockPath, "utf8"), "");
  } finally {
    closeSync(competingDescriptor);
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5e recovers an old unknown lock left by a crash", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    writeFileSync(fixture.lockPath, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(fixture.lockPath, old, old);
    await withCollectorSafetyServer(async (url, received) => {
      const recovered = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_LOCK_UNKNOWN_STALE_MS: "1000",
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(received.length, 2);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5f does not mistake a reused live PID for the original lock owner", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    writeFileSync(
      fixture.lockPath,
      JSON.stringify({
        pid: process.pid,
        processStartIdentity: "definitely-not-this-process",
        lockId: "stale-owner",
        createdAt: "2026-08-28T00:00:00.000Z",
      }) + "\n",
    );
    await withCollectorSafetyServer(async (url, received) => {
      const recovered = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(received.length, 2);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5g serializes concurrent recovery of the same stale lock", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    writeFileSync(
      fixture.lockPath,
      JSON.stringify({
        pid: 2_147_483_000,
        processStartIdentity: "dead-process",
        lockId: "stale-owner",
        createdAt: "2026-08-28T00:00:00.000Z",
      }) + "\n",
    );
    await withCollectorSafetyServer(async (url, received) => {
      const env = { ...fixture.env, APPLIED_LOOP_URL: url };
      const [left, right] = await Promise.all([
        runCollectorSafety([], env),
        runCollectorSafety([], env),
      ]);
      assert.deepEqual([left.status, right.status].sort(), [0, 75]);
      assert.equal(received.length, 2, "one recovery winner sends each session once");
    }, [200], 100);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5c releases the kernel lock when owner initialization fails", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const preloadPath = join(fixture.home, "fail-first-fd-write.cjs");
    writeFileSync(
      preloadPath,
      [
        'const fs = require("node:fs");',
        'const { syncBuiltinESMExports } = require("node:module");',
        "const originalWriteFileSync = fs.writeFileSync;",
        "let failed = false;",
        "fs.writeFileSync = function patchedWriteFileSync(target, ...args) {",
        '  if (!failed && typeof target === "number") {',
        "    failed = true;",
        '    const error = new Error("injected lock owner write failure");',
        '    error.code = "EIO";',
        "    throw error;",
        "  }",
        "  return originalWriteFileSync.call(this, target, ...args);",
        "};",
        "syncBuiltinESMExports();",
        "",
      ].join("\n"),
    );
    const failed = spawnSync(
      process.execPath,
      ["--require", preloadPath, collectorSafetyScript],
      { cwd: process.cwd(), env: fixture.env, encoding: "utf8" },
    );
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /injected lock owner write failure/);
    if (existsSync(fixture.lockPath)) {
      const old = new Date(Date.now() - 60_000);
      utimesSync(fixture.lockPath, old, old);
    }
    await withCollectorSafetyServer(async (url, received) => {
      const recovered = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_LOCK_UNKNOWN_STALE_MS: "1000",
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(received.length, 2);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T5d counts Claude cache creation usage exactly once", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const claudeProject = join(fixture.home, ".claude", "projects", "-tmp-workbench");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-28T12:00:00.000Z",
        sessionId: "claude-session",
        cwd: "/tmp/workbench",
        message: {
          model: "claude-test",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 30,
          },
          content: [],
        },
      }) + "\n",
    );

    await withCollectorSafetyServer(async (url, received) => {
      const result = await runCollectorSafety([], {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
      });
      assert.equal(result.status, 0, result.stderr);
      const claudePayload = received.find((item) => item.harness === "claude");
      assert.ok(claudePayload);
      assert.equal(claudePayload.cacheCreate, 30);
      assert.equal(claudePayload.tokensIn, 100);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T6 yields at an injected deadline and leaves unprocessed work for the next tick", async () => {
  const candidates = [
    { path: "a.jsonl", harness: "codex", fallbackRepo: null },
    { path: "b.jsonl", harness: "codex", fallbackRepo: null },
  ];
  const state: { files: Record<string, Record<string, unknown>> } = { files: {} };
  const fingerprints: Record<string, { size: number; mtimeMs: number }> = {
    "a.jsonl": { size: 1, mtimeMs: 1 },
    "b.jsonl": { size: 1, mtimeMs: 2 },
  };
  const parsed = (item: { path: string }) => ({
    harness: "codex",
    sessionId: item.path,
    agg: {
      model: null,
      repo: null,
      cwd: null,
      tools: new Map(),
      tokensIn: 1,
      tokensOut: 1,
      cacheRead: 0,
      cacheCreate: 0,
      thinking: 0,
      turns: 1,
      startedAt: null,
      endedAt: null,
    },
  });
  let now = 0;
  const sent: string[] = [];
  const first = await collectItems(candidates, state, {
    dryRun: false,
    maxSends: null,
    shouldDefer: () => now >= 10,
    readFingerprint: (path: string) => fingerprints[path],
    parseItem: parsed,
    postPayload: async (body: { sessionId: string }, options: { onAttempt: () => void }) => {
      options.onAttempt();
      sent.push(body.sessionId);
      now = 10;
    },
    checkpointState: () => {},
    nowIso: () => "2026-08-28T00:00:02.000Z",
  });
  assert.equal(first.deferredForBudget, true);
  assert.deepEqual(sent, ["a.jsonl"]);
  assert.deepEqual(Object.keys(state.files), ["a.jsonl"]);

  now = 0;
  const resumed = await collectItems(candidates, state, {
    dryRun: false,
    maxSends: null,
    shouldDefer: () => false,
    readFingerprint: (path: string) => fingerprints[path],
    parseItem: parsed,
    postPayload: async (body: { sessionId: string }, options: { onAttempt: () => void }) => {
      options.onAttempt();
      sent.push(body.sessionId);
    },
    checkpointState: () => {},
    nowIso: () => "2026-08-28T00:00:03.000Z",
  });
  assert.equal(resumed.deferredForBudget, false);
  assert.deepEqual(sent, ["a.jsonl", "b.jsonl"]);
  assert.deepEqual(Object.keys(state.files), ["a.jsonl", "b.jsonl"]);
});

test("AUTO-COLLECT-T6b stops scheduled stat/sort and pending scans at an injected deadline", () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    path: `${index}.jsonl`,
    harness: "codex",
    fallbackRepo: null,
  }));
  const state = { files: {} };
  let now = 0;
  const readFingerprint = () => {
    now += 1;
    return { size: 1, mtimeMs: now };
  };
  const scheduled = sortCandidatesForScheduledRun(candidates, state, {
    shouldHalt: () => now >= 3,
    readFingerprint,
  });
  assert.equal(scheduled.complete, false);
  assert.equal(scheduled.examinedCount, 3);
  assert.deepEqual(scheduled.candidates, []);

  now = 0;
  const pending = countPendingCandidates(candidates, state, {
    shouldHalt: () => now >= 3,
    readFingerprint,
  });
  assert.equal(pending.complete, false);
  assert.equal(pending.examinedCount, 3);
  assert.equal(pending.pendingCount, 3);

  assert.deepEqual(
    resolvePendingStatus({ pendingAfter: pending, hasError: false, deferredForBudget: true }),
    {
      runState: "pending",
      pendingCount: null,
      pendingCountExact: false,
      unreadableCount: null,
    },
  );
});

test("AUTO-COLLECT-T6b2 persists an incomplete scheduled scan as unknown pending, never synced", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    const preloadPath = join(fixture.home, "virtual-collector-clock.cjs");
    writeFileSync(
      preloadPath,
      [
        'const fs = require("node:fs");',
        'const { syncBuiltinESMExports } = require("node:module");',
        "const originalStatSync = fs.statSync;",
        "let virtualNow = 0;",
        "Date.now = () => virtualNow;",
        "fs.statSync = function patchedStatSync(...args) {",
        "  const result = originalStatSync.apply(this, args);",
        "  virtualNow += 10;",
        "  return result;",
        "};",
        "syncBuiltinESMExports();",
        "",
      ].join("\n"),
    );
    const result = await runCollectorSafety([], {
      ...fixture.env,
      APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
      APPLIED_LOOP_COLLECT_RUN_BUDGET_MS: "5",
      NODE_OPTIONS: `--require=${preloadPath}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deferredForBudget=true/);
    const status = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
    assert.equal(status.runState, "pending");
    assert.equal(status.pendingCount, null);
    assert.equal(status.pendingCountExact, false);
    assert.equal(status.lastSuccessfulSyncAt, null);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T6b3 propagates unreadable Claude and Codex directories to safe status", async (t) => {
  const cases = [
    {
      name: "Claude project root",
      target: (home: string) => join(home, ".claude", "projects"),
    },
    {
      name: "Claude project directory",
      target: (home: string) => join(home, ".claude", "projects", "-tmp-unreadable"),
    },
    {
      name: "Codex session root",
      target: (home: string) => join(home, ".codex", "sessions"),
    },
    {
      name: "Codex session subdirectory",
      target: (home: string) => join(home, ".codex", "sessions", "2026", "08", "28"),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = createCollectorSafetyFixture();
      try {
        const targetPath = scenario.target(fixture.home);
        mkdirSync(targetPath, { recursive: true });
        const preloadPath = join(fixture.home, "deny-readdir.cjs");
        writeFileSync(
          preloadPath,
          [
            'const fs = require("node:fs");',
            'const { syncBuiltinESMExports } = require("node:module");',
            "const originalReaddirSync = fs.readdirSync;",
            "fs.readdirSync = function patchedReaddirSync(target, ...args) {",
            "  if (String(target) === process.env.INJECT_READDIR_PATH) {",
            '    const error = new Error("injected unreadable directory");',
            '    error.code = "EACCES";',
            "    throw error;",
            "  }",
            "  return originalReaddirSync.call(this, target, ...args);",
            "};",
            "syncBuiltinESMExports();",
            "",
          ].join("\n"),
        );

        await withCollectorSafetyServer(async (url, received) => {
          const baseline = await runCollectorSafety([], {
            ...fixture.env,
            APPLIED_LOOP_URL: url,
            APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
          });
          assert.equal(baseline.status, 0, baseline.stderr);
          const before = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
          assert.equal(typeof before.lastSuccessfulSyncAt, "string");

          const injectedEnv = {
            ...fixture.env,
            APPLIED_LOOP_URL: url,
            APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
            INJECT_READDIR_PATH: targetPath,
            NODE_OPTIONS: `--require=${preloadPath}`,
          };
          const incomplete = await runCollectorSafety([], injectedEnv);
          assert.equal(incomplete.status, 0, incomplete.stderr);
          const after = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
          assert.equal(after.runState, "pending");
          assert.equal(after.pendingCount, null);
          assert.equal(after.pendingCountExact, false);
          assert.equal(after.unreadableCount, null);
          assert.equal(after.lastSuccessfulSyncAt, before.lastSuccessfulSyncAt);
          assert.equal(received.length, 2, "an incomplete rescan must not duplicate unchanged sessions");

          const diagnostic = await runCollectorSafety(["--status", "--json"], injectedEnv);
          assert.equal(diagnostic.status, 0, diagnostic.stderr);
          const report = JSON.parse(diagnostic.stdout) as Record<string, unknown>;
          assert.equal(report.runState, "pending");
          assert.equal(report.pendingCount, null);
          assert.equal(report.pendingCountExact, false);
        });
      } finally {
        rmSync(fixture.home, { recursive: true, force: true });
      }
    });
  }
});

test("AUTO-COLLECT-T6c fairly alternates oldest/newest pending candidates without wall-clock time", () => {
  const candidates = ["a", "b", "c", "d"].map((name) => ({
    path: `${name}.jsonl`,
    harness: "codex",
    fallbackRepo: null,
  }));
  const mtimes: Record<string, number> = {
    "a.jsonl": 1,
    "b.jsonl": 2,
    "c.jsonl": 3,
    "d.jsonl": 4,
  };
  const scheduled = sortCandidatesForScheduledRun(candidates, { files: {} }, {
    readFingerprint: (path: string) => ({ size: 1, mtimeMs: mtimes[path] }),
  });
  assert.equal(scheduled.complete, true);
  assert.deepEqual(
    scheduled.candidates.map((candidate: { path: string }) => candidate.path),
    ["a.jsonl", "d.jsonl", "b.jsonl", "c.jsonl"],
  );
});

test("AUTO-COLLECT-T6d sends no retry POST after SIGTERM arrives during backoff", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    await withCollectorSafetyServer(async (url, received) => {
      const child = spawn(process.execPath, [collectorSafetyScript], {
        cwd: process.cwd(),
        env: {
          ...fixture.env,
          APPLIED_LOOP_URL: url,
          APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
          APPLIED_LOOP_COLLECT_RETRY_MAX_ATTEMPTS: "3",
          APPLIED_LOOP_COLLECT_RETRY_BASE_DELAY_MS: "1000",
          APPLIED_LOOP_COLLECT_RETRY_MAX_DELAY_MS: "1000",
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      for (let attempt = 0; received.length === 0 && attempt < 200; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      }
      assert.equal(received.length, 1, stderr);
      child.kill("SIGTERM");
      const status = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(status, 130, `${stdout}\n${stderr}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      assert.equal(received.length, 1, "signal during backoff must prevent another POST");
    }, [503]);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T6d2 persists interruption when SIGTERM arrives during the final pending scan", async () => {
  const fixture = createCollectorSafetyFixture();
  try {
    await withCollectorSafetyServer(async (url) => {
      const env = {
        ...fixture.env,
        APPLIED_LOOP_URL: url,
        APPLIED_LOOP_COLLECT_RUN_MODE: "scheduled",
      };
      const baseline = await runCollectorSafety([], env);
      assert.equal(baseline.status, 0, baseline.stderr);
      const before = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
      assert.equal(typeof before.lastSuccessfulSyncAt, "string");

      const markerPath = join(fixture.home, "final-scan.marker");
      const preloadPath = join(fixture.home, "pause-final-scan.cjs");
      writeFileSync(
        preloadPath,
        [
          'const fs = require("node:fs");',
          'const { syncBuiltinESMExports } = require("node:module");',
          "const originalStatSync = fs.statSync;",
          "const originalReadFileSync = fs.readFileSync;",
          "const originalWriteFileSync = fs.writeFileSync;",
          "let runningSessionStats = 0;",
          "fs.statSync = function patchedStatSync(target, ...args) {",
          "  const result = originalStatSync.call(this, target, ...args);",
          '  if (String(target).endsWith(".jsonl")) {',
          "    try {",
          '      const status = JSON.parse(originalReadFileSync(process.env.APPLIED_LOOP_COLLECT_STATUS_PATH, "utf8"));',
          '      if (status.runState === "running") {',
          "        runningSessionStats += 1;",
          "        if (runningSessionStats === 3) {",
          '          originalWriteFileSync(process.env.FINAL_SCAN_MARKER, "final-scan\\n");',
          "          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);",
          "        }",
          "      }",
          "    } catch {}",
          "  }",
          "  return result;",
          "};",
          "syncBuiltinESMExports();",
          "",
        ].join("\n"),
      );

      const child = spawn(process.execPath, [collectorSafetyScript], {
        cwd: process.cwd(),
        env: {
          ...env,
          FINAL_SCAN_MARKER: markerPath,
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      for (let attempt = 0; !existsSync(markerPath) && attempt < 200; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      }
      assert.equal(existsSync(markerPath), true, stderr);
      child.kill("SIGTERM");
      const exitStatus = await new Promise<number | null>((resolveClose, reject) => {
        child.once("error", reject);
        child.once("close", resolveClose);
      });
      assert.equal(exitStatus, 130, `${stdout}\n${stderr}`);

      const after = JSON.parse(readFileSync(fixture.statusPath, "utf8")) as Record<string, unknown>;
      assert.equal(after.runState, "error");
      assert.equal(after.pendingCount, null);
      assert.equal(after.pendingCountExact, false);
      assert.equal(after.lastError, "collector_interrupted");
      assert.equal(after.lastSuccessfulSyncAt, before.lastSuccessfulSyncAt);
    });
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("AUTO-COLLECT-T6e starts no retry POST after an injected budget expires", async () => {
  let now = 0;
  let attempts = 0;
  let posts = 0;
  await assert.rejects(
    postRunWithRetry({}, {
      dryRun: false,
      maxAttempts: 3,
      onAttempt: () => { attempts += 1; },
      shouldStop: () => false,
      shouldDefer: () => now >= 10,
      postOnce: async (_body: unknown, options: { onAttempt?: () => void }) => {
        options.onAttempt?.();
        posts += 1;
        now = 10;
        throw Object.assign(new Error("retryable"), { retryable: true });
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CollectorRunStoppedError" &&
      "reason" in error &&
      error.reason === "budget_deferred",
  );
  assert.equal(attempts, 1);
  assert.equal(posts, 1);
});

test("AUTO-COLLECT-T7 wires interactive macOS setup to idempotent install with safe skip controls", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "bootstrap-local.mjs"), "utf8");
  assert.match(source, /APPLIED_LOOP_SKIP_HARNESS_COLLECTOR/);
  assert.match(source, /APPLIED_LOOP_INSTALL_HARNESS_COLLECTOR/);
  assert.match(source, /process\.platform !== "darwin"/);
  assert.match(source, /process\.env\.CI/);
  assert.match(source, /process\.stdin\.isTTY/);
  assert.match(source, /node scripts\/manage-harness-collector\.mjs install/);
});

test("A5-CG2-T4 persists server-derived evidence through the real authenticated route on a disposable DB", () => {
  type FixtureDatabase = {
    prepare(sql: string): { get(...values: unknown[]): unknown };
    close(): void;
  };
  type FixtureDatabaseConstructor = new (path: string) => FixtureDatabase;
  const fixtureDir = mkdtempSync(join(tmpdir(), "harness-a5-route-"));
  const fixturePath = join(fixtureDir, "route.db");
  const token = "a5-route-test-token";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${fixturePath}`,
    MCP_TOKEN: token,
  };
  const childSource = [
    'import { POST } from "./src/app/api/harness-runs/route";',
    'const run = async () => {',
    `  const token = ${JSON.stringify(token)};`,
    `  const payload = ${JSON.stringify(payload())};`,
    '  const response = await POST(new Request("http://localhost/api/harness-runs", {',
    '  method: "POST",',
    '  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },',
    '  body: JSON.stringify(payload),',
    '  }));',
    '  console.log(JSON.stringify({ status: response.status, body: await response.json() }));',
    '  const forged = await POST(new Request("http://localhost/api/harness-runs", {',
    '  method: "POST",',
    '  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },',
    '  body: JSON.stringify({ ...payload, inputTotalTokens: 1 }),',
    '  }));',
    '  console.log(JSON.stringify({ forgedStatus: forged.status }));',
    '};',
    'void run().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join("\n");

  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const route = spawnSync("npx", ["tsx", "-e", childSource], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(route.status, 0, route.stderr);
    assert.equal(route.stderr, "");
    const [accepted, forged] = route.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ok, true);
    assert.equal(typeof accepted.body.id, "string");
    assert.equal(forged.forgedStatus, 400);

    const adapterRequire = createRequire(
      createRequire(import.meta.url).resolve("@prisma/adapter-better-sqlite3"),
    );
    const Database = adapterRequire("better-sqlite3") as FixtureDatabaseConstructor;
    const fixture = new Database(fixturePath);
    try {
      const row = fixture.prepare(
        "SELECT tokensIn, cacheRead, cacheCreate, inputTotalTokens, inputUncachedTokens, cacheReadTokens, cacheWriteTokens, usageSemanticsVersion, usageNormalizationStatus, usageNormalizationReason, collectorVersion, contextFingerprint FROM HarnessRun",
      ).get() as Record<string, unknown>;
      assert.deepEqual(row, {
        tokensIn: 100,
        cacheRead: 80,
        cacheCreate: 0,
        inputTotalTokens: 100,
        inputUncachedTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        usageSemanticsVersion: "harness-usage-v1",
        usageNormalizationStatus: "supported",
        usageNormalizationReason: null,
        collectorVersion: "harness-collector-v3",
        contextFingerprint: fingerprint,
      });
    } finally {
      fixture.close();
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("BUGFIX-CG2 reports local HarnessRun schema drift as an actionable 503", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "harness-schema-drift-"));
  const fixturePath = join(fixtureDir, "route.db");
  const token = "schema-drift-token";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${fixturePath}`,
    MCP_TOKEN: token,
  };
  const childSource = [
    'import { POST } from "./src/app/api/harness-runs/route";',
    'const body = { harness: "codex", sessionId: "schema-drift", tokensIn: 1, tokensOut: 0, cacheRead: 0, cacheCreate: 0, thinking: 0, turns: 1, startedAt: "2026-08-28T00:00:00.000Z" };',
    `POST(new Request("http://localhost/api/harness-runs", { method: "POST", headers: { authorization: "Bearer ${token}", "content-type": "application/json" }, body: JSON.stringify(body) }))`,
    '  .then(async (response) => console.log(JSON.stringify({ status: response.status, body: await response.json() })))',
    '  .catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join("\n");

  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const adapterRequire = createRequire(
      createRequire(import.meta.url).resolve("@prisma/adapter-better-sqlite3"),
    );
    const Database = adapterRequire("better-sqlite3") as new (path: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const fixture = new Database(fixturePath);
    fixture.exec('ALTER TABLE "HarnessRun" DROP COLUMN "inputTotalTokens"');
    fixture.close();

    const route = spawnSync("npx", ["tsx", "-e", childSource], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(route.status, 0, route.stderr);
    const response = JSON.parse(route.stdout.trim()) as {
      status: number;
      body: { error: string; code: string; remediation: string };
    };
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: "database schema is out of date",
      code: "SCHEMA_OUT_OF_DATE",
      remediation: "Run npm run setup (or npx prisma migrate deploy), then restart the dev server.",
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
