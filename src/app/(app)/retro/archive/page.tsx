import { loadMaterialArchive } from "@/lib/daily-textbook";
import { AtlasMaterialArchive } from "@/components/living-atlas/atlas-material-archive";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function MaterialArchivePage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const bands = await loadMaterialArchive(sp.q);
  return <AtlasMaterialArchive bands={bands} query={sp.q ?? ""} />;
}
