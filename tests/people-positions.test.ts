import { describe, expect, it } from "vitest";

import type { StationEvent } from "@/lib/assignments-shared";
import {
  closeOpenIntervals,
  overlapMinutes,
  positionTimeline,
  positionsWorked,
  type PositionInterval,
} from "@/lib/people/positions-shared";

const SHOP = "loc-a";
const SHOP_B = "loc-b";
const DAY = "2026-10-14";
const U = "user-1";

let seq = 0;
function ev(p: Partial<StationEvent> & Pick<StationEvent, "kind" | "at">): StationEvent {
  seq += 1;
  return {
    id: `e${seq}`, sequence: String(p.sequence ?? seq), locationId: SHOP, businessDate: DAY, userId: U,
    stationId: null, positionId: null, actorId: null, actorName: null, source: null, ...p,
  } as StationEvent;
}
const claim = (at: string, stationId: string, positionId: string | null, extra: Partial<StationEvent> = {}) =>
  ev({ kind: "claim", at, stationId, positionId, source: "claimed", ...extra });
const move = (at: string, stationId: string, positionId: string | null, extra: Partial<StationEvent> = {}) =>
  ev({ kind: "move", at, stationId, positionId, source: "assigned", ...extra });
const release = (at: string, extra: Partial<StationEvent> = {}) => ev({ kind: "release", at, ...extra });

describe("positionTimeline", () => {
  it("a claim then a move to another position at the same station → two intervals", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-walk", "pos-walk"),
      move("2026-10-14T16:00:00.000Z", "st-walk", "pos-walk-online"),
    ]);
    expect(iv).toEqual([
      { locationId: SHOP, businessDate: DAY, userId: U, stationId: "st-walk", positionId: "pos-walk",
        start: "2026-10-14T14:00:00.000Z", end: "2026-10-14T16:00:00.000Z", source: "claimed" },
      { locationId: SHOP, businessDate: DAY, userId: U, stationId: "st-walk", positionId: "pos-walk-online",
        start: "2026-10-14T16:00:00.000Z", end: null, source: "assigned" },
    ]);
  });

  it("a break release ends the interval and the next claim opens a new one", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x"),
      release("2026-10-14T16:00:00.000Z", { releaseReason: "on_break" }),
      claim("2026-10-14T16:30:00.000Z", "st-x", "pos-x"),
    ]);
    expect(iv.map((i) => [i.start, i.end])).toEqual([
      ["2026-10-14T14:00:00.000Z", "2026-10-14T16:00:00.000Z"],
      ["2026-10-14T16:30:00.000Z", null],
    ]);
  });

  it("a clocked_out release whose effective_at is earlier than at ends at effective_at", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x"),
      release("2026-10-14T22:00:00.000Z", { releaseReason: "clocked_out", effectiveAt: "2026-10-14T21:10:00.000Z" }),
    ]);
    expect(iv).toHaveLength(1);
    expect(iv[0]!.end).toBe("2026-10-14T21:10:00.000Z");
  });

  it("an effective_at earlier than the interval's own start never yields a negative interval", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x"),
      release("2026-10-14T15:00:00.000Z", { releaseReason: "clocked_out", effectiveAt: "2026-10-14T13:00:00.000Z" }),
    ]);
    expect(iv[0]!.end).toBe("2026-10-14T14:00:00.000Z");
  });

  it("sequence order wins over at ties and over at order", () => {
    // Same `at`; the sequence says the move came second.
    const a = claim("2026-10-14T14:00:00.000Z", "st-x", "pos-1", { sequence: "10" });
    const b = move("2026-10-14T14:00:00.000Z", "st-x", "pos-2", { sequence: "11" });
    const iv = positionTimeline([b, a]);
    expect(iv.map((i) => i.positionId)).toEqual(["pos-1", "pos-2"]);
    expect(iv[0]!.end).toBe("2026-10-14T14:00:00.000Z");
    expect(iv[1]!.end).toBeNull();
  });

  it("intervals never cross (shop, day): another shop or another day never closes an open interval", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x"),
      claim("2026-10-14T15:00:00.000Z", "st-y", "pos-y", { locationId: SHOP_B }),
      claim("2026-10-15T14:00:00.000Z", "st-x", "pos-x", { businessDate: "2026-10-15" }),
    ]);
    expect(iv).toHaveLength(3);
    for (const i of iv) expect(i.end).toBeNull();
  });

  it("different people at the same shop and day do not close each other's intervals", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x"),
      claim("2026-10-14T15:00:00.000Z", "st-y", "pos-y", { userId: "user-2" }),
    ]);
    expect(iv.every((i) => i.end === null)).toBe(true);
  });

  it("a 0217-era event without a position stays positionId null, never guessed", () => {
    const iv = positionTimeline([ev({ kind: "assign", at: "2026-10-14T14:00:00.000Z", stationId: "st-x", source: "assigned", positionId: undefined })]);
    expect(iv[0]!.positionId).toBeNull();
  });

  it("a move with an effective_at starts the next interval where the previous one ended", () => {
    const iv = positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-x", "pos-1"),
      move("2026-10-14T16:05:00.000Z", "st-x", "pos-2", { effectiveAt: "2026-10-14T16:00:00.000Z" }),
    ]);
    expect(iv[0]!.end).toBe("2026-10-14T16:00:00.000Z");
    expect(iv[1]!.start).toBe("2026-10-14T16:00:00.000Z");
  });

  it("is pure: the input array is not reordered or mutated", () => {
    const events = [move("2026-10-14T16:00:00.000Z", "st-x", "pos-2", { sequence: "99" }), claim("2026-10-14T14:00:00.000Z", "st-x", "pos-1", { sequence: "98" })];
    const before = JSON.stringify(events);
    positionTimeline(events);
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("closeOpenIntervals", () => {
  const base: PositionInterval = { locationId: SHOP, businessDate: DAY, userId: U, stationId: "st", positionId: "p",
    start: "2026-10-14T14:00:00.000Z", end: null, source: "claimed" };

  it("clips an open interval to closeAt", () => {
    expect(closeOpenIntervals([base], "2026-10-15T03:00:00.000Z")[0]!.end).toBe("2026-10-15T03:00:00.000Z");
  });
  it("never ends an interval before its start (a closeAt before the start gives zero length)", () => {
    expect(closeOpenIntervals([base], "2026-10-14T13:00:00.000Z")[0]!.end).toBe(base.start);
  });
  it("leaves closed intervals alone and does not mutate the input", () => {
    const closed = { ...base, end: "2026-10-14T15:00:00.000Z" };
    const out = closeOpenIntervals([closed, base], "2026-10-15T03:00:00.000Z");
    expect(out[0]).toEqual(closed);
    expect(base.end).toBeNull();
  });
});

describe("overlapMinutes", () => {
  it("is 0 for disjoint and touching ranges", () => {
    expect(overlapMinutes({ start: "2026-10-14T14:00:00Z", end: "2026-10-14T15:00:00Z" }, { start: "2026-10-14T16:00:00Z", end: "2026-10-14T17:00:00Z" })).toBe(0);
    expect(overlapMinutes({ start: "2026-10-14T14:00:00Z", end: "2026-10-14T15:00:00Z" }, { start: "2026-10-14T15:00:00Z", end: "2026-10-14T17:00:00Z" })).toBe(0);
  });
  it("is the shared minutes for overlapping and nested ranges, symmetric", () => {
    const a = { start: "2026-10-14T14:00:00Z", end: "2026-10-14T16:00:00Z" };
    const b = { start: "2026-10-14T15:30:00Z", end: "2026-10-14T18:00:00Z" };
    expect(overlapMinutes(a, b)).toBe(30);
    expect(overlapMinutes(b, a)).toBe(30);
    expect(overlapMinutes(a, { start: "2026-10-14T14:30:00Z", end: "2026-10-14T15:00:00Z" })).toBe(30);
  });
  it("counts instants, not wall time, across the DST change (2026-11-01, America/New_York)", () => {
    // 1:00 EDT (05:00Z) → 1:00 EST (06:00Z) reads as zero wall-clock hours but is 60 real minutes.
    const a = { start: "2026-11-01T01:00:00-04:00", end: "2026-11-01T01:00:00-05:00" };
    expect(overlapMinutes(a, a)).toBe(60);
  });
  it("is 0 for an inverted or malformed range, never negative or NaN", () => {
    expect(overlapMinutes({ start: "2026-10-14T16:00:00Z", end: "2026-10-14T14:00:00Z" }, { start: "2026-10-14T13:00:00Z", end: "2026-10-14T17:00:00Z" })).toBe(0);
    expect(overlapMinutes({ start: "nope", end: "2026-10-14T14:00:00Z" }, { start: "2026-10-14T13:00:00Z", end: "2026-10-14T17:00:00Z" })).toBe(0);
  });
});

describe("positionsWorked", () => {
  it("distinct positions with minutes, in first-held order, one person only, null position kept", () => {
    const iv = closeOpenIntervals(positionTimeline([
      claim("2026-10-14T14:00:00.000Z", "st-walk", "pos-walk"),
      move("2026-10-14T15:00:00.000Z", "st-exp", "pos-exp"),
      move("2026-10-14T15:30:00.000Z", "st-walk", "pos-walk"),
      move("2026-10-14T16:00:00.000Z", "st-old", null),
      claim("2026-10-14T14:00:00.000Z", "st-exp", "pos-exp", { userId: "someone-else" }),
    ]), "2026-10-14T16:45:00.000Z");
    expect(positionsWorked(iv, U)).toEqual([
      { positionId: "pos-walk", stationId: "st-walk", minutes: 90 },
      { positionId: "pos-exp", stationId: "st-exp", minutes: 30 },
      { positionId: null, stationId: "st-old", minutes: 45 },
    ]);
  });
  it("an interval still open contributes no minutes (close it first) but still lists the position", () => {
    const iv = positionTimeline([claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x")]);
    expect(positionsWorked(iv, U)).toEqual([{ positionId: "pos-x", stationId: "st-x", minutes: 0 }]);
  });
  it("minutes are whole numbers", () => {
    const iv = closeOpenIntervals(positionTimeline([claim("2026-10-14T14:00:00.000Z", "st-x", "pos-x")]), "2026-10-14T14:10:29.000Z");
    expect(positionsWorked(iv, U)[0]!.minutes).toBe(10);
  });
});
