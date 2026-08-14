import { notFound } from "next/navigation";
import { suggestCachePrefixFix } from "@/lib/cache-prefix-prescription";
import { AtlasPrescription } from "@/components/living-atlas/atlas-prescription";
import { getTerminalWsToken } from "@/lib/terminal-token";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ repo: string }> };

export default async function HarnessPrescriptionPage({ params }: Props) {
  const { repo: raw } = await params;
  const repo = decodeURIComponent(raw).trim();
  if (!repo) notFound();

  const prescription = await suggestCachePrefixFix(repo);

  return (
    <AtlasPrescription
      prescription={prescription}
      wsToken={getTerminalWsToken()}
    />
  );
}
