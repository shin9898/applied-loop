import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitAtlasEvent, subscribeAtlasEvents } from "./atlas-live-events";

describe("atlas-live-events", () => {
  it("配信したイベントを購読者が受け取る（seq付き）", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    emitAtlasEvent({ type: "gate_passed", gateId: "g1" });
    unsubscribe();
    assert.equal(received.length, 1);
    const e = received[0] as { type: string; gateId: string; seq: number };
    assert.equal(e.type, "gate_passed");
    assert.equal(e.gateId, "g1");
    assert.equal(typeof e.seq, "number");
  });

  it("unsubscribe 後はイベントを受け取らない", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    unsubscribe();
    emitAtlasEvent({ type: "capture_added", title: "t" });
    assert.deepEqual(received, []);
  });

  it("複数購読者に同じイベントが届く", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = subscribeAtlasEvents((e) => a.push(e));
    const unsubB = subscribeAtlasEvents((e) => b.push(e));
    emitAtlasEvent({ type: "task_mapping_saved", dateKey: "2026-08-13", taskCount: 2 });
    unsubA();
    unsubB();
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  it("seq はイベントごとに増分する", () => {
    const received: { seq: number }[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    emitAtlasEvent({ type: "capture_added", title: "one" });
    emitAtlasEvent({ type: "capture_added", title: "two" });
    unsubscribe();
    assert.equal(received.length, 2);
    assert.ok(received[1].seq > received[0].seq);
  });
});
