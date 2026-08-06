import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AtlasDigest } from "@/components/living-atlas/atlas-digest";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";

export const dynamic = "force-dynamic";

/** P3: 週次ナレーションをルミナのセリフ窓で見せる */
export default async function DigestPage() {
  const streakDays = await loadStreakDays();
  const weeklyDir = join(process.cwd(), "docs/digest/weekly");
  const files = existsSync(weeklyDir)
    ? readdirSync(weeklyDir)
        .filter((f) => f.endsWith("-narration.md") || f.endsWith(".md"))
        .sort()
        .reverse()
    : [];
  const latest = files[0] ?? null;
  const weekKey = latest
    ? latest.replace(/-narration\.md$/, "").replace(/\.md$/, "")
    : null;
  const body =
    latest && existsSync(join(weeklyDir, latest))
      ? readFileSync(join(weeklyDir, latest), "utf8")
      : null;
  const siblings = files.map((fileName) => ({
    fileName,
    weekKey: fileName.replace(/-narration\.md$/, "").replace(/\.md$/, ""),
  }));

  return (
    <AtlasDigest
      weekKey={weekKey}
      body={body}
      siblings={siblings}
      streakDays={streakDays}
    />
  );
}
