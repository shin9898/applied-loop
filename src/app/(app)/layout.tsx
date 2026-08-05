import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AtlasBodyClass />
      <main className="flex-1">{children}</main>
    </>
  );
}
