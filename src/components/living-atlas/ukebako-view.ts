/**
 * うけばこ（受付所）の見せ方だけを決める純関数。
 *
 * 「何が溜まって、何をしなければいけないか」を一目にするため、ふみ（Capture）は
 * 日付ではなく **たいりゅう日数** で 3 段に割る。DB に期限カラムは無いので、
 * capturedAt からの経過日数だけで決める（勝手に消える仕様は作らない）。
 */

/** これを越えた ふみは「ふるびた」。先に開けるべきもの */
export const FUMI_STALE_DAYS = 14;
/** これを越えたら「そろそろ」。静かに黄色く光る */
export const FUMI_WARN_DAYS = 7;

export type FumiTier = "stale" | "warn" | "fresh";

export function daysSince(at: Date | undefined, now: Date): number {
  if (!at) return 0;
  const ms = now.getTime() - at.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export function fumiTier(days: number): FumiTier {
  if (days >= FUMI_STALE_DAYS) return "stale";
  if (days >= FUMI_WARN_DAYS) return "warn";
  return "fresh";
}

export const FUMI_GROUP_LABEL: Record<FumiTier, string> = {
  stale: "ふるびた ふみ",
  warn: "そろそろ ひらく ふみ",
  fresh: "あたらしい ふみ",
};

/** 経過の言い方。1日未満は じかん で出す（きょう届いた実感を消さない） */
export function ageLabel(at: Date | undefined, now: Date): string {
  if (!at) return "いつのものか わからぬ";
  const ms = Math.max(0, now.getTime() - at.getTime());
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "たった いま";
  if (hours < 24) return `${hours}じかん まえ`;
  return `${Math.floor(hours / 24)}にち まえ`;
}

/** 重要度 0-100 → 5 段のドット */
export function importancePips(score: number | null | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(5, Math.round(score / 20)));
}

/** 使用回数 → 5 段の「なじみ」 */
export function wearPips(usedCount: number | undefined): number {
  if (!usedCount) return 0;
  return Math.max(0, Math.min(5, usedCount >= 7 ? 5 : usedCount));
}

/** 捕捉元 → ふだの色 */
export function fromClass(source: string | undefined): string {
  const s = (source ?? "").toLowerCase();
  if (s.includes("codex")) return "uke-from--codex";
  if (s.includes("cursor")) return "uke-from--cursor";
  return "";
}

/** しれんの日数ゲージ。start〜end を 1 日 1 マスにする */
export function trialPips(
  start: Date,
  end: Date,
  now: Date,
): { total: number; passed: number; today: number } {
  const day = 86400000;
  const total = Math.max(
    1,
    Math.min(60, Math.round((end.getTime() - start.getTime()) / day)),
  );
  const elapsed = Math.floor((now.getTime() - start.getTime()) / day);
  const today = Math.max(0, Math.min(total - 1, elapsed));
  return { total, passed: today, today };
}

export function restDays(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

export function mmdd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** けいやく中の しれん（Experiment）。うけばこ下段で日数ゲージにする */
export type UkebakoTrial = {
  id: string;
  action: string;
  successMetric: string;
  status: string;
  startDate: Date;
  endDate: Date;
  entryId: string;
  entryTitle: string;
  checkInCount: number;
};

/** つかった きろく（Application） */
export type UkebakoLogItem = {
  id: string;
  appliedTo: string;
  note: string;
  decisionChanged: string | null;
  createdAt: Date;
  entryId: string;
  entryTitle: string;
};

/** うけばこ下段（しれん / つかった きろく / 台帳の数） */
export type UkebakoBoard = {
  trials: UkebakoTrial[];
  log: UkebakoLogItem[];
  stats: {
    /** 未仕分けの ふみ */
    pending: number;
    /** ちりに かえった ふみ（status=expired） */
    expired: number;
    /** くらに おさまった まなび */
    entryTotal: number;
    /** 一度も つかわれておらぬ まなび */
    sleeping: number;
    /** つかった きろく */
    applicationTotal: number;
    /** はしっている しれん */
    trialActive: number;
  };
};

/**
 * ふみ 1 通の見せ方。
 * 経過日数はサーバ側の `now` で確定させてからクライアントへ渡す
 * （クライアントで再計算すると hydration がずれる）。
 */
export type FumiView = {
  id: string;
  title: string;
  /** 捕捉元（claude-code / codex-cli / cursor …） */
  source: string;
  fromClass: string;
  place: string;
  note: string | null;
  triageReason: string | null;
  ageText: string;
  days: number;
  tier: FumiTier;
  pips: number;
};

export function toFumiView(
  item: {
    id: string;
    title: string;
    source?: string;
    placeLabel?: string;
    note?: string | null;
    triageReason?: string | null;
    importance?: number | null;
    at?: Date;
  },
  now: Date,
): FumiView {
  const days = daysSince(item.at, now);
  return {
    id: item.id,
    title: item.title,
    source: item.source ?? "inbox",
    fromClass: fromClass(item.source),
    place: item.placeLabel ?? "受信箱",
    note: item.note ?? null,
    triageReason: item.triageReason ?? null,
    ageText: ageLabel(item.at, now),
    days,
    tier: fumiTier(days),
    pips: importancePips(item.importance),
  };
}

/** ふるびた → そろそろ → あたらしい の順。同じ段では 古い順（放置が長いほど上） */
export function groupFumi(
  views: FumiView[],
): { tier: FumiTier; label: string; items: FumiView[] }[] {
  const order: FumiTier[] = ["stale", "warn", "fresh"];
  return order
    .map((tier) => ({
      tier,
      label: FUMI_GROUP_LABEL[tier],
      items: views
        .filter((v) => v.tier === tier)
        .sort((a, b) => b.days - a.days),
    }))
    .filter((g) => g.items.length > 0);
}

/** triage_inbox が受けるのは accept / skip の 2 つだけ（MCP の実装に合わせる） */
export type FumiAction = "accept" | "skip";

export const COMMANDS: {
  action: FumiAction;
  key: string;
  desc: string;
  drop?: boolean;
}[] = [
  { action: "accept", key: "さいよう", desc: "くらに おさめる（まなびになる）" },
  { action: "skip", key: "みおくり", desc: "この たねは そだてない", drop: true },
];

export const ACTION_LABEL: Record<FumiAction, string> = {
  accept: "さいよう",
  skip: "みおくり",
};

/**
 * ふみ 1 通ぶんの、じゅもんへ渡す context 文字列（/inbox/[id] の単独完結じゅもん用）。
 * 一覧（AtlasUkebakoFumi）の assistContext と同じ「選んだ結果を復唱して確認を取れ」語彙に揃える。
 */
export function buildInboxTriageContext(
  captureId: string,
  captureTitle: string,
  pick: FumiAction | null,
): string {
  const lines = [`captureId: ${captureId}`, `title: 「${captureTitle}」`, ""];
  if (pick) {
    lines.push(
      "ユーザーが画面で えらんだ しわけ（この通りに triage_inbox を呼べ。実行前に確認を取れ）:",
      `- triage_inbox(captureId: "${captureId}", action: "${pick}") … ${ACTION_LABEL[pick]}`,
    );
  } else {
    lines.push("まだ えらばれておらぬ。中身を確認し、accept / skip を提案せよ。");
  }
  return lines.join("\n");
}
