"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  FileCode,
  GitCommitHorizontal,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { recordResourceAccess } from "@/lib/actions";
import type { GateResourceItem } from "@/lib/gate-resources";

export type { GateResourceItem };

const KIND_ICON: Record<string, LucideIcon> = {
  doc: BookOpen,
  file: FileCode,
  commit: GitCommitHorizontal,
  adr: ScrollText,
};

export function GateResources({
  gateId,
  resources,
}: {
  gateId: string;
  resources: GateResourceItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (resources.length === 0) return null;

  const onAccess = () => {
    const fd = new FormData();
    fd.set("gateId", gateId);
    startTransition(async () => {
      await recordResourceAccess(fd);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2.5 border-t border-border pt-5">
      <p className="text-xs font-bold tracking-[2px] text-ink-faint">参考リソース</p>
      <ul className="space-y-1.5">
        {resources.map((r, i) => {
          const Icon = KIND_ICON[r.kind] ?? FileCode;
          const content = (
            <>
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} />
              <span>{r.label}</span>
            </>
          );
          return (
            <li key={`${r.kind}-${r.label}-${i}`}>
              {r.href ? (
                <a
                  href={r.href}
                  target={r.href.startsWith("http") ? "_blank" : undefined}
                  rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  onClick={onAccess}
                  className="inline-flex items-start gap-2 text-sm text-ink-secondary transition-colors hover:text-accent"
                >
                  {content}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={onAccess}
                  className="inline-flex items-start gap-2 text-left text-sm text-ink-secondary transition-colors hover:text-accent"
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-faint">
        調べて答えてよいです。リソースを開くと「調査後回答」として記録されます。
      </p>
    </div>
  );
}
