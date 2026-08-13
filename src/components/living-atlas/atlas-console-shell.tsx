"use client";

import { useAtlasLiveEvents } from "./atlas-live-events-context";

export function AtlasConsoleShell({
  topScreen,
  bottomScreen,
  pulse,
}: {
  topScreen: React.ReactNode;
  bottomScreen: React.ReactNode;
  pulse: boolean;
}) {
  const { connected } = useAtlasLiveEvents();
  const glowClass = [
    "atlas-console-glow",
    connected ? "" : "atlas-console-glow--offline",
    pulse ? "atlas-console-glow--pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="atlas-console-shell">
      <div className={glowClass}>{topScreen}</div>
      <div className="atlas-console-hinge" aria-hidden />
      <div className="atlas-console-lower-row">
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-dpad" />
        </div>
        <div className="atlas-console-lower-screen">
          <div className={glowClass}>{bottomScreen}</div>
        </div>
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-abxy">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
