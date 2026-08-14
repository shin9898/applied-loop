import { AtlasZukanDetail } from "@/components/living-atlas/atlas-zukan-detail";
import {
  loadZukanDetail,
} from "@/components/living-atlas/load-atlas-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ZukanDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);
  const item = await loadZukanDetail(id);
  if (!item) notFound();
  return <AtlasZukanDetail item={item} />;
}
