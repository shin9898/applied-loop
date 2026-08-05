import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GateResource } from "@/lib/gate";

export type GateResourceItem = {
  kind: string;
  label: string;
  href: string | null;
};

const execFileAsync = promisify(execFile);

/** origin が GitHub なら https://github.com/owner/repo を返す */
export async function getGithubRemoteBase(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "remote", "get-url", "origin"],
      { timeout: 3000 }
    );
    const url = stdout.trim();
    const ssh = url.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
    if (ssh) return `https://github.com/${ssh[1]}`;
    const https = url.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/i);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
}

export function parseGateResources(raw: string | null | undefined): GateResource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is GateResource =>
        !!r &&
        typeof r === "object" &&
        typeof (r as GateResource).kind === "string" &&
        typeof (r as GateResource).label === "string" &&
        typeof (r as GateResource).ref === "string"
    );
  } catch {
    return [];
  }
}

export type RubricResultItem = { aspect: string; score: number; note?: string };

export function parseRubricResult(raw: string | null | undefined): RubricResultItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { rubric?: unknown }).rubric)
        ? (parsed as { rubric: unknown[] }).rubric
        : null;
    if (!list) return [];
    return list.filter(
      (r): r is RubricResultItem =>
        !!r &&
        typeof r === "object" &&
        typeof (r as RubricResultItem).aspect === "string" &&
        typeof (r as RubricResultItem).score === "number"
    );
  } catch {
    return [];
  }
}

export function scoreGlyph(score: number): string {
  if (score >= 2) return "●";
  if (score === 1) return "◐";
  return "○";
}

/** Gate.resources JSON を UI 用のリンク付きアイテムに変換する */
export async function resolveResourceItems(
  resources: GateResource[],
  repoPath: string | null | undefined
): Promise<GateResourceItem[]> {
  const githubBase = repoPath ? await getGithubRemoteBase(repoPath) : null;

  return resources.map((r) => {
    let href: string | null = null;
    let label = r.label;
    if (r.kind === "doc" && /^https?:\/\//i.test(r.ref)) {
      href = r.ref;
    } else if ((r.kind === "file" || r.kind === "adr") && repoPath) {
      const abs = path.isAbsolute(r.ref) ? r.ref : path.join(repoPath, r.ref);
      href = `vscode://file${abs}`;
    } else if (r.kind === "commit") {
      if (githubBase) {
        href = `${githubBase}/commit/${r.ref}`;
      } else {
        // remote なし: リンクではなくテキスト表示 (ADR-0007)
        label = `${r.label} (${r.ref.slice(0, 7)})`;
      }
    }
    return { kind: r.kind, label, href };
  });
}
