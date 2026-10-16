/**
 * Scheduling Phase 2, Task 4 Step 4 — the closing checklist duration (r2 P2-9, J8): the manager
 * override WINS; otherwise the p75 of (finalize instant − service close) over the last 28 FINALIZED
 * closes with ≥ 8 samples, rounded up to 15 min; otherwise 45. Unfinished instances never count.
 */
import { describe, expect, it } from "vitest";
import { closingDuration, resolveClosingMinutes, type ClosingFinalizationFact } from "@/lib/scheduling/closing-duration-shared";
import { addDays } from "@/lib/scheduling/time-shared";
import { etWallMinutesInstant } from "@/lib/operational-day";

const CLOSE_Q = 80; // 20:00
const at = (date: string, minutesAfterClose: number) => new Date(etWallMinutesInstant(date, CLOSE_Q * 15).getTime() + minutesAfterClose * 60000).toISOString();
const confirmed = (date: string, mins: number, id = `i-${date}`): ClosingFinalizationFact => ({
  instanceId: id, date, shiftStartAt: `${date}T19:00:00Z`, triggeredAt: null, status: "confirmed", confirmedAt: at(date, mins),
  hasFinalConfirmation: true, lastLiveCompletionAt: at(date, mins - 5),
});
const days = (n: number, from = "2026-10-01") => Array.from({ length: n }, (_, i) => addDays(from, i));

describe("closingDuration", () => {
  it("p75 (nearest rank) of finalize − service close, ceil to 15 min, over ≥ 8 finalized days", () => {
    const facts = days(8).map((d, i) => confirmed(d, [30, 35, 40, 41, 42, 44, 50, 70][i]!));
    expect(closingDuration(facts, CLOSE_Q)).toEqual({ minutes: 45, samples: 8, basis: "measured" });
  });

  it("fewer than 8 samples → no measurement", () => {
    expect(closingDuration(days(7).map((d) => confirmed(d, 40)), CLOSE_Q)).toEqual({ minutes: null, samples: 7, basis: "insufficient" });
  });

  it("an UNFINISHED instance with completions is excluded; the same instance once finalized is included", () => {
    const base = days(7).map((d) => confirmed(d, 40));
    const unfinished: ClosingFinalizationFact = { ...confirmed("2026-10-20", 90), status: "open", confirmedAt: null, hasFinalConfirmation: false };
    expect(closingDuration([...base, unfinished], CLOSE_Q).samples).toBe(7);
    const confirmedNoFinal: ClosingFinalizationFact = { ...confirmed("2026-10-20", 90), hasFinalConfirmation: false };
    expect(closingDuration([...base, confirmedNoFinal], CLOSE_Q).samples).toBe(7);
    expect(closingDuration([...base, confirmed("2026-10-20", 90)], CLOSE_Q)).toEqual({ minutes: 45, samples: 8, basis: "measured" });
    const auto: ClosingFinalizationFact = { ...unfinished, status: "auto_finalized", lastLiveCompletionAt: at("2026-10-20", 60) };
    expect(closingDuration([...base, auto], CLOSE_Q)).toEqual({ minutes: 45, samples: 8, basis: "measured" });
  });

  it("the latest instance per day only (stationClosures' rule: shift start, then trigger, then id, descending)", () => {
    const base = days(7).map((d) => confirmed(d, 40));
    const early = { ...confirmed("2026-10-20", 200, "i-a"), shiftStartAt: "2026-10-20T10:00:00Z" };
    const late = { ...confirmed("2026-10-20", 40, "i-b"), shiftStartAt: "2026-10-20T19:00:00Z" };
    expect(closingDuration([...base, early, late], CLOSE_Q)).toEqual({ minutes: 45, samples: 8, basis: "measured" });
    const lateUnfinished = { ...late, status: "open", confirmedAt: null, hasFinalConfirmation: false };
    expect(closingDuration([...base, early, lateUnfinished], CLOSE_Q).samples).toBe(7); // the day's canonical close is unfinished
  });

  it("only the last 28 finalized closes count; a finalize before service close floors at 0", () => {
    const old = days(10, "2026-08-01").map((d) => confirmed(d, 200));
    const recent = days(28, "2026-09-01").map((d) => confirmed(d, 20));
    expect(closingDuration([...old, ...recent], CLOSE_Q)).toEqual({ minutes: 30, samples: 28, basis: "measured" });
    const early = days(8).map((d) => confirmed(d, -30));
    expect(closingDuration(early, CLOSE_Q)).toEqual({ minutes: 0, samples: 8, basis: "measured" });
  });

  it("per-day service close: a map by date", () => {
    const facts = days(8).map((d) => confirmed(d, 40));
    const byDay = Object.fromEntries(days(8).map((d) => [d, CLOSE_Q - 4])); // closes at 19:00 → 100 min after
    expect(closingDuration(facts, byDay).minutes).toBe(105);
  });
});

describe("resolveClosingMinutes: the override WINS (the screen still shows the measurement)", () => {
  const measured = { minutes: 60, samples: 12, basis: "measured" as const };
  it("override → measured (≥ 8) → 45", () => {
    expect(resolveClosingMinutes({ override: 30, measured })).toEqual({ minutes: 30, basis: "override", measuredMinutes: 60 });
    expect(resolveClosingMinutes({ override: null, measured })).toEqual({ minutes: 60, basis: "measured", measuredMinutes: 60 });
    expect(resolveClosingMinutes({ override: null, measured: { minutes: null, samples: 3, basis: "insufficient" } })).toEqual({ minutes: 45, basis: "default", measuredMinutes: null });
    expect(resolveClosingMinutes({ override: 0, measured, fallback: 50 })).toEqual({ minutes: 0, basis: "override", measuredMinutes: 60 });
  });
});
