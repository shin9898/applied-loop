/**
 * 日次教科書の純関数・型 (クライアント可)。DB は daily-textbook.ts。
 *
 * 品質不変条件（回帰テストで固定）:
 * - 章が2つ以上あるとき、title / oneLiner / bodyPlain / diagramBad / work / why / practice は互いに異なる
 * - 全章に LessonSlots（work/timing/action/why/practice/consequence/alternative）と BAD/OK が非空
 * - 物語順: 改修 → タイミング → 対応 → 理由 → 一般化（型／結果／別案）
 * - UI は diagramKind 共通文面に頼らず、章固有の diagramBad/Ok・スロットを出す
 * - 生成経路は generateDailyTextbook → clusterMaterialsIntoChapters の一本化（新規＝再生成）
 */

export const TEXTBOOK_MAX_CHAPTERS = 5;
export const TEXTBOOK_MAX_MATERIALS_PER_CHAPTER = 8;
export const TEXTBOOK_MAX_EVIDENCE_URLS = 5;

/**
 * 編纂（source="compiled"）の章・チェックに使う index 専用レンジの起点。
 *
 * 自動生成分は章が 1..TEXTBOOK_MAX_CHAPTERS(5)、チェックが 1..7（distillChecks の
 * slice(0,7)）に必ず収まる。再生成は source="auto" の行だけを作り直すため、
 * 「編纂した後にあふれ repo が増えて自動章が伸びた」順序だと、編纂章が占めていた
 * index と衝突して @@unique([textbookId, index]) で createMany が落ちていた
 * （その日の自動章が消えたまま復旧不能になる）。
 * 編纂側を 1000 以上に固定で隔離すれば、自動側が上限まで伸びても交差しない。
 */
export const COMPILED_INDEX_BASE = 1000;
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
  /** 章（きょう／編纂）に組み込まれた瞬間。null = まだどこにも入っていない */
  incorporatedAt: Date | null;
};

/**
 * source="compiled" の行に振る次の index。章・チェックで同じ規則を使う。
 * 引数はその教科書の **compiled 行だけ** の MAX(index)（1件も無ければ null）。
 *
 * 事後条件: 戻り値は常に COMPILED_INDEX_BASE 以上（＝自動側 1..5 / 1..7 と交差しない）で、
 * かつ既存の compiled 最大値より必ず大きい。Math.max があるのは、この規則より前に
 * 採番された低い index の compiled 行が残っていても自動側へ落ちてこないようにするため。
 */
export function nextCompiledIndex(existingCompiledMaxIndex: number | null): number {
  if (existingCompiledMaxIndex == null) return COMPILED_INDEX_BASE;
  return Math.max(existingCompiledMaxIndex + 1, COMPILED_INDEX_BASE);
}

/** 教科書として必須の教育学スロット（ADR-0020・物語順） */
export type LessonSlots = {
  /** いま進めていた改修 */
  work: string;
  /** ナレッジが溜まったタイミング */
  timing: string;
  /** とった対応 */
  action: string;
  /** その理由 */
  why: string;
  practice: string;
  consequence: string;
  alternative: string;
};

export type DiagramKind = "silent_gap" | "drift" | "prefix" | "generic";

export type ChapterDraft = {
  index: number;
  title: string;
  oneLiner: string;
  bodyPlain: string;
  bodyDeep: string;
  diagramKind: DiagramKind;
  /** 章固有の BAD/OK（テンプレ固定にしない） */
  diagramBad: string;
  diagramOk: string;
  work: string;
  timing: string;
  action: string;
  why: string;
  practice: string;
  consequence: string;
  alternative: string;
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

export type TextbookChapterView = {
  id: string;
  index: number;
  title: string;
  oneLiner: string;
  bodyPlain: string;
  bodyDeep: string | null;
  diagramKind: string;
  diagramBad: string;
  diagramOk: string;
  work: string;
  timing: string;
  action: string;
  why: string;
  practice: string;
  consequence: string;
  alternative: string;
  evidence: EvidenceLink[];
  materialIds: string[];
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
  chapters: TextbookChapterView[];
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

export function hourJST(d: Date): number {
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

const CONVENTIONAL_TYPES = "feat|fix|chore|test|refactor|docs|ci|perf|build";
const CONVENTIONAL_COMMIT_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES})(?:\\(([^)]+)\\))?:\\s*(.+)$`,
  "i",
);
const CONVENTIONAL_BRACKET_RE = new RegExp(
  `^\\[(${CONVENTIONAL_TYPES})\\]\\s*(.+)$`,
  "i",
);
// extractThemes専用: 説明文の有無を問わずprefixだけ見る（CONVENTIONAL_COMMIT_REは
// \s*(.+)$ で説明文必須のため、`fix:` 単体の扱いが変わってしまい流用できない）。
const CONVENTIONAL_PREFIX_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES})(?:\\(([^)]+)\\))?:`,
  "i",
);

/** conventional commit（`type(scope): desc`）と `[Type] desc` の両方を読む */
function parseConventionalCommit(summary: string): {
  type: string | null;
  scope: string | null;
  description: string;
} {
  const s = summary.trim();
  const paren = s.match(CONVENTIONAL_COMMIT_RE);
  if (paren) {
    return {
      type: paren[1]!.toLowerCase(),
      scope: paren[2]?.trim() || null,
      description: paren[3]!.trim(),
    };
  }
  const bracket = s.match(CONVENTIONAL_BRACKET_RE);
  if (bracket) {
    return {
      type: bracket[1]!.toLowerCase(),
      scope: null,
      description: bracket[2]!.trim(),
    };
  }
  return { type: null, scope: null, description: s };
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
    const conv = s.match(CONVENTIONAL_PREFIX_RE);
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
): DiagramKind {
  const text = [...themes, ...materials.map((m) => m.summary ?? "")].join(" ");
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

/** 技術選定対比の BAD/OK（態度テンプレではない） */
export function diagramCopy(
  title: string,
  theme: string,
  kind: DiagramKind,
): { bad: string; ok: string } {
  const focus = theme || title;
  switch (kind) {
    case "prefix":
      return {
        bad: `「${focus}」を意味が近い文ならキャッシュが効く前提で直し、不一致地点以降の無効化を見ない`,
        ok: `「${focus}」を先頭からの逐語プレフィックスとして扱い、ヒット条件と無効化範囲を1行で説明する`,
      };
    case "drift":
      return {
        bad: `「${focus}」を開発と本番で同じ観測・同じ設定だとみなし、境界を曖昧にしたまま進める`,
        ok: `「${focus}」で何が本番に届き何が届かないかを、根拠コミット付きで言い切る`,
      };
    case "silent_gap":
      return {
        bad: `「${focus}」の差分を「出題が止まった＝学びが無い」とみなし、材料を捨てたつもりで翌日へ行く`,
        ok: `「${focus}」は材料として残っているので、今夜この章で選定理由まで言語化し Mastery を付ける`,
      };
    default:
      return {
        bad: `「${focus}」を動いた事実だけで終え、なぜその実装形にしたかを残さない`,
        ok: `「${focus}」について、採った一手・採らなかった別案・従った結果を1セットで書く`,
      };
  }
}

function formatHourBand(materials: MaterialRow[]): string {
  if (materials.length === 0) return "この日";
  const peak = peakHourFromMaterials(materials);
  if (peak == null) return "この日";
  return `JST ${peak}時台前後`;
}

/**
 * kind×theme×材料から必須スロットを埋める（物語順）。
 * prefix は ADR-0016 / prompt-cache 正典に寄せる（client 安全のため種子文をここへ持つ）。
 */
export function lessonSlotsFor(
  kind: DiagramKind,
  theme: string,
  materials: MaterialRow[],
  summaries: string[],
): LessonSlots {
  const focus = theme || summaries[0]?.slice(0, 28) || "この変更";
  const tip = summaries[0]?.slice(0, 48) ?? focus;
  const tip2 = summaries[1]?.slice(0, 40);
  const backlogN = materials.filter((m) => m.skipReason === "backlog").length;
  const kinds = [...new Set(materials.map((m) => m.kind))];
  const hourBand = formatHourBand(materials);
  const workBase = tip2
    ? `「${focus}」系の改修を進めていた。核は「${tip}」、あわせて「${tip2}」。`
    : `「${focus}」系の改修を進めていた。核は「${tip}」。`;

  const timingBase =
    backlogN > 0
      ? `${hourBand}に材料 ${materials.length} 件が溜まった。うち ${backlogN} 件は即時しれんが backlog で止まったが、ナレッジとしては残っている。`
      : `${hourBand}に材料 ${materials.length} 件（${kinds.join(", ") || "commit"}）が足跡として溜まった。`;

  switch (kind) {
    case "prefix":
      return {
        work: `${workBase} ハーネス／プロンプトキャッシュの前提が実装に効く局面。`,
        timing: timingBase,
        action: `対応: 「${focus}」を意味類似ではなく逐語プレフィックスとして扱い、ヒット条件と無効化範囲を言葉に残す（核: ${tip}）。`,
        why: `理由: キャッシュ再利用は先頭からの並び一致で決まる。途中削除や定義挿入で後ろが壊れる、という選定を明示しないと翌日に再現できない。`,
        practice: `ベストプラクティス: 安定プレフィックスを前に置き、途中削除やツール定義の挿入で後ろを壊さない。キャッシュは『意味が近い』ではヒットしない。`,
        consequence: `従うと: 不一致地点より後ろだけが再計算され、cache read 率と遅延が読みやすくなる。短くしたつもりでコストが増える事故を減らせる。`,
        alternative: `やりがちな別案: 履歴を途中から削る／意味が近い文に寄せて節約する。採らない理由: 並びが変わると以降が全部無効化され、入力トークン減≠コスト減になる。`,
      };
    case "drift":
      return {
        work: `${workBase} 観測・環境・届く範囲の境界が論点の改修。`,
        timing: timingBase,
        action: `対応: 「${focus}」で何が本番に届き何が届かないかを、根拠コミット付きで言い切る（核: ${tip}）。`,
        why: `理由: 開発と本番を同一視すると選定理由が消え、ロールアウトや監視の切り分けが翌日に持ち越される。`,
        practice: `ベストプラクティス: 変更の影響面（誰の環境・どのフラグ・どのエンドポイント）をコミット根拠付きで固定し、メタ情報だけで『見たつもり』にしない。`,
        consequence: `従うと: 本番に届く／届かないが説明でき、障害時に『どこから効いたか』を追える。`,
        alternative: `やりがちな別案: 全部署・全環境に同じ設定を一気に入れる。採らない理由: 境界が曖昧なまま拡散する。`,
      };
    case "silent_gap":
      return {
        work: `${workBase} 実装は進んだが即時しれんが追いつかない局面。`,
        timing: `${timingBase} 出題が止まったタイミング＝学びが無い、と誤認しやすい。`,
        action: `対応: 「${focus}」を今夜の章で一度言語化し、確認で Mastery を付ける（核: ${tip}）。`,
        why: `理由: backlog で止めても材料は残っている。日次章で選定を回収しないと、同じ説明詰まりが再発する（ADR-0020）。`,
        practice: `ベストプラクティス: backlog で止めた差分も材料として章に載せ、改修・対応・理由をその日のうちに言語化する。`,
        consequence: `従うと: 翌日の CTA / 確認が Mastery 付きで繋がり、『積んだまま説明できない』ループを切れる。`,
        alternative: `やりがちな別案: 出題が無い日は振り返らず次の実装へ進む。採らない理由: 材料は溜まっているのに理解状態だけが空になる。`,
      };
    default:
      return {
        work: workBase,
        timing: timingBase,
        action: `対応: 「${focus}」の代表コミットを開き、採った形を1文で固定する（核: ${tip}）。`,
        why: `理由: 動いた事実だけでは翌日に『なぜこうなったか』が消える。選定理由を残すため。`,
        practice: `ベストプラクティス: 代表コミットを1つ開き、(1)目的 (2)採った形 (3)捨てた形 を短く固定してから次の差分に進む。`,
        consequence: `従うと: 同僚や未来の自分が選定を再発明せず、同じテーマの次の一手が早くなる。`,
        alternative: `やりがちな別案: 動いたコミット列だけをログとして残し、選定は頭の中に置く。採らない理由: 翌日には根拠が消える。`,
      };
  }
}

export function chapterHasLessonSlots(
  ch: Pick<
    ChapterDraft,
    | "work"
    | "timing"
    | "action"
    | "why"
    | "practice"
    | "consequence"
    | "alternative"
    | "diagramBad"
    | "diagramOk"
  >,
): boolean {
  return (
    ch.work.trim().length > 0 &&
    ch.timing.trim().length > 0 &&
    ch.action.trim().length > 0 &&
    ch.why.trim().length > 0 &&
    ch.practice.trim().length > 0 &&
    ch.consequence.trim().length > 0 &&
    ch.alternative.trim().length > 0 &&
    ch.diagramBad.trim().length > 0 &&
    ch.diagramOk.trim().length > 0
  );
}

export function chaptersHaveLessonSlots(chapters: ChapterDraft[]): boolean {
  return chapters.length === 0 || chapters.every(chapterHasLessonSlots);
}

export function encodeLessonMarkers(input: {
  work: string;
  timing: string;
  action: string;
  why: string;
  practice: string;
  consequence: string;
  alternative: string;
  diagramBad: string;
  diagramOk: string;
}): string {
  return [
    `[[WORK]]${input.work}`,
    `[[TIMING]]${input.timing}`,
    `[[ACTION]]${input.action}`,
    `[[WHY]]${input.why}`,
    `[[PRACTICE]]${input.practice}`,
    `[[CONSEQUENCE]]${input.consequence}`,
    `[[ALT]]${input.alternative}`,
    `[[BAD]]${input.diagramBad}`,
    `[[OK]]${input.diagramOk}`,
  ].join("\n");
}

/** bodyDeep に埋め込んだスロット／BAD/OK を取り出す */
export function parseLessonSlots(bodyDeep: string | null): LessonSlots & {
  diagramBad: string | null;
  diagramOk: string | null;
} {
  if (!bodyDeep) {
    return {
      work: "",
      timing: "",
      action: "",
      why: "",
      practice: "",
      consequence: "",
      alternative: "",
      diagramBad: null,
      diagramOk: null,
    };
  }
  const pick = (tag: string) =>
    bodyDeep.match(new RegExp(`\\[\\[${tag}\\]\\](.+)`))?.[1]?.trim() ?? "";
  return {
    work: pick("WORK"),
    timing: pick("TIMING"),
    action: pick("ACTION"),
    why: pick("WHY"),
    practice: pick("PRACTICE"),
    consequence: pick("CONSEQUENCE"),
    alternative: pick("ALT"),
    diagramBad: pick("BAD") || null,
    diagramOk: pick("OK") || null,
  };
}

/** bodyDeep 互換: BAD/OK のみ（旧データ） */
export function parseDiagramCopy(bodyDeep: string | null): {
  bad: string | null;
  ok: string | null;
} {
  const s = parseLessonSlots(bodyDeep);
  return { bad: s.diagramBad, ok: s.diagramOk };
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

export type BandDraft = {
  repo: string;
  materialIds: string[];
  digest: string;
  count: number;
};

/**
 * 章の予算（TEXTBOOK_MAX_CHAPTERS × TEXTBOOK_MAX_MATERIALS_PER_CHAPTER）から
 * あふれた材料を、repo単位の「よみもの帯」下書きに束ねる。LLM不要。
 */
export function groupMaterialsIntoBandDrafts(
  materials: MaterialRow[],
): BandDraft[] {
  const byRepo = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    const list = byRepo.get(m.repo) ?? [];
    list.push(m);
    byRepo.set(m.repo, list);
  }
  const bands: BandDraft[] = [];
  for (const [repo, rows] of byRepo) {
    const sorted = [...rows].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
    const preview = sorted
      .slice(0, 3)
      .map((m) => (m.summary?.trim() || m.ref).slice(0, 28))
      .join("、");
    bands.push({
      repo,
      materialIds: sorted.map((m) => m.id),
      digest: preview,
      count: sorted.length,
    });
  }
  return bands.sort((a, b) => b.count - a.count);
}

function overflowDigest(overflow: MaterialRow[]): string {
  if (overflow.length === 0) return "";
  const preview = overflow
    .slice(0, 3)
    .map((m) => (m.summary?.trim() || m.ref).slice(0, 24))
    .join("、");
  const more = overflow.length > 3 ? "…" : "";
  return `※ ほか ${overflow.length} 件は章の容量超過で畳んだ（捨ててはいない）: ${preview}${more}`;
}

function buildBodyPlain(input: {
  name: string;
  kept: MaterialRow[];
  summaries: string[];
  theme: string;
  lessons: LessonSlots;
  backlogN: number;
  overflow?: MaterialRow[];
}): string {
  const bullets = input.summaries.map((s) => `・${s}`).join("\n");
  const takeaway = input.theme
    ? `覚える一手: 「${input.theme}」を、改修→対応→理由→型 の順で1文にする。`
    : `覚える一手: 代表コミットを1つ開き、対応と理由を自分の言葉で1文にする。`;

  return [
    `場所: ${input.name}（材料 ${input.kept.length} 件）`,
    "",
    "いま進めていた改修:",
    input.lessons.work,
    bullets ||
      `・（要約なし）refs: ${input.kept.map((m) => m.ref.slice(0, 7)).join(", ")}`,
    "",
    "ナレッジが溜まったタイミング:",
    input.lessons.timing,
    "",
    "とった対応:",
    input.lessons.action,
    "",
    "その理由:",
    input.lessons.why,
    "",
    "ベストプラクティス:",
    input.lessons.practice,
    "",
    "従うとどうなる:",
    input.lessons.consequence,
    "",
    "やりがちな別案:",
    input.lessons.alternative,
    "",
    takeaway,
    input.backlogN > 0
      ? `※ うち ${input.backlogN} 件は即時しれんを止めたが、材料としては残っている。`
      : "",
    overflowDigest(input.overflow ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

const TYPE_VERB: Record<string, string> = {
  feat: "に機能を足した",
  fix: "のほころびを直した",
  refactor: "を整理した",
  perf: "を速くした",
  docs: "の説明を書いた",
  test: "の確認を足した",
  chore: "を整えた",
  build: "を整えた",
  ci: "を整えた",
};

/**
 * 主語なし専用の動詞表。TYPE_VERBの「に」「の」は主語（scope/repo）が
 * 前提の助詞のため、主語が無く引用へ直接掛けると引用（=説明文）が動作対象
 * であるかのように主客が逆転して読める（例:「〇〇に機能を足した」）。
 * 「を」に統一し、引用を素直に動作の対象として読ませる（opus指摘）。
 */
const TYPE_VERB_NO_SUBJECT: Record<string, string> = {
  feat: "という機能を足した",
  fix: "を直した",
  refactor: "を整理した",
  perf: "を速くした",
  docs: "を書いた",
  test: "を確認した",
  chore: "を整えた",
  build: "を整えた",
  ci: "を整えた",
};

/**
 * feat/fix 等の「実質的な仕事」を、choreやbuildより核として優先するための重み。
 * mergeコミットは他の集計（uniqueSummaries・evidenceFrom・extractThemes）と同じく
 * 最低点として除外する — 除外しないと choreしか無い日に merge コミットが核に
 * 昇格してしまう（実データで発生確認済み、opusレビュー指摘）。
 */
function commitSignificance(summary: string): number {
  if (isMergeSummary(summary)) return 0;
  const { type } = parseConventionalCommit(summary);
  if (type == null) return 3; // 型が読めない = 自由記述の実質的な報告として扱う
  if (type === "feat" || type === "fix" || type === "refactor" || type === "perf") {
    return 3;
  }
  if (type === "test" || type === "docs") return 2;
  return 1; // chore/build/ci
}

/**
 * 章の「核」に選ぶ1件を、一覧の先頭（直近）ではなく重要度で選ぶ
 * （直近1件が chore/typo 直しだと日記の主役がそれになってしまうため。同点は
 * 直近＝先頭を残す）。
 */
export function pickHeadlineSummary(summaries: string[]): string | undefined {
  if (summaries.length === 0) return undefined;
  let best = summaries[0]!;
  let bestScore = commitSignificance(best);
  for (let i = 1; i < summaries.length; i++) {
    const score = commitSignificance(summaries[i]!);
    if (score > bestScore) {
      best = summaries[i]!;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 生のコミット要約を「日記の地の文＋原文引用」に組み立てる。
 * 説明文は言語を問わず常に「」でそのまま引用する — 述語で終わる日本語コミットに
 * 動詞を接尾すると文法が壊れる／英語コミットは翻訳できない、の両方をこれで避ける
 * （2026-08、item①・Fableレビュー反映）。
 * repoFallbackは「コミット自身にscopeが無いときの主語」— コミットの主体が
 * 確実に分かっている場面（新規生成時のrepo名）だけで渡す。信頼できない文字列
 * （旧titleなど）を渡すくらいなら null にして主語なし文型に倒すこと
 * （opusレビュー指摘、実データで37/38章が該当する破綻を確認済み）。
 */
export function buildOneLinerSentence(
  rawSummary: string,
  repoFallback: string | null,
): string {
  const { type, scope, description } = parseConventionalCommit(rawSummary);
  const subject = scope || repoFallback;
  if (!subject) {
    // 主語は捨てても、typeが読めていれば動詞は引用に直接掛けて残す
    // （「「desc」を整えた。」等）。type も読めない自由記述だけ完全に汎用文にする
    // （opusレビュー指摘: 主語なし＝type動詞も一律で捨てると情報量が減っていた）。
    const typeVerbNoSubject = type && TYPE_VERB_NO_SUBJECT[type];
    return typeVerbNoSubject
      ? `「${description}」${typeVerbNoSubject}。`
      : `「${description}」に取り組んだ。`;
  }
  const typeVerb = type && TYPE_VERB[type];
  return `${subject}${typeVerb || "に手を入れた"}。「${description}」`;
}

/**
 * 旧形式（`核: ...`）を検知したら新形式相当に整形する。新形式はそのまま通す。
 * 主語はコミット自身のscopeにのみ由来させ、外部からの主語フォールバックは
 * 受け取らない — 旧titleはテーマ2件連結の切り詰め文字列で主語として
 * 信頼できないため（opusレビュー指摘）。
 */
export function normalizeOneLinerForDisplay(oneLiner: string): string {
  const m = oneLiner.match(/^核:\s*([\s\S]+)$/);
  if (!m) return oneLiner;
  const raw = m[1]!.replace(/\s*／\s*ついでに[\s\S]*$/, "").trim();
  return buildOneLinerSentence(raw, null);
}

export function draftChapterFromRepo(
  index: number,
  repo: string,
  kept: MaterialRow[],
  overflow: MaterialRow[],
): ChapterDraft {
  const name = repoShort(repo);
  const summaries = uniqueSummaries(kept, 5);
  const themes = extractThemes(summaries);
  const theme = themes[0] ?? summaries[0]?.slice(0, 28) ?? name;
  // タイトルはrepo名で固定する。テーマ2件を「a / b」で連結すると機械的な
  // タグの寄せ集めになり、日記のタイトルとして読めないため（2026-08、item①）。
  // 自動生成（byRepo）内では同日の他章と必ず異なるが、編纂（compileMaterialBand）
  // はあふれ元と同じrepoの自動章と衝突しうるため、呼び出し側で個別に防いでいる
  // （opusレビュー指摘、daily-textbook.ts:compileMaterialBand参照）。
  const title = name;
  const backlogN = kept.filter((m) => m.skipReason === "backlog").length;
  const headline = pickHeadlineSummary(summaries);
  const oneLiner = headline
    ? buildOneLinerSentence(headline, name)
    : `${name} に ${kept.length} 件の足跡。`;

  const kind = diagramFor(kept, themes);
  const { bad, ok } = diagramCopy(title, theme, kind);
  const lessons = lessonSlotsFor(kind, theme, kept, summaries);
  const bodyPlain = buildBodyPlain({
    name,
    kept,
    summaries,
    theme,
    lessons,
    backlogN,
    overflow,
  });
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
    encodeLessonMarkers({
      work: lessons.work,
      timing: lessons.timing,
      action: lessons.action,
      why: lessons.why,
      practice: lessons.practice,
      consequence: lessons.consequence,
      alternative: lessons.alternative,
      diagramBad: bad,
      diagramOk: ok,
    }),
  ]
    .filter(Boolean)
    .join("\n");

  const draft: ChapterDraft = {
    index,
    title,
    oneLiner,
    bodyPlain,
    bodyDeep,
    diagramKind: kind,
    diagramBad: bad,
    diagramOk: ok,
    work: lessons.work,
    timing: lessons.timing,
    action: lessons.action,
    why: lessons.why,
    practice: lessons.practice,
    consequence: lessons.consequence,
    alternative: lessons.alternative,
    evidence: evidenceFrom(kept),
    materialIds: kept.map((m) => m.id),
  };
  if (!chapterHasLessonSlots(draft)) {
    throw new Error(`chapter ${index} missing lesson slots`);
  }
  return draft;
}

/** 章コピーがテンプレ崩れしていないか（2章以上で互いに違うこと） */
export function chaptersHaveDistinctCopy(chapters: ChapterDraft[]): boolean {
  if (chapters.length <= 1) return true;
  const size = chapters.length;
  return (
    new Set(chapters.map((c) => c.title)).size === size &&
    new Set(chapters.map((c) => c.oneLiner)).size === size &&
    new Set(chapters.map((c) => c.bodyPlain)).size === size &&
    new Set(chapters.map((c) => c.diagramBad)).size === size &&
    new Set(chapters.map((c) => c.work)).size === size &&
    new Set(chapters.map((c) => c.why)).size === size &&
    new Set(chapters.map((c) => c.practice)).size === size
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
  const seenWork = new Set<string>();
  const seenWhy = new Set<string>();
  const seenPractice = new Set<string>();
  return chapters.map((ch) => {
    let title = ch.title;
    let oneLiner = ch.oneLiner;
    let bodyPlain = ch.bodyPlain;
    let bodyDeep = ch.bodyDeep;
    let diagramBad = ch.diagramBad;
    let diagramOk = ch.diagramOk;
    let work = ch.work;
    const timing = ch.timing;
    const action = ch.action;
    let why = ch.why;
    let practice = ch.practice;
    const consequence = ch.consequence;
    const alternative = ch.alternative;
    if (seenTitle.has(title)) title = `${title} · ${ch.index}`;
    if (seenOne.has(oneLiner)) oneLiner = `${oneLiner}（章${ch.index}）`;
    if (seenWork.has(work)) work = `${work}（章${ch.index}）`;
    if (seenWhy.has(why)) why = `${why}（章${ch.index}）`;
    if (seenPractice.has(practice)) practice = `${practice}（章${ch.index}）`;
    if (seenBad.has(diagramBad)) {
      diagramBad = `${diagramBad}（章${ch.index}）`;
      diagramOk = `${diagramOk}（章${ch.index}）`;
    }
    if (
      seenBody.has(bodyPlain) ||
      work !== ch.work ||
      why !== ch.why ||
      practice !== ch.practice
    ) {
      const lessons = {
        work,
        timing,
        action,
        why,
        practice,
        consequence,
        alternative,
      };
      bodyPlain = buildBodyPlain({
        name: `章${ch.index}`,
        kept: [],
        summaries: [oneLiner.replace(/^核:\s*/, "").slice(0, 72)],
        theme: title,
        lessons,
        backlogN: 0,
      }).replace(
        /場所: .*（材料 \d+ 件）/,
        bodyPlain.match(/場所: .*（材料 \d+ 件）/)?.[0] ??
          `場所: 章${ch.index}`,
      );
      bodyDeep = [
        bodyPlain,
        "",
        `（章${ch.index}・差別化）`,
        "",
        encodeLessonMarkers({
          work,
          timing,
          action,
          why,
          practice,
          consequence,
          alternative,
          diagramBad,
          diagramOk,
        }),
      ].join("\n");
    }
    seenTitle.add(title);
    seenOne.add(oneLiner);
    seenBody.add(bodyPlain);
    seenBad.add(diagramBad);
    seenWork.add(work);
    seenWhy.add(why);
    seenPractice.add(practice);
    return {
      ...ch,
      title,
      oneLiner,
      bodyPlain,
      bodyDeep,
      diagramBad,
      diagramOk,
      work,
      timing,
      action,
      why,
      practice,
      consequence,
      alternative,
    };
  });
}

/** 実務レイヤ表示用。マーカー行と重複スロット見出し本文は落とす（カード側で出す） */
export function bodyForDisplay(body: string): string {
  return body
    .replace(
      /^\[\[(?:WORK|TIMING|ACTION|WHY|PRACTICE|CONSEQUENCE|ALT|BAD|OK)\]\].*$/gm,
      "",
    )
    .replace(
      /^いま進めていた改修:\n[\s\S]*?(?=\nナレッジが溜まったタイミング:|\nとった対応:|\nその理由:|\nベストプラクティス:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^ナレッジが溜まったタイミング:\n[\s\S]*?(?=\nとった対応:|\nその理由:|\nベストプラクティス:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^とった対応:\n[\s\S]*?(?=\nその理由:|\nベストプラクティス:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^その理由:\n[\s\S]*?(?=\nベストプラクティス:|\n従うとどうなる:|\nやりがちな別案:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^なぜこの一手か:\n[\s\S]*?(?=\nベストプラクティス:|\n従うとどうなる:|\nやりがちな別案:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^ベストプラクティス:\n[\s\S]*?(?=\n従うとどうなる:|\nやりがちな別案:|\n覚える一手:|$)/m,
      "",
    )
    .replace(
      /^従うとどうなる:\n[\s\S]*?(?=\nやりがちな別案:|\n覚える一手:|$)/m,
      "",
    )
    .replace(/^やりがちな別案:\n[\s\S]*?(?=\n覚える一手:|$)/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 章の「やったこと」要約（1〜2文、日記文体）。
 * 章の先頭に置いて、スロットを開かなくても何の話か分かるようにするためのもの。
 * oneLinerは新形式ならそのまま、旧形式（`核: …`）ならnormalizeOneLinerForDisplayで
 * その場で整形し、action（対応: …）は短い日で補足として添える。
 */
export function chapterDidSummary(input: {
  oneLiner: string;
  action?: string | null;
}): string {
  const core = normalizeOneLinerForDisplay(input.oneLiner).trim();
  const did = (input.action ?? "")
    .replace(/^対応:\s*/, "")
    // action 末尾の「（核: …）」は oneLiner と同じ材料。要約で二度言わない
    .replace(/（核:[^）]*）\s*。?\s*$/, "")
    .replace(/^「[^」]*」で実際に採った一手を1文で復元せよ。?$/, "")
    .trim();
  const parts = [core];
  // 核だけで足りている日は1文で止める（テンプレ文で水増ししない）
  if (did && did !== core && core.length < 24) parts.push(did);
  return parts
    .filter(Boolean)
    .map((s) => (/[。.!?！？]$/.test(s) ? s : `${s}。`))
    .join("");
}

/** 冒険者日記の文末を保証する（chapterDidSummaryと同じ規則） */
function ensureSentenceEnd(s: string): string {
  return /[。.!?！？]$/.test(s) ? s : `${s}。`;
}

/**
 * 章2つめ以降をつなぐ接続詞。章順は材料数降順（clusterMaterialsIntoChapters）
 * であって時刻順ではないため、「まず/続いて」等の時系列語は使わず、
 * 足し算の語だけで固定順に振る（最大 TEXTBOOK_MAX_CHAPTERS=5 章なので
 * 3語で足りるが、防御的に循環させる）
 */
const DIGEST_CONNECTIVES = ["あわせて", "さらに", "くわえて", "おまけに"] as const;

/** dayDigest への enrichment。全て optional（無ければ簡素な日記に退化する） */
export type DigestChapterInput = {
  title: string;
  oneLiner: string;
  /**
   * 章に載った材料数。5件以上かつ上限(TEXTBOOK_MAX_MATERIALS_PER_CHAPTER)
   * 未満で「ここだけでN件の手が入った」を足す
   */
  materialCount?: number;
  /** 章材料の JST hour (0-23)。時間帯オープナー・言及順の並び替えに使う */
  hours?: number[];
};

export type DigestDayInput = {
  /** その日の全材料の JST hour。書き出しの時間帯スパンに使う */
  hours?: number[];
};

const JA_COUNT = ["", "ひとつ", "ふたつ", "みっつ", "よっつ", "いつつ"] as const;

function jaCount(n: number): string {
  return JA_COUNT[n] ?? `${n}つ`;
}

/** JST hour → 日記の時間帯語 */
function hourBandLabel(h: number): string {
  if (h < 5) return "未明";
  if (h < 10) return "あさ";
  if (h < 12) return "ひる前";
  if (h < 14) return "ひるどき";
  if (h < 17) return "ひるさがり";
  if (h < 19) return "夕ぐれ";
  if (h < 22) return "よる";
  return "夜ふけ";
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

type ChapterTimeStats = {
  count: number | null;
  medianHour: number | null;
  /** 材料が時間帯として固まっているか（最大-最小 ≤ 4h）。時間帯語を名指す正直ゲート */
  localized: boolean;
};

function chapterTimeStats(ch: DigestChapterInput): ChapterTimeStats {
  const hours = (ch.hours ?? []).slice().sort((a, b) => a - b);
  return {
    count: ch.materialCount ?? null,
    medianHour: hours.length ? median(hours) : null,
    localized: hours.length > 0 && hours[hours.length - 1]! - hours[0]! <= 4,
  };
}

/**
 * 主役章にだけ足す「厚み」の一言。データが薄ければ空文字（水増ししない）。
 * materialCount は章あたり TEXTBOOK_MAX_MATERIALS_PER_CHAPTER で切り詰め
 * 済みのため、上限ちょうどは「実際に何件あったか」を語れない飽和値。
 * 実データの大半がこの上限に張り付き「ここだけで8件」が一字一句同じ
 * 定型文になっていた（opusレビュー指摘、2026-08-18）ため、上限では出さない
 */
function mainWeightSentence(count: number | null): string {
  if (count == null || count < 5 || count >= TEXTBOOK_MAX_MATERIALS_PER_CHAPTER)
    return "";
  return `ここだけで${count}件の手が入った。`;
}

/**
 * その日の「大枠」を1つの日記文にする（全章の内容に必ず触れる。作業が
 * 多い日は日記がパンパンになってよい。koki実機FB、2026-08-18）。
 * 以前は先頭章の headline だけに触れ、残章は title 列挙のみだった
 * （trail）が、全章の本文が出る今は重複なので trail は廃止する。
 * 新しい生成は足さず、既存の oneLiner を「前置のみ」でつなぐ:
 * 接続詞・章名は行頭に足し、文末には句点保証以外は何も接尾しない
 * （述語終止文への接尾は文法破綻する — buildOneLinerSentenceの既知教訓）。
 *
 * 「やったことの羅列」感を減らす段階1（koki実機FB、2026-08-18）:
 * 全章が同じ重み・同じ接続詞ローテだけで並ぶと単調なので、既存データ
 * （材料の受信時刻・章の材料数）から書き出しの時間帯スパンと主役章の
 * 厚みだけを足す。畳み込み・結び・コミット種別からの推測は次の段階へ
 * 送る（Fable設計相談、実データで検証済み）。
 */
export function dayDigest(
  chapters: DigestChapterInput[],
  day?: DigestDayInput,
): string {
  if (chapters.length === 0) return "";
  const top = chapters[0]!;

  if (chapters.length === 1) {
    const headline = ensureSentenceEnd(normalizeOneLinerForDisplay(top.oneLiner));
    return `この日は「${top.title}」ひとすじの一日じゃった。${headline}`;
  }

  const stats = chapters.map(chapterTimeStats);
  const dayHours = (day?.hours ?? chapters.flatMap((c) => c.hours ?? []))
    .slice()
    .sort((a, b) => a - b);

  let opening: string;
  if (dayHours.length === 0) {
    opening = `この日は、${jaCount(chapters.length)}の現場を行き来した。`;
  } else {
    const first = hourBandLabel(dayHours[0]!);
    const last = hourBandLabel(dayHours[dayHours.length - 1]!);
    const span = dayHours[dayHours.length - 1]! - dayHours[0]!;
    // 未明から夜ふけまでのような極端なスパンは連続稼働を過剰に示唆する
    // ため（cron由来の深夜コミット等）「日がな一日」に丸める
    const timeOpen =
      span >= 14 ? "日がな一日、" : first === last ? `${first}のひととき、` : `${first}から${last}まで、`;
    opening = `${timeOpen}${jaCount(chapters.length)}の現場を行き来した。`;
  }

  const topLine = ensureSentenceEnd(normalizeOneLinerForDisplay(top.oneLiner));
  const topSelfNamed =
    topLine.startsWith(top.title) &&
    !/[\w.-]/.test(topLine.charAt(top.title.length));
  const mainSentence = topSelfNamed
    ? `いちばんの動きは——${topLine}`
    : `いちばんの動きは「${top.title}」——${topLine}`;
  const mainWeight = mainWeightSentence(stats[0]!.count);

  // 言及順: 全ての非主役章に時刻中央値があれば時系列に並び替える
  // （章そのものの構造・番号は clusterMaterialsIntoChapters の材料数降順の
  // ままで、dayDigest 内の言及順だけを変える）
  const rest = chapters
    .slice(1)
    .map((c, i) => ({ c, st: stats[i + 1]! }));
  // 時刻が引ける章同士だけを時系列に並べる。全章そろわないと諦める
  // all-or-nothing だと、時刻がある章同士の順序まで巻き戻って読める
  // 組み合わせが起こりうる（opusレビュー指摘）ため、時刻なしは元の
  // 宣言順を保ったまま末尾へ安定的に寄せる
  rest.sort((a, b) => {
    if (a.st.medianHour == null && b.st.medianHour == null) return 0;
    if (a.st.medianHour == null) return 1;
    if (b.st.medianHour == null) return -1;
    return a.st.medianHour - b.st.medianHour;
  });

  const midParts: string[] = [];
  let connIdx = 0;
  let lastBand: string | null =
    stats[0]!.localized && stats[0]!.medianHour != null
      ? hourBandLabel(stats[0]!.medianHour!)
      : null;
  for (const { c, st } of rest) {
    const line = ensureSentenceEnd(normalizeOneLinerForDisplay(c.oneLiner));
    const selfNamed =
      line.startsWith(c.title) && !/[\w.-]/.test(line.charAt(c.title.length));
    const band =
      st.localized && st.medianHour != null ? hourBandLabel(st.medianHour) : null;
    if (band && band !== lastBand) {
      // 材料が時間帯として固まっている章だけ、時刻を名指しする（正直ゲート）
      midParts.push(selfNamed ? `${band}、${line}` : `${band}、「${c.title}」では、${line}`);
      lastBand = band;
      continue;
    }
    const conn = DIGEST_CONNECTIVES[connIdx % DIGEST_CONNECTIVES.length]!;
    connIdx += 1;
    midParts.push(
      selfNamed ? `${conn}、${line}` : `${conn}「${c.title}」では、${line}`,
    );
  }

  return [opening, mainSentence, mainWeight, ...midParts]
    .filter(Boolean)
    .join("");
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

  const diversified = ensureChapterCopyDiversity(chapters);
  if (!chaptersHaveLessonSlots(diversified)) {
    throw new Error("clusterMaterialsIntoChapters: lesson slots missing");
  }
  return {
    chapters: diversified,
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

/** 編纂（帯→章の昇格）で追加する1問だけの確認問い */
export function distillSingleCheck(
  chapter: ChapterDraft,
): { chapterIndex: number; question: string } {
  return {
    chapterIndex: chapter.index,
    question: `「${chapter.title}」で進めていた改修と、ナレッジが溜まったタイミングを1文で。とった対応も添えること。（改修: ${chapter.work.slice(0, 36)}）`,
  };
}

/**
 * lessonSlotsFor 由来のスロット値は見出しを自前で持つ（action="対応: …"、
 * why="理由: …"、practice="ベストプラクティス: …" 等）が、LLM研磨後は持たない
 * 場合がある。表示側で同じ見出しを重ねる箇所（distillChecks・buildJumonContext）
 * で二重にならないよう、あれば剥がす（opusレビュー指摘: buildJumonContext側の
 * 対応:/理由:/型: も同じ二重化バグを持っていた）。
 */
const SLOT_PREFIX_RE =
  /^(?:理由|対応|ベストプラクティス|従うと|やりがちな別案)[:：]\s*/;
export function stripSlotPrefix(text: string): string {
  return text.replace(SLOT_PREFIX_RE, "");
}

/**
 * atlas-textbook-chapter-card.tsx の LessonBlock 表示用。work/timing は
 * 見出しを自前で持たないため対象外、action/why/practice/consequence/
 * alternative の5スロットのみ stripSlotPrefix を適用する。
 */
export function lessonsForDisplay(lessons: LessonSlots): LessonSlots {
  return {
    work: lessons.work,
    timing: lessons.timing,
    action: stripSlotPrefix(lessons.action),
    why: stripSlotPrefix(lessons.why),
    practice: stripSlotPrefix(lessons.practice),
    consequence: stripSlotPrefix(lessons.consequence),
    alternative: stripSlotPrefix(lessons.alternative),
  };
}

/** 章あたりスロット連動問い＋横断。合計は 3〜7。 */
export function distillChecks(chapters: ChapterDraft[]): CheckDraft[] {
  if (chapters.length === 0) return [];
  const checks: CheckDraft[] = [];
  const templates = [
    (ch: ChapterDraft) =>
      `「${ch.title}」で進めていた改修と、ナレッジが溜まったタイミングを1文で。とった対応も添えること。（改修: ${ch.work.slice(0, 36)}）`,
    (ch: ChapterDraft) =>
      `「${ch.title}」でとった対応とその理由を述べよ。別案を1つ否定せよ。（理由: ${stripSlotPrefix(ch.why).slice(0, 36)}）`,
    (ch: ChapterDraft) =>
      `「${ch.title}」のベストプラクティスを1文で言い、従った結果どうなるかを添えよ。`,
  ];

  for (let i = 0; i < chapters.length && checks.length < 5; i++) {
    const ch = chapters[i]!;
    checks.push({
      index: checks.length + 1,
      chapterIndex: ch.index,
      question: templates[i % templates.length]!(ch),
    });
  }
  while (checks.length < 3 && chapters[0]) {
    const ch = chapters[checks.length % chapters.length]!;
    checks.push({
      index: checks.length + 1,
      chapterIndex: ch.index,
      question: templates[checks.length % templates.length]!(ch),
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
      question: `今日の章（${names}）をまたぎ、いちばん重要な選定とその結果を1文で。根拠の章名も添えること。`,
    });
  }
  return checks.slice(0, 7);
}

/**
 * じゅもん注入コンテキスト。開いている1章＋ひとこと＋スロット短縮＋URL/ref。
 * 日次全量・diff 本文・他章は入れない。
 */
export function buildJumonContext(input: {
  dateKey: string;
  depth: "plain" | "deep";
  chapter: Pick<
    ChapterDraft,
    | "index"
    | "title"
    | "oneLiner"
    | "evidence"
    | "work"
    | "timing"
    | "action"
    | "why"
    | "practice"
    | "consequence"
    | "alternative"
  > & { bodyPlain?: string; bodyDeep?: string | null };
}): string {
  const fromDeep = input.chapter.bodyDeep
    ? parseLessonSlots(input.chapter.bodyDeep)
    : null;
  const work = (input.chapter.work || fromDeep?.work || "").slice(0, 90);
  const action = stripSlotPrefix(
    input.chapter.action || fromDeep?.action || "",
  ).slice(0, 90);
  const why = stripSlotPrefix(input.chapter.why || fromDeep?.why || "").slice(
    0,
    90,
  );
  const practice = stripSlotPrefix(
    input.chapter.practice || fromDeep?.practice || "",
  ).slice(0, 90);
  const urls = input.chapter.evidence
    .map((e) => e.url || e.ref || e.label)
    .filter(Boolean)
    .slice(0, TEXTBOOK_MAX_EVIDENCE_URLS);
  const lines = [
    `【きょうのしょ】${input.dateKey} 章${input.chapter.index}: ${input.chapter.title}`,
    `ひとこと: ${input.chapter.oneLiner}`,
    work ? `改修: ${work}` : null,
    action ? `対応: ${action}` : null,
    why ? `理由: ${why}` : null,
    practice ? `型: ${practice}` : null,
    `深さ: ${input.depth === "deep" ? "実務" : "初学者"}`,
    urls.length ? `一次情報:` : null,
    ...urls.map((u) => `- ${u}`),
    "",
    "指示: この章だけを深掘りせよ。改修→タイミング→対応→理由→型の流れで説明せよ。日次の他章・diff 全文は持っていない。必要なら検索ツールで足りぬ材料を引け。",
  ].filter((x): x is string => x != null);

  let text = lines.join("\n");
  if (text.length > JUMON_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, JUMON_CONTEXT_MAX_CHARS - 20)}\n…(budget)`;
  }
  return text;
}
