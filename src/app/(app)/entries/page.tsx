import { AtlasEntries } from "@/components/living-atlas/atlas-entries";
import {
  loadEntries,
  loadUkebakoBoard,
} from "@/components/living-atlas/load-atlas-data";
import { prisma } from "@/lib/db";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ goal?: string; hint?: string }>;
};

export default async function EntriesPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const goalId = sp.goal?.trim() || null;
  const mcpHint = sp.hint === "mcp";
  const [items, board, goal] = await Promise.all([
    loadEntries(),
    loadUkebakoBoard(),
    goalId
      ? prisma.goal.findUnique({
          where: { id: goalId },
          select: { id: true, title: true },
        })
      : Promise.resolve(null),
  ]);
  return (
    <AtlasEntries
      items={items}
      board={board}
      wsToken={getTerminalWsToken()}
      evidenceHint={
        goal ? { goalId: goal.id, goalTitle: goal.title } : null
      }
      mcpRegisterHint={mcpHint}
    />
  );
}
