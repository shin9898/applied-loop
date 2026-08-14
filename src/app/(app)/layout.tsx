import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";
import { AtlasCommandDock } from "@/components/living-atlas/atlas-command-dock";
import { loadStreakDays } from "@/components/living-atlas/load-atlas-data";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const streakDays = await loadStreakDays();
  return (
    <>
      <AtlasBodyClass />
      <div className="atlas-dq-root atlas-chrome">
        <main className="flex-1">{children}</main>
        <AtlasCommandDock streakDays={streakDays} />
      </div>
    </>
  );
}
