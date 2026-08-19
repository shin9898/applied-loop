import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stageForShiren,
  stageForNikki,
  stageForUkebako,
  stageForDougu,
  stageForJunbi,
  flagsRaisedFromEvidence,
  doguIsBad,
  CTA_KIND_TO_TERRITORY,
} from "./atlas-territory";

describe("stageForShiren", () => {
  it("0件はstage0", () => assert.equal(stageForShiren(0), 0));
  it("1〜9件はstage1", () => {
    assert.equal(stageForShiren(1), 1);
    assert.equal(stageForShiren(9), 1);
  });
  it("10〜29件はstage2", () => {
    assert.equal(stageForShiren(10), 2);
    assert.equal(stageForShiren(29), 2);
  });
  it("30件以上はstage3", () => assert.equal(stageForShiren(30), 3));
});

describe("stageForNikki", () => {
  it("0冊はstage0", () => assert.equal(stageForNikki(0), 0));
  it("1〜6冊はstage1", () => {
    assert.equal(stageForNikki(1), 1);
    assert.equal(stageForNikki(6), 1);
  });
  it("7〜29冊はstage2", () => {
    assert.equal(stageForNikki(7), 2);
    assert.equal(stageForNikki(29), 2);
  });
  it("30冊以上はstage3", () => assert.equal(stageForNikki(30), 3));
});

describe("stageForUkebako", () => {
  it("0件はstage0", () => assert.equal(stageForUkebako(0), 0));
  it("1〜9件はstage1", () => {
    assert.equal(stageForUkebako(1), 1);
    assert.equal(stageForUkebako(9), 1);
  });
  it("10〜39件はstage2", () => {
    assert.equal(stageForUkebako(10), 2);
    assert.equal(stageForUkebako(39), 2);
  });
  it("40件以上はstage3", () => assert.equal(stageForUkebako(40), 3));
});

describe("stageForDougu", () => {
  it("0件はstage0", () => assert.equal(stageForDougu(0), 0));
  it("1件はstage1", () => assert.equal(stageForDougu(1), 1));
  it("2〜3件はstage2", () => {
    assert.equal(stageForDougu(2), 2);
    assert.equal(stageForDougu(3), 2);
  });
  it("4件以上はstage3", () => assert.equal(stageForDougu(4), 3));
});

describe("stageForJunbi", () => {
  it("何もOKでなければstage0", () => {
    assert.equal(
      stageForJunbi({ anyOk: false, essentialsReady: false, allOk: false }),
      0,
    );
  });
  it("一部OKだが必須未完了ならstage1", () => {
    assert.equal(
      stageForJunbi({ anyOk: true, essentialsReady: false, allOk: false }),
      1,
    );
  });
  it("必須完了だが全完了でなければstage2", () => {
    assert.equal(
      stageForJunbi({ anyOk: true, essentialsReady: true, allOk: false }),
      2,
    );
  });
  it("全完了ならstage3", () => {
    assert.equal(
      stageForJunbi({ anyOk: true, essentialsReady: true, allOk: true }),
      3,
    );
  });
});

describe("flagsRaisedFromEvidence", () => {
  it("全て0件なら0", () => {
    assert.equal(
      flagsRaisedFromEvidence({ entries: 0, applications: 0, resolvedMisconceptions: 0 }),
      0,
    );
  });
  it("1種類だけ件数ありなら1", () => {
    assert.equal(
      flagsRaisedFromEvidence({ entries: 3, applications: 0, resolvedMisconceptions: 0 }),
      1,
    );
  });
  it("2種類件数ありなら2", () => {
    assert.equal(
      flagsRaisedFromEvidence({ entries: 3, applications: 1, resolvedMisconceptions: 0 }),
      2,
    );
  });
  it("3種類とも件数ありなら3", () => {
    assert.equal(
      flagsRaisedFromEvidence({ entries: 3, applications: 1, resolvedMisconceptions: 2 }),
      3,
    );
  });
});

describe("doguIsBad", () => {
  it("weakRepoが無ければfalse", () => assert.equal(doguIsBad(undefined), false));
  it("データ不足フラグが立っていればfalse（誤検知回避）", () => {
    assert.equal(
      doguIsBad({ thisWeekRate: 0.05, insufficientThisWeek: true }),
      false,
    );
  });
  it("30%未満かつデータ十分ならtrue", () => {
    assert.equal(
      doguIsBad({ thisWeekRate: 0.12, insufficientThisWeek: false }),
      true,
    );
  });
  it("30%以上ならfalse", () => {
    assert.equal(
      doguIsBad({ thisWeekRate: 0.5, insufficientThisWeek: false }),
      false,
    );
  });
});

describe("CTA_KIND_TO_TERRITORY", () => {
  it("5種のCTA kindすべてに領土が割り当たっている", () => {
    assert.equal(CTA_KIND_TO_TERRITORY.setup, "junbi");
    assert.equal(CTA_KIND_TO_TERRITORY.textbook, "nikki");
    assert.equal(CTA_KIND_TO_TERRITORY.fight, "shiren");
    assert.equal(CTA_KIND_TO_TERRITORY.hook, "dougu");
    assert.equal(CTA_KIND_TO_TERRITORY.wait, "nikki");
  });
});
