/**
 * Gate由来 Capture の sourceContext を扱う小さなpure boundary。
 * ここでだけ生の文字列を読み、履歴ledgerやprojectionへは通さない。
 */

const ROOT_CAUSES = new Set(["knowledge", "verification", "premise"]);

export type RootCause = "knowledge" | "verification" | "premise";

export function normalizeRootCause(raw: unknown): RootCause | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return ROOT_CAUSES.has(value) ? (value as RootCause) : null;
}

/** Capture.sourceContext 用: gateId と任意の rootCause をエンコード */
export function encodeGateSourceContext(
  gateId: string,
  rootCause?: RootCause | null,
): string {
  return rootCause ? `gateId:${gateId};rootCause:${rootCause}` : `gateId:${gateId}`;
}

/** Capture.sourceContext から gateId / rootCause を取り出す */
export function parseGateSourceContext(raw: string | null | undefined): {
  gateId: string | null;
  rootCause: RootCause | null;
} {
  if (!raw) return { gateId: null, rootCause: null };
  const gateMatch = raw.match(/(?:^|[;|])gateId:([^;|\s]+)/);
  const causeMatch = raw.match(/(?:^|[;|])rootCause:([^;|\s]+)/);
  const gateId = gateMatch?.[1]?.trim() || null;
  // 旧形式: "gateId:xxx" のみ (セミコロンなし)
  const legacyGateId = !gateId && raw.startsWith("gateId:")
    ? raw.slice("gateId:".length).split(/[;\s]/)[0]?.trim() || null
    : null;
  return {
    gateId: gateId ?? legacyGateId,
    rootCause: normalizeRootCause(causeMatch?.[1] ?? null),
  };
}
