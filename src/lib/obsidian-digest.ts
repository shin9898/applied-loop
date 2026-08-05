import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST } from "@/lib/date";
import { activityStreak } from "@/lib/streak";
import { listActiveGoals, weeklyEvidenceCounts } from "@/lib/goal";

const DAY_MS = 86400000;

function digestDir(): string {
  const env = process.env.OBSIDIAN_DIGEST_DIR?.trim();
  if (env) {
    // ~ 展開
    if (env.startsWith("~/")) {
      return join(process.env.HOME ?? "", env.slice(2));
    }
    return env;
  }
  return join(process.cwd(), "docs", "digest");
}

function digestPath(dateKey: string): string {
  return join(digestDir(), `${dateKey}.md`);
}

/** 指定日のダイジェストファイルが既にあるか */
export async function digestExists(dateKey: string): Promise<boolean> {
  try {
    await access(digestPath(dateKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * 指定日 (JST dateKey) の Obsidian ダイジェスト MD を生成する (ADR-0010 §5)。
 * 出題・採点 / 新規・解消した誤解 / accept された学び / 目標証跡 / ストリーク。
 */
export async function generateDailyDigest(dateKey: string): Promise<string> {
  const start = dayStartJST(new Date(`${dateKey}T12:00:00+09:00`));
  const end = new Date(start.getTime() + DAY_MS);

  const [
    gatesCreated,
    gatesGraded,
    misconceptionsCreated,
    misconceptionsResolved,
    acceptedCaptures,
    goals,
    streak,
  ] = await Promise.all([
    prisma.gate.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        question: true,
        status: true,
        kind: true,
        gradeNote: true,
      },
    }),
    prisma.gate.findMany({
      where: { gradedAt: { gte: start, lt: end } },
      orderBy: { gradedAt: "asc" },
      select: {
        id: true,
        question: true,
        status: true,
        gradeNote: true,
        answerMode: true,
      },
    }),
    prisma.misconception.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { concept: true, status: true },
    }),
    prisma.misconception.findMany({
      where: {
        status: "resolved",
        resolvedAt: { gte: start, lt: end },
      },
      select: { concept: true },
    }),
    prisma.capture.findMany({
      where: {
        status: "accepted",
        reviewedAt: { gte: start, lt: end },
      },
      select: { title: true, entryId: true },
    }),
    listActiveGoals(),
    activityStreak(end),
  ]);

  const evidenceLines: string[] = [];
  for (const g of goals) {
    const c = await weeklyEvidenceCounts(g.id, start);
    const total = c.entries + c.applications + c.resolvedMisconceptions;
    evidenceLines.push(
      `- ${g.title}: 学び ${c.entries} / 実務使用 ${c.applications} / つまずき解消 ${c.resolvedMisconceptions} (計 ${total})`
    );
  }

  const lines: string[] = [
    `# Applied Loop ダイジェスト — ${dateKey}`,
    "",
    `活動ストリーク: ${streak} 日`,
    "",
    "## 出題",
  ];

  if (gatesCreated.length === 0) {
    lines.push("- (なし)");
  } else {
    for (const g of gatesCreated) {
      lines.push(`- [${g.kind}] ${g.question} (status: ${g.status})`);
    }
  }

  lines.push("", "## 採点結果");
  if (gatesGraded.length === 0) {
    lines.push("- (なし)");
  } else {
    for (const g of gatesGraded) {
      const mode = g.answerMode ? ` / ${g.answerMode}` : "";
      lines.push(`- **${g.status}**${mode}: ${g.question}`);
      if (g.gradeNote) {
        lines.push(`  - ${g.gradeNote.split("\n")[0]}`);
      }
    }
  }

  lines.push("", "## 新規の誤解");
  if (misconceptionsCreated.length === 0) {
    lines.push("- (なし)");
  } else {
    for (const m of misconceptionsCreated) {
      lines.push(`- ${m.concept} (${m.status})`);
    }
  }

  lines.push("", "## 解消したつまずき");
  if (misconceptionsResolved.length === 0) {
    lines.push("- (なし)");
  } else {
    for (const m of misconceptionsResolved) {
      lines.push(`- ${m.concept}`);
    }
  }

  lines.push("", "## 登録した学び");
  if (acceptedCaptures.length === 0) {
    lines.push("- (なし)");
  } else {
    for (const c of acceptedCaptures) {
      lines.push(`- ${c.title}`);
    }
  }

  lines.push("", "## 目標の証跡 (今週)");
  if (evidenceLines.length === 0) {
    lines.push("- (アクティブな目標なし)");
  } else {
    lines.push(...evidenceLines);
  }

  lines.push("");

  const body = lines.join("\n");
  const dir = digestDir();
  await mkdir(dir, { recursive: true });
  const path = digestPath(dateKey);
  await writeFile(path, body, "utf8");
  return path;
}

/**
 * morning_briefing 初回呼び出し時に前日分を生成する。
 * 既にファイルがあればスキップ。
 */
export async function generateYesterdayDigestIfNeeded(
  now: Date = new Date()
): Promise<void> {
  const yesterdayKey = dateKeyJST(new Date(now.getTime() - DAY_MS));
  if (await digestExists(yesterdayKey)) return;
  await generateDailyDigest(yesterdayKey);
}
