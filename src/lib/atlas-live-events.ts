import { EventEmitter } from "node:events";

export type AtlasLiveEvent =
  | { type: "gate_passed"; gateId: string }
  | { type: "task_mapping_saved"; dateKey: string; taskCount: number }
  | { type: "capture_added"; title: string };

export type AtlasLiveEventEnvelope = AtlasLiveEvent & { seq: number };

const EVENT_NAME = "atlas-live-event";

const globalForAtlasEvents = globalThis as unknown as {
  atlasEventBus?: EventEmitter;
  atlasEventSeq?: number;
};

const bus = globalForAtlasEvents.atlasEventBus ?? new EventEmitter();
bus.setMaxListeners(50);
if (process.env.NODE_ENV !== "production") {
  globalForAtlasEvents.atlasEventBus = bus;
}

function nextSeq(): number {
  const current = globalForAtlasEvents.atlasEventSeq ?? 0;
  const next = current + 1;
  globalForAtlasEvents.atlasEventSeq = next;
  return next;
}

export function emitAtlasEvent(event: AtlasLiveEvent): void {
  const envelope: AtlasLiveEventEnvelope = { ...event, seq: nextSeq() };
  bus.emit(EVENT_NAME, envelope);
}

export function subscribeAtlasEvents(
  listener: (event: AtlasLiveEventEnvelope) => void,
): () => void {
  bus.on(EVENT_NAME, listener);
  return () => bus.off(EVENT_NAME, listener);
}
