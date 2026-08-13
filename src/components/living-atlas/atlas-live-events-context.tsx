"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AtlasLiveEventEnvelope } from "@/lib/atlas-live-events";

type AtlasLiveState = {
  connected: boolean;
  lastEvent: AtlasLiveEventEnvelope | null;
};

const AtlasLiveEventsContext = createContext<AtlasLiveState>({
  connected: false,
  lastEvent: null,
});

export function AtlasLiveEventsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<AtlasLiveEventEnvelope | null>(
    null,
  );

  useEffect(() => {
    const source = new EventSource("/api/atlas-events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as AtlasLiveEventEnvelope;
        setLastEvent(parsed);
      } catch {
        /* malformed payload, ignore */
      }
    };
    return () => {
      source.close();
    };
  }, []);

  return (
    <AtlasLiveEventsContext.Provider value={{ connected, lastEvent }}>
      {children}
    </AtlasLiveEventsContext.Provider>
  );
}

export function useAtlasLiveEvents(): AtlasLiveState {
  return useContext(AtlasLiveEventsContext);
}
