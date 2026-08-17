/**
 * opt-in 匿名テレメトリの同意状態（W5-8 #15）。
 * 既定オフ。同意しない限り、activation イベントはローカル
 * (~/.applied-loop/activation-events.jsonl) にしか残らない（従来どおり）。
 * ADR-0009 のプライバシー不変条件を継承: 送るのは正本7点の
 * イベント名・匿名ID・タイムスタンプのみで、会話本文や repo 名は含めない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type TelemetryConsentState = {
  optedIn: boolean;
  optedInAt: string | null;
  anonId: string;
};

function defaultState(): TelemetryConsentState {
  return { optedIn: false, optedInAt: null, anonId: randomUUID() };
}

/** テストで HOME を差し替えられるよう、都度 homedir() を読む（固定しない） */
export function telemetryConsentPath(): string {
  return join(homedir(), ".applied-loop", "telemetry-opt-in.json");
}

function writeState(state: TelemetryConsentState): void {
  const statePath = telemetryConsentPath();
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

/** anonId は初回読み取り時に確定・永続化する（毎回生成すると同意時の値とズレる） */
export function readTelemetryConsent(): TelemetryConsentState {
  const statePath = telemetryConsentPath();
  try {
    if (!existsSync(statePath)) {
      const fresh = defaultState();
      writeState(fresh);
      return fresh;
    }
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      typeof parsed?.optedIn === "boolean" &&
      typeof parsed?.anonId === "string" &&
      parsed.anonId
    ) {
      return {
        optedIn: parsed.optedIn,
        optedInAt: typeof parsed.optedInAt === "string" ? parsed.optedInAt : null,
        anonId: parsed.anonId,
      };
    }
    return defaultState();
  } catch {
    return defaultState();
  }
}

export function setTelemetryOptIn(optedIn: boolean): TelemetryConsentState {
  const current = readTelemetryConsent();
  const next: TelemetryConsentState = {
    optedIn,
    optedInAt: optedIn ? new Date().toISOString() : null,
    anonId: current.anonId,
  };
  try {
    writeState(next);
  } catch (e) {
    console.error("[telemetry-consent] write failed:", e);
  }
  return next;
}

/** 送信先が設定されているか（未設定なら同意していてもローカル記録のみ） */
export function telemetryDestinationConfigured(): boolean {
  return Boolean(process.env.TELEMETRY_URL?.trim());
}
