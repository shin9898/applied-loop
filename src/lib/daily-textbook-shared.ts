/**
 * 日次教科書の純関数・型 (クライアント可)。DB は daily-textbook.ts。
 *
 * 品質不変条件（回帰テストで固定）:
 * - 章が2つ以上あるとき、title / oneLiner / bodyPlain / diagramBad は互いに異なる
 * - UI は diagramKind 共通文面に頼らず、章固有の diagramBad/Ok を出す
 * - 生成経路は generateDailyTextbook → clusterMaterialsIntoChapters の一本化
 */

export const TEXTBOOK_MAX_CHAPTERS = 5;
export const TEXTBOOK_MAX_MATERIALS_PER_CHAPTER = 8;
export const TEXTBOOK_MAX_EVIDENCE_URLS = 5;
/** じゅもん注入の文字数上限（章本文・diff 全量は入れない） */
export const JUMON_CONTEXT_MAX_CHARS = 900;

export const MASTERY_STATES = ["clear", "partial", "stuck", "parked"] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export type EvidenceLink = {
  kind: "commit" | "doc" | "file" | "other";
  label: string;
  url?: string;
  ref?: string;
};

export type MaterialRow = {
  id: string;
  kind: string;
  repo: string;
  ref: string;
  summary: string | null;
  skipReason: string | null;
  receivedAt: Date;
};

export type ChapterDraft = {
  index: number;
  title: string;
  oneLiner: string;
  bodyPlain: string;
  bodyDeep: string;
  diagramKind: "silent_gap" | "drift" | "prefix" | "generic";
  /** 章固有の BAD/OK（テンプレ固定にしない） */
  diagramBad: string;
  diagramOk: string;
  evidence: EvidenceLink[];
  materialIds: string[];
};

export type CheckDraft = {
  index: number;
  chapterIndex: number | null;
  question: string;
};

export type TextbookGenerateResult = {
  dateKey: string;
  textbookId: string;
  materialCount: number;
  chapterCount: number;
  checkCount: number;
  droppedMaterialIds: string[];
  peakHour: number | null;
};

export type TextbookView = {
  id: string;
  dateKey: string;
  title: string;
  lead: string | null;
  materialCount: number;
  chapterCount: number;
  peakHour: number | null;
  droppedMaterialIds: string[];
  chapters: Array<{
    id: string;
    index: number;
    title: string;
    oneLiner: string;
    bodyPlain: string;
    bodyDeep: string | null;
    diagramKind: string;
    diagramBad: string;
    diagramOk: string;
    evidence: EvidenceLink[];
    materialIds: string[];
  }>;
  checks: Array<{
    id: string;
    index: number;
    chapterId: string | null;
    question: string;
    mastery: MasteryState | null;
    answeredAt: string | null;
  }>;
};

export function isMasteryState(v: string): v is MasteryState {
  return (MASTERY_STATES as readonly string[]).includes(v);
}

/** dateKey ("2026-08-10") の JST 日レンジ [start, end)。 */
export function dayRangeFromDateKey(dateKey: string): {
  start: Date;
  end: Date;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`invalid dateKey: ${dateKey}`);
  }
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

function repoShort(repo: string): string {
  const parts = repo.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || repo;
}

function hourJST(d: Date): number {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

export function peakHourFromMaterials(materials: MaterialRow[]): number | null {
  if (materials.length === 0) return null;
  const counts = new Array<number>(24).fill(0);
  for (const m of materials) counts[hourJST(m.receivedAt)] += 1;
  let best = 0;
  for (let h = 1; h < 24; h++) if (counts[h] > counts[best]) best = h;
  return best;
}

function isMergeSummary(summary: string): boolean {
  return /^merge\b/i.test(summary.trim());
}

/** conventional commit や件名から、章の主題語を拾う */
export function extractThemes(summaries: string[]): string[] {
  const scores = new Map<string, number>();
  const bump = (key: string, n = 1) => {
    const k = key.trim();
    if (k.length < 2 || k.length > 40) return;
    scores.set(k, (scores.get(k) ?? 0) + n);
  };

  for (const raw of summaries) {
    const s = raw.trim();
    if (!s || isMergeSummary(s)) continue;
    const conv = s.match(
      /^(feat|fix|chore|test|refactor|docs|ci|perf|build)(?:\(([^)]+)\))?:/i,
    );
    if (conv) {
      const type = conv[1].toLowerCase();
      const scope = conv[2]?.trim();
      if (scope) bump(scope, 3);
      bump(type, 1);
      const rest = s.slice(conv[0].length).trim();
      if (rest) bump(rest.split(/[:：]/)[0]!.slice(0, 28), 2);
      continue;
    }
    const issue = s.match(/issue[_-]?(\d+)/i) || s.match(/#(\d+)/);
    if (issue) bump(`#${issue[1]}`, 2);
    // 先頭の意味塊
    bump(s.replace(/^[^:]+:\s*/, "").slice(0, 32), 1);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, 4);
}

function uniqueSummaries(materials: MaterialRow[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const ranked = [...materials].sort((a, b) => {
    const am = isMergeSummary(a.summary ?? "") ? 1 : 0;
    const bm = isMergeSummary(b.summary ?? "") ? 1 : 0;
    if (am !== bm) return am - bm;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });
  for (const m of ranked) {
    const s = m.summary?.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function diagramFor(
  materials: MaterialRow[],
  themes: string[],
): ChapterDraft["diagramKind"] {
  const text = [...themes, ...materials.map((m) => m.summary ?? "")].join(" ");
  // 「npm cache」等の一般語は除外。prompt-cache / prefix 系だけ prefix 扱い
  if (/\bprompt[-_\s]?cache\b|\bprefix[_-]?(?:cache|form)?\b|\bharness\b/i.test(text)) {
    return "prefix";
  }
  if (/datadog|observab|monitor|otel|tracing/i.test(text)) return "drift";
  const hasBacklog = materials.some((m) => m.skipReason === "backlog");
  if (hasBacklog) return "silent_gap";
  const kinds = new Set(materials.map((m) => m.kind));
  if (kinds.size > 1) return "drift";
  return "generic";
}

function diagramCopy(
  title: string,
  theme: string,
  kind: ChapterDraft["diagramKind"],
): { bad: string; ok: string } {
  const focus = theme || title;
  switch (kind) {
    case "prefix":
      return {
        bad: `「${focus}」を感覚で直し、プレフィックス／キャッシュの前提を言葉に残さない`,
        ok: `「${focus}」の一次情報を開き、ヒット条件と無効化範囲を1行で説明する`,
      };
    case "drift":
      return {
        bad: `「${focus}」の変更をメタ情報だけで見たつもりになり、本番影響の境界を曖昧にする`,
        ok: `「${focus}」で何が本番に届き何が届かないかを、根拠コミット付きで言い切る`,
      };
    case "silent_gap":
      return {
        bad: `「${focus}」の差分を積んだまま振り返らず、明日また同じ説明詰まりをする`,
        ok: `「${focus}」を今夜この章で一度言語化し、確認で Mastery を付ける`,
      };
    default:
      return {
        bad: `「${focus}」を流し見して次の実装へ行き、説明できないままにする`,
        ok: `「${focus}」の代表コミットを1つ開き、自分の言葉で目的を書く`,
      };
  }
}

function evidenceFrom(materials: MaterialRow[]): EvidenceLink[] {
  const out: EvidenceLink[] = [];
  const ranked = [...materials].sort((a, b) => {
    const am = isMergeSummary(a.summary ?? "") ? 1 : 0;
    const bm = isMergeSummary(b.summary ?? "") ? 1 : 0;
    if (am !== bm) return am - bm;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });
  for (const m of ranked) {
    if (out.length >= TEXTBOOK_MAX_EVIDENCE_URLS) break;
    const short = m.ref.length > 12 ? `${m.ref.slice(0, 7)}…` : m.ref;
    const tip = m.summary?.trim().slice(0, 36);
    out.push({
      kind: m.kind === "commit" ? "commit" : "other",
      label: tip ? `${tip} (${short})` : `${repoShort(m.repo)} ${short}`,
      ref: m.ref,
    });
  }
  return out;
}

function draftChapterFromRepo(
  index: number,
  repo: string,
  kept: MaterialRow[],
  overflow: MaterialRow[],
): ChapterDraft {
  const name = repoShort(repo);
  const summaries = uniqueSummaries(kept, 5);
  const themes = extractThemes(summaries);
  const theme = themes[0] ?? summaries[0]?.slice(0, 28) ?? name;
  const title =
    themes.length > 0
      ? `${theme}${themes[1] ? ` / ${themes[1]}` : ""}`
      : `${name} の実装`;
  const backlogN = kept.filter((m) => m.skipReason === "backlog").length;
  const oneLiner = summaries[0]
    ? `核: ${summaries[0].slice(0, 72)}${summaries[1] ? ` ／ ついでに ${summaries[1].slice(0, 40)}` : ""}`
    : `${name} に ${kept.length} 件の足跡。`;

  const bullets = summaries.map((s) => `・${s}`).join("\n");
  const takeaway =
    themes.length > 0
      ? `覚える一手: 「${theme}」を、なぜ今日触ったか・何が変わったかで1文にする。`
      : `覚える一手: 代表コミットを1つ開き、目的を自分の言葉で1文にする。`;

  const bodyPlain = [
    `場所: ${name}（材料 ${kept.length} 件）`,
    "",
    "今日やったこと:",
    bullets || `・（要約なし）refs: ${kept.map((m) => m.ref.slice(0, 7)).join(", ")}`,
    "",
    takeaway,
    backlogN > 0
      ? `※ うち ${backlogN} 件は即時しれんを止めたが、材料としては残っている。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const kind = diagramFor(kept, themes);
  const { bad, ok } = diagramCopy(title, theme, kind);

  const bodyDeep = [
    bodyPlain,
    "",
    themes.length ? `主題タグ: ${themes.join(", ")}` : "",
    `skipReason: ${summarizeSkip(kept)}`,
    overflow.length
      ? `章予算超えで畳んだ材料: ${overflow.length} 件`
      : "",
    `材料 ID: ${kept.map((m) => m.id.slice(0, 8)).join(", ")}`,
    "",
    `[[BAD]]${bad}`,
    `[[OK]]${ok}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    index,
    title,
    oneLiner,
    bodyPlain,
    bodyDeep,
    diagramKind: kind,
    diagramBad: bad,
    diagramOk: ok,
    evidence: evidenceFrom(kept),
    materialIds: kept.map((m) => m.id),
  };
}

/** 章コピーがテンプレ崩れしていないか（2章以上で互いに違うこと） */
export function chaptersHaveDistinctCopy(chapters: ChapterDraft[]): boolean {
  if (chapters.length <= 1) return true;
  const size = chapters.length;
  return (
    new Set(chapters.map((c) => c.title)).size === size &&
    new Set(chapters.map((c) => c.oneLiner)).size === size &&
    new Set(chapters.map((c) => c.bodyPlain)).size === size &&
    new Set(chapters.map((c) => c.diagramBad)).size === size
  );
}

/** 万一衝突したら index で強制的に差別化（生成の最終安全網） */
export function ensureChapterCopyDiversity(
  chapters: ChapterDraft[],
): ChapterDraft[] {
  if (chaptersHaveDistinctCopy(chapters)) return chapters;
  const seenTitle = new Set<string>();
  const seenOne = new Set<string>();
  const seenBody = new Set<string>();
  const seenBad = new Set<string>();
  return chapters.map((ch) => {
    let title = ch.title;
    let oneLiner = ch.oneLiner;
    let bodyPlain = ch.bodyPlain;
    let diagramBad = ch.diagramBad;
    let diagramOk = ch.diagramOk;
    if (seenTitle.has(title)) title = `${title} · ${ch.index}`;
    if (seenOne.has(oneLiner)) oneLiner = `${oneLiner}（章${ch.index}）`;
    if (seenBody.has(bodyPlain)) {
      bodyPlain = `${bodyPlain}\n（章${ch.index}・差別化）`;
    }
    if (seenBad.has(diagramBad)) {
      diagramBad = `${diagramBad}（章${ch.index}）`;
      diagramOk = `${diagramOk}（章${ch.index}）`;
    }
    seenTitle.add(title);
    seenOne.add(oneLiner);
    seenBody.add(bodyPlain);
    seenBad.add(diagramBad);
    return { ...ch, title, oneLiner, bodyPlain, diagramBad, diagramOk };
  });
}

/** 実務レイヤ表示用。BAD/OK マーカー行は落とす */
export function bodyForDisplay(body: string): string {
  return body
    .replace(/^\[\[BAD\]\].*$/gm, "")
    .replace(/^\[\[OK\]\].*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 材料を repo 単位で章に圧縮。超過は dropped に残す（捨てない＝証跡）。
 */
export function clusterMaterialsIntoChapters(
  materials: MaterialRow[],
): { chapters: ChapterDraft[]; droppedMaterialIds: string[] } {
  const byRepo = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    const list = byRepo.get(m.repo) ?? [];
    list.push(m);
    byRepo.set(m.repo, list);
  }

  const repos = [...byRepo.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const chapters: ChapterDraft[] = [];
  const droppedMaterialIds: string[] = [];

  for (const [repo, rows] of repos) {
    if (chapters.length >= TEXTBOOK_MAX_CHAPTERS) {
      droppedMaterialIds.push(...rows.map((r) => r.id));
      continue;
    }
    const sorted = [...rows].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
    const kept = sorted.slice(0, TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
    const overflow = sorted.slice(TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
    droppedMaterialIds.push(...overflow.map((r) => r.id));
    chapters.push(
      draftChapterFromRepo(chapters.length + 1, repo, kept, overflow),
    );
  }

  return {
    chapters: ensureChapterCopyDiversity(chapters),
    droppedMaterialIds,
  };
}

function summarizeSkip(materials: MaterialRow[]): string {
  const counts = new Map<string, number>();
  for (const m of materials) {
    const k = m.skipReason ?? "fired_or_none";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(", ") || "なし";
}

/** bodyDeep に埋め込んだ BAD/OK を取り出す（旧データ互換） */
export function parseDiagramCopy(bodyDeep: string | null): {
  bad: string | null;
  ok: string | null;
} {
  if (!bodyDeep) return { bad: null, ok: null };
  const bad = bodyDeep.match(/\[\[BAD\]\](.+)/)?.[1]?.trim() ?? null;
  const ok = bodyDeep.match(/\[\[OK\]\](.+)/)?.[1]?.trim() ?? null;
  return { bad, ok };
}

/** 章あたり最大1問＋横断1問。合計は 3〜7 に収める。 */
export function distillChecks(chapters: ChapterDraft[]): CheckDraft[] {
  if (chapters.length === 0) return [];
  const checks: CheckDraft[] = [];
  for (const ch of chapters.slice(0, 5)) {
    const tip = ch.oneLiner.replace(/^核:\s*/, "").slice(0, 60);
    checks.push({
      index: checks.length + 1,
      chapterIndex: ch.index,
      question: `「${ch.title}」について同僚に30秒で説明するなら？（ヒント: ${tip}）`,
    });
  }
  if (checks.length < 3 && chapters[0]) {
    checks.push({
      index: checks.length + 1,
      chapterIndex: chapters[0].index,
      question: `「${chapters[0].title}」で、明日もう一度開く一次情報はどれか？理由付きで1つ。`,
    });
  }
  if (chapters.length >= 2) {
    const names = chapters
      .slice(0, 3)
      .map((c) => c.title)
      .join(" / ");
    checks.push({
      index: checks.length + 1,
      chapterIndex: null,
      question: `今日の章（${names}）をまたぎ、いちばん重要な学びを1文で。根拠の章名も添えること。`,
    });
  }
  return checks.slice(0, 7);
}

/**
 * じゅもん注入コンテキスト。開いている1章＋ひとこと＋URL/ref のみ。
 * 日次全量・diff 本文・他章は入れない。
 */
export function buildJumonContext(input: {
  dateKey: string;
  depth: "plain" | "deep";
  chapter: Pick<
    ChapterDraft,
    "index" | "title" | "oneLiner" | "evidence"
  > & { bodyPlain?: string; bodyDeep?: string };
}): string {
  const urls = input.chapter.evidence
    .map((e) => e.url || e.ref || e.label)
    .filter(Boolean)
    .slice(0, TEXTBOOK_MAX_EVIDENCE_URLS);
  const lines = [
    `【きょうのしょ】${input.dateKey} 章${input.chapter.index}: ${input.chapter.title}`,
    `ひとこと: ${input.chapter.oneLiner}`,
    `深さ: ${input.depth === "deep" ? "実務" : "初学者"}`,
    urls.length ? `一次情報:` : null,
    ...urls.map((u) => `- ${u}`),
    "",
    "指示: この章だけを深掘りせよ。日次の他章・diff 全文は持っていない。必要なら検索ツールで足りぬ材料を引け。",
  ].filter((x): x is string => x != null);

  let text = lines.join("\n");
  if (text.length > JUMON_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, JUMON_CONTEXT_MAX_CHARS - 20)}\n…(budget)`;
  }
  return text;
}

