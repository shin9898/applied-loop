import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";
import { AtlasCommandDock } from "@/components/living-atlas/atlas-command-dock";
import { AtlasRouteLoadingProvider } from "@/components/living-atlas/atlas-route-loading-provider";
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
        <AtlasRouteLoadingProvider>
          <main className="flex-1">{children}</main>
        </AtlasRouteLoadingProvider>
        <AtlasCommandDock streakDays={streakDays} />
      </div>
    </>
  );
}
