import { AtlasInboxDetail } from "@/components/living-atlas/atlas-inbox-detail";
import {
  loadCaptureDetail,
} from "@/components/living-atlas/load-atlas-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);
  const capture = await loadCaptureDetail(id);
  if (!capture) notFound();

  return <AtlasInboxDetail capture={capture} />;
}
