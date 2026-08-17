import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDungeons } from "./atlas-dungeons";
import type { GateListItem } from "./atlas-gates-list";

function baseItem(
  overrides: Partial<GateListItem> & { id: string },
): GateListItem {
  return {
    title: "しれん",
    question: "しつもん",
    status: "pending",
    system: "cache",
    ...overrides,
  };
}

describe("buildDungeons: retry も sr_review と同様に ぬし（boss）扱いにする", () => {
  it("retry kind は boss: true になる（既存は sr_review のみ）", () => {
    const items: GateListItem[] = [
      baseItem({ id: "g-retry", kind: "retry" }),
    ];
    const [dungeon] = buildDungeons(items);
    const floor = dungeon.floors.find((f) => f.gate.id === "g-retry");
    assert.equal(floor?.boss, true);
  });

  it("sr_review の既存の文言『一度たおしたが また現れた』は変えない（回帰ガード）", () => {
    const items: GateListItem[] = [
      baseItem({ id: "g-sr", kind: "sr_review" }),
    ];
    const [dungeon] = buildDungeons(items);
    const floor = dungeon.floors.find((f) => f.gate.id === "g-sr")!;
    assert.equal(floor.boss, true);
    assert.match(floor.meta, /一度たおしたが また現れた/);
  });

  it("retry は『たおした』ではなく再挑戦の文言を使う（負けたのはプレイヤー側なので）", () => {
    const items: GateListItem[] = [
      baseItem({ id: "g-retry", kind: "retry" }),
    ];
    const [dungeon] = buildDungeons(items);
    const floor = dungeon.floors.find((f) => f.gate.id === "g-retry")!;
    assert.match(floor.meta, /もう一度挑む/);
    assert.doesNotMatch(floor.meta, /一度たおした/);
  });

  it("boss（retry含む）は日付に関わらずフロア順の最深部へ沈む", () => {
    const items: GateListItem[] = [
      baseItem({
        id: "g-retry",
        kind: "retry",
        createdAt: "2026-08-01T00:00:00Z",
      }),
      baseItem({
        id: "g-plain",
        kind: "initial",
        createdAt: "2026-08-10T00:00:00Z",
      }),
    ];
    const [dungeon] = buildDungeons(items);
    assert.equal(dungeon.floors[0].gate.id, "g-plain");
    assert.equal(dungeon.floors[1].gate.id, "g-retry");
  });
});

describe("buildDungeons: しれん重複の見える化（同一 misconceptionId の件数注記）", () => {
  it("同一 misconceptionId の Gate が2件以上あれば、両方の floor meta に件数が出る", () => {
    const items: GateListItem[] = [
      baseItem({ id: "g1", misconceptionId: "m1" }),
      baseItem({ id: "g2", misconceptionId: "m1" }),
    ];
    const [dungeon] = buildDungeons(items);
    const floor1 = dungeon.floors.find((f) => f.gate.id === "g1")!;
    const floor2 = dungeon.floors.find((f) => f.gate.id === "g2")!;
    assert.match(floor1.meta, /計2件/);
    assert.match(floor2.meta, /計2件/);
  });

  it("clear済み・未クリア混在でも同じ misconceptionId なら件数に数える", () => {
    const items: GateListItem[] = [
      baseItem({
        id: "g1",
        status: "passed",
        misconceptionId: "m1",
        gradedAt: "2026-08-04T00:00:00Z",
      }),
      baseItem({ id: "g2", status: "pending", misconceptionId: "m1" }),
    ];
    const [dungeon] = buildDungeons(items);
    const uncleared = dungeon.floors.find((f) => f.gate.id === "g2")!;
    assert.match(uncleared.meta, /計2件/);
  });

  it("misconceptionId が無い、または他と重複していない場合は件数注記を出さない", () => {
    const items: GateListItem[] = [
      baseItem({ id: "g1", misconceptionId: null }),
      baseItem({ id: "g2", misconceptionId: "unique-m" }),
    ];
    const [dungeon] = buildDungeons(items);
    for (const floor of dungeon.floors) {
      assert.doesNotMatch(floor.meta, /計\d+件/);
    }
  });
});
