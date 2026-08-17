import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTelemetryConsent,
  setTelemetryOptIn,
  telemetryConsentPath,
  telemetryDestinationConfigured,
} from "./telemetry-consent";

const ORIGINAL_HOME = process.env.HOME;
let tmpDirs: string[] = [];

function freshHome(): void {
  const dir = mkdtempSync(join(tmpdir(), "applied-loop-telemetry-"));
  tmpDirs.push(dir);
  process.env.HOME = dir;
}

afterEach(() => {
  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

test("readTelemetryConsent: 未初期化なら既定でoptedIn=false・anonId生成し永続化する", () => {
  freshHome();
  const consent = readTelemetryConsent();
  assert.equal(consent.optedIn, false);
  assert.equal(consent.optedInAt, null);
  assert.ok(consent.anonId);
  // anonId が読むたびにズレないよう、初回読み取りで永続化される
  assert.ok(existsSync(telemetryConsentPath()));
  assert.equal(readTelemetryConsent().anonId, consent.anonId);
});

test("setTelemetryOptIn: 同意すると永続化され、anonIdは維持される", () => {
  freshHome();
  const before = readTelemetryConsent();
  const after = setTelemetryOptIn(true);
  assert.equal(after.optedIn, true);
  assert.ok(after.optedInAt);
  assert.equal(after.anonId, before.anonId);

  const reread = readTelemetryConsent();
  assert.equal(reread.optedIn, true);
  assert.equal(reread.anonId, before.anonId);
});

test("setTelemetryOptIn: 取り消すとoptedInAtがnullに戻る", () => {
  freshHome();
  setTelemetryOptIn(true);
  const revoked = setTelemetryOptIn(false);
  assert.equal(revoked.optedIn, false);
  assert.equal(revoked.optedInAt, null);
  assert.equal(readTelemetryConsent().optedIn, false);
});

test("telemetryDestinationConfigured: TELEMETRY_URL の有無で切り替わる", () => {
  const original = process.env.TELEMETRY_URL;
  delete process.env.TELEMETRY_URL;
  assert.equal(telemetryDestinationConfigured(), false);
  process.env.TELEMETRY_URL = "https://example.com/collect";
  assert.equal(telemetryDestinationConfigured(), true);
  process.env.TELEMETRY_URL = "   ";
  assert.equal(telemetryDestinationConfigured(), false);
  if (original === undefined) delete process.env.TELEMETRY_URL;
  else process.env.TELEMETRY_URL = original;
});
