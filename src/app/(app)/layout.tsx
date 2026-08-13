import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";
import { AtlasLiveEventsProvider } from "@/components/living-atlas/atlas-live-events-context";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AtlasBodyClass />
      <main className="flex-1">
        <AtlasLiveEventsProvider>{children}</AtlasLiveEventsProvider>
      </main>
    </>
  );
}
