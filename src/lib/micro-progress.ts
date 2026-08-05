/**
 * ミニチェック進捗の sessionStorage。
 * リロードしても同じゲートのドリル位置・通した文を復元する。
 */

export type MicroClearedItem = {
  aspect: string;
  paraphrase: string;
  gapNote?: string;
};

export type MicroProgress = {
  gateId: string;
  index: number;
  cleared: MicroClearedItem[];
  microDone: boolean;
};

function key(gateId: string): string {
  return `atlas-micro-v1:${gateId}`;
}

export function loadMicroProgress(gateId: string): MicroProgress | null {
  if (typeof window === "undefined" || !gateId) return null;
  try {
    const raw = sessionStorage.getItem(key(gateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MicroProgress;
    if (parsed.gateId !== gateId || !Array.isArray(parsed.cleared)) return null;
    return {
      gateId,
      index: typeof parsed.index === "number" ? parsed.index : 0,
      cleared: parsed.cleared,
      microDone: !!parsed.microDone,
    };
  } catch {
    return null;
  }
}

export function saveMicroProgress(progress: MicroProgress): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(progress.gateId), JSON.stringify(progress));
  } catch {
    /* quota / private mode */
  }
}

export function clearMicroProgress(gateId: string): void {
  if (typeof window === "undefined" || !gateId) return;
  try {
    sessionStorage.removeItem(key(gateId));
  } catch {
    /* ignore */
  }
}

/** 通した言い直し＋差分メモ → 本回答の下書き */
export function buildAnswerSeedFromMicro(
  cleared: MicroClearedItem[],
  recall?: string | null,
): string {
  const parts = cleared
    .map((c) => {
      const body = c.paraphrase.trim();
      if (!body) return "";
      const gap = c.gapNote?.trim();
      return gap ? `${body}\n（補足: ${gap}）` : body;
    })
    .filter(Boolean);
  const recallText = recall?.trim();
  if (recallText) parts.push(recallText);
  return parts.join("\n\n");
}
