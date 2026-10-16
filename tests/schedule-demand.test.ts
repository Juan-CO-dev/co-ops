/**
 * Scheduling Phase 2, Task 4 Steps 2–3 — demand is the pulse's "normal day" (no second forecasting
 * engine, J3): the trailing same-weekday per-hour average, discriminated (r2 P2-6), and the day type
 * in the r2 P2-12 order (override → weekend → forecast thresholds).
 */
import { describe, expect, it } from "vitest";
import { dayTypeFor, forecastDay, forecastWeek, withCatering, type SalesBaselineResult } from "@/lib/scheduling/demand-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS as S } from "@/lib/scheduling/structure-shared";

// Window before asOf 2026-10-19 (Mon): captured Thursdays 4×, Fridays 2×, no Saturday; no Wednesday captured.
const captured = ["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15", "2026-10-09", "2026-10-16", "2026-09-30"];
const ok: SalesBaselineResult = {
  kind: "ok",
  raw: {
    capturedDays: captured,
    hours: [
      { dow: 4, hour: 11, cents: 400000 }, { dow: 4, hour: 12, cents: 800003 }, { dow: 4, hour: -1, cents: 4000 },
      { dow: 5, hour: 12, cents: 100000 },
      { dow: 3, hour: 12, cents: 0 },
    ],
  },
};
const ASOF = "2026-10-19";

describe("forecastDay over a DemandResult", () => {
  it("weeks 4: dayCents = Σ hourly, confidence normal next week; the hour −1 cell is ignored and counted in unknownCents", () => {
    const d = forecastDay(ok, "2026-10-29", ASOF); // Thu of the next ISO week
    if (d.kind !== "ok") throw new Error(d.kind);
    expect(d.weeks).toBe(4);
    expect(d.hourlyCents[11]).toBe(100000);
    expect(d.hourlyCents[12]).toBe(200001);
    expect(d.dayCents).toBe(d.hourlyCents.reduce((a, b) => a + b, 0));
    expect(d.unknownCents).toBe(1000);
    expect(d.confidence).toBe("normal");
    expect(d.basis).toBe("trailing_same_weekday");
    expect(d.weeksAhead).toBe(1);
  });

  it("weeks 2 → thin; weeks 0 for that weekday → no_history; weeks ahead ≥ 2 → further_out", () => {
    const fri = forecastDay(ok, "2026-10-30", ASOF);
    expect(fri).toMatchObject({ kind: "ok", weeks: 2, confidence: "thin" });
    expect(forecastDay(ok, "2026-10-31", ASOF)).toMatchObject({ kind: "no_history", date: "2026-10-31" });
    expect(forecastDay(ok, "2026-11-05", ASOF)).toMatchObject({ kind: "ok", confidence: "further_out", weeksAhead: 2 });
  });

  it("a weekday captured with no sales is ok with zero demand (never no_history)", () => {
    const wed = forecastDay(ok, "2026-10-28", ASOF);
    expect(wed).toMatchObject({ kind: "ok", weeks: 1, dayCents: 0 });
  });

  it("unavailable propagates; forecastWeek returns unavailable, never a flat curve", () => {
    const down: SalesBaselineResult = { kind: "unavailable", cause: "timeout" };
    expect(forecastDay(down, "2026-10-29", ASOF)).toEqual({ kind: "unavailable", cause: "timeout" });
    expect(forecastWeek(down, ["2026-10-26", "2026-10-27"], ASOF)).toEqual({ kind: "unavailable", cause: "timeout" });
  });

  it("forecastWeek: no_history when no needed weekday was captured; ok otherwise (per-day kinds kept)", () => {
    const empty: SalesBaselineResult = { kind: "ok", raw: { capturedDays: [], hours: [] } };
    expect(forecastWeek(empty, ["2026-10-26", "2026-10-27"], ASOF)).toMatchObject({ kind: "no_history", days: [{ kind: "no_history", date: "2026-10-26" }, { kind: "no_history", date: "2026-10-27" }] });
    const wk = forecastWeek(ok, ["2026-10-29", "2026-10-31"], ASOF);
    if (wk.kind !== "ok") throw new Error(wk.kind);
    expect(wk.days.map((d) => d.kind)).toEqual(["ok", "no_history"]);
  });

  it("catering events attach to their date and never change dayCents (named, never summed)", () => {
    const wk = forecastWeek(ok, ["2026-10-29", "2026-10-30"], ASOF);
    const ev = { id: "c-1", date: "2026-10-29", name: "Law firm lunch", headcount: 80, valueCents: 120000, eventQ: 48 };
    const named = withCatering(wk, [ev]);
    if (named.kind !== "ok" || wk.kind !== "ok") throw new Error("kind");
    expect(named.days[0]!.catering).toEqual([ev]);
    expect(named.days[1]!.catering).toEqual([]);
    expect(named.days.map((d) => (d.kind === "ok" ? d.dayCents : null))).toEqual(wk.days.map((d) => (d.kind === "ok" ? d.dayCents : null)));
  });

  it("Astra P2-7: with NO sales history at all, the dates and the booked catering survive (a 50-person event never disappears)", () => {
    const empty: SalesBaselineResult = { kind: "ok", raw: { capturedDays: [], hours: [] } };
    const wk = forecastWeek(empty, ["2026-10-29", "2026-10-30"], ASOF);
    const ev = { id: "c-9", date: "2026-10-30", name: "Office lunch", headcount: 50, valueCents: 90000, eventQ: 48 };
    const named = withCatering(wk, [ev]);
    if (named.kind !== "no_history") throw new Error(named.kind);
    expect(named.days.map((d) => d.date)).toEqual(["2026-10-29", "2026-10-30"]);
    expect(named.days[1]!.catering).toEqual([ev]);
    expect(named.days[0]!.catering).toEqual([]);
    expect(named.days.every((d) => d.kind === "no_history")).toBe(true);
  });
});

describe("dayTypeFor (r2 P2-12): override → weekend → forecast thresholds — pinned both directions", () => {
  const busyThu = forecastDay({ kind: "ok", raw: { capturedDays: ["2026-10-15"], hours: [{ dow: 3, hour: 12, cents: 500000 }] } }, "2026-10-21", ASOF);
  it("a Saturday overridden to slow is slow, to busy is busy (the override beats the weekend)", () => {
    expect(dayTypeFor("2026-10-24", { override: { id: "o-1", dayType: "slow" }, structure: S, forecast: null })).toEqual({ dayType: "slow", source: "override", overrideId: "o-1" });
    expect(dayTypeFor("2026-10-24", { override: { id: "o-2", dayType: "busy" }, structure: S, forecast: null })).toEqual({ dayType: "busy", source: "override", overrideId: "o-2" });
  });
  it("a Saturday with auto is weekend whatever the forecast says", () => {
    expect(dayTypeFor("2026-10-24", { override: { id: "o-3", dayType: "auto" }, structure: S, forecast: busyThu })).toEqual({ dayType: "weekend", source: "weekend", overrideId: null });
  });
  it("a Wednesday overridden auto with a forecast above busyAbove is busy; below slowBelow slow; no_history → normal", () => {
    const wed = forecastDay({ kind: "ok", raw: { capturedDays: ["2026-10-14"], hours: [{ dow: 3, hour: 12, cents: 500000 }] } }, "2026-10-21", ASOF);
    expect(dayTypeFor("2026-10-21", { override: { id: "o-4", dayType: "auto" }, structure: S, forecast: wed })).toEqual({ dayType: "busy", source: "forecast", overrideId: null });
    const slow = forecastDay({ kind: "ok", raw: { capturedDays: ["2026-10-14"], hours: [{ dow: 3, hour: 12, cents: 100 }] } }, "2026-10-21", ASOF);
    expect(dayTypeFor("2026-10-21", { override: null, structure: S, forecast: slow }).dayType).toBe("slow");
    expect(dayTypeFor("2026-10-21", { override: null, structure: S, forecast: { kind: "no_history", date: "2026-10-21", weeksAhead: 0, catering: [] } }))
      .toEqual({ dayType: "normal", source: "no_history", overrideId: null });
  });
});
