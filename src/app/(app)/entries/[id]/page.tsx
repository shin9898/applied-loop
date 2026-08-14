import { AtlasEntryDetail } from "@/components/living-atlas/atlas-entry-detail";
import {
  loadEntryDetail,
} from "@/components/living-atlas/load-atlas-data";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);

  // 誤って Capture id で来た場合は受信箱へ誘導（旧リンク救済）
  const asCapture = await prisma.capture.findUnique({
    where: { id },
    select: { id: true },
  });
  if (asCapture) redirect(`/inbox/${id}`);

  const entry = await loadEntryDetail(id);
  if (!entry) notFound();

  return <AtlasEntryDetail entry={entry} />;
}
