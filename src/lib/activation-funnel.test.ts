import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVATION_STEPS,
  buildFunnelReport,
  recordActivation,
  readActivationEvents,
  type ActivationEvent,
} from "./activation-funnel";
import { setTelemetryOptIn } from "./telemetry-consent";

describe("activation funnel G8", () => {
  it("tracks exactly 7 canonical steps", () => {
    assert.equal(ACTIVATION_STEPS.length, 7);
    assert.ok(ACTIVATION_STEPS.includes("first_supply"));
    assert.ok(ACTIVATION_STEPS.includes("zukan_viewed"));
    assert.ok(!ACTIVATION_STEPS.includes("hook_installed" as never));
  });

  it("reports missing steps and completed=false", () => {
    const events: ActivationEvent[] = [
      { step: "setup_opened", at: "2026-08-06T00:00:00.000Z" },
      { step: "sample_submitted", at: "2026-08-06T00:05:00.000Z" },
    ];
    const r = buildFunnelReport(events);
    assert.equal(r.completed, false);
    assert.ok(r.missing.includes("mcp_touched"));
    assert.ok(r.missing.includes("zukan_viewed"));
  });

  it("completed when all 7 present", () => {
    const at = "2026-08-06T00:00:00.000Z";
    const events: ActivationEvent[] = ACTIVATION_STEPS.map((step) => ({
      step,
      at,
    }));
    const r = buildFunnelReport(events);
    assert.equal(r.completed, true);
    assert.deepEqual(r.missing, []);
  });
});

describe("opt-in telemetry forwarding (W5-8 #15)", () => {
  const ORIGINAL_HOME = process.env.HOME;
  const ORIGINAL_URL = process.env.TELEMETRY_URL;
  const ORIGINAL_FETCH = global.fetch;
  let tmpDirs: string[] = [];

  function freshHome(): void {
    const dir = mkdtempSync(join(tmpdir(), "applied-loop-funnel-"));
    tmpDirs.push(dir);
    process.env.HOME = dir;
  }

  afterEach(() => {
    if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_URL === undefined) delete process.env.TELEMETRY_URL;
    else process.env.TELEMETRY_URL = ORIGINAL_URL;
    global.fetch = ORIGINAL_FETCH;
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
    tmpDirs = [];
  });

  it("常にローカルJSONLへは記録する（同意の有無に関わらず）", () => {
    freshHome();
    delete process.env.TELEMETRY_URL;
    recordActivation("setup_opened");
    const events = readActivationEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].step, "setup_opened");
  });

  it("TELEMETRY_URL未設定なら同意していてもfetchしない", () => {
    freshHome();
    delete process.env.TELEMETRY_URL;
    setTelemetryOptIn(true);
    let called = false;
    global.fetch = (() => {
      called = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
    recordActivation("setup_opened");
    assert.equal(called, false);
  });

  it("未同意ならTELEMETRY_URLが設定済みでもfetchしない", () => {
    freshHome();
    process.env.TELEMETRY_URL = "https://example.com/collect";
    let called = false;
    global.fetch = (() => {
      called = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
    recordActivation("setup_opened");
    assert.equal(called, false);
  });

  it("同意済み+送信先ありなら正本7点をfetchで転送する（meta抜き）", async () => {
    freshHome();
    process.env.TELEMETRY_URL = "https://example.com/collect";
    setTelemetryOptIn(true);
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    global.fetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
    recordActivation("setup_opened", { gateId: "should-not-be-sent" });
    // fetch は fire-and-forget なので次のマイクロタスクを待つ
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(capturedUrl, "https://example.com/collect");
    const parsed = JSON.parse(capturedBody!);
    assert.equal(parsed.step, "setup_opened");
    assert.ok(parsed.anonId);
    assert.ok(parsed.at);
    assert.equal(parsed.gateId, undefined);
    assert.equal(parsed.meta, undefined);
  });

  it("正本7点でない補助ステップ(hook_installed等)は転送しない", async () => {
    freshHome();
    process.env.TELEMETRY_URL = "https://example.com/collect";
    setTelemetryOptIn(true);
    let called = false;
    global.fetch = (() => {
      called = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
    recordActivation("hook_installed");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(called, false);
  });

  it("fetch失敗はrecordActivation自体を落とさない", () => {
    freshHome();
    process.env.TELEMETRY_URL = "https://example.com/collect";
    setTelemetryOptIn(true);
    global.fetch = (() =>
      Promise.reject(new Error("network down"))) as typeof fetch;
    assert.doesNotThrow(() => recordActivation("setup_opened"));
  });
});
