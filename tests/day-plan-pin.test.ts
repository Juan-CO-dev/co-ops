/**
 * Nav PR 5, group 4 (plan r4, 5.4): the closing checklist pin. Before the mid-day trigger it is the SECOND item, compact,
 * for every viewer with at least two items; from the (effective) trigger it is FIRST, full size, above an urgent cutoff
 * 15 minutes away, until it is finished; once finished it sorts into done like anything else. Next up is never the
 * full-size pin.
 */
import { describe, expect, it } from "vitest";
import { applyLens, buildDay, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import { ALL_VIEWERS, ANA, forViewer, hm, item, itemsText, PLAN_DATE } from "./fixtures/day-plan/build";
import { NO_EVENTS, P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";

const sweep = (facts: (m: number) => ShopFacts, check: (v: DayViewer, m: number, plan: ReturnType<typeof applyLens>, triggered: boolean) => void) => {
  for (let m = 0; m < 1440; m += 5) {
    const f = facts(m);
    const day = buildDay(PLAN_DATE, m, f);
    for (const v of Object.values(ALL_VIEWERS)) check(v, m, applyLens(day, v, forViewer(f, P_STATION_BY_USER, v.userId)), day.triggered);
  }
};

describe("the closing checklist pin", () => {
  it.each([["the event timeline", (m: number) => pStreet(m)], ["no events (the clock fallback)", (m: number) => pStreet(m, { timeline: NO_EVENTS })]])(
    "%s: second and compact before the trigger, first and full from it, in done once finished; Next up never the full pin", (_l, facts) => {
      sweep(facts, (v, m, plan, triggered) => {
        const idx = plan.items.findIndex((i) => i.id === "closing");
        const closing = plan.items[idx]!;
        const label = `${v.role} ${v.userId} ${m}`;
        if (closing.band === "done") {
          expect(closing.pin, label).toBeUndefined();
        } else if (triggered) {
          expect([idx, closing.pin], label).toEqual([0, "full"]);
        } else {
          expect([idx, closing.pin], label).toEqual([plan.items.length >= 2 ? 1 : 0, "compact"]);
        }
        expect(closing.band, label).not.toBe("urgent");
        if (plan.nextUp.kind === "item") expect(plan.items[plan.nextUp.index]!.pin, label).not.toBe("full");
        if (plan.nextUp.kind === "nothing_due" && plan.nextUp.nextIndex !== null) expect(plan.items[plan.nextUp.nextIndex]!.pin, label).not.toBe("full");
      });
    });

  it("from the trigger the pin sits above an urgent cutoff 15 minutes away, and the urgent row is Next up", () => {
    const f = forViewer(pStreet(hm("13:45")), P_STATION_BY_USER, ANA.userId);
    const plan = applyLens(buildDay(PLAN_DATE, hm("13:45"), f), ANA, f);
    expect(itemsText(plan).slice(0, 2)).toEqual(["closing upcoming/full", "ordering urgent"]);
    expect(item(plan, "ordering").reasons[0]!.params.minutes).toEqual({ t: "count", v: 15 });
    expect(plan.nextUp).toEqual({ kind: "item", index: 1 });
  });

  it("finished at 21:40, the closing checklist moves into done with who and when", () => {
    const f = forViewer(pStreet(hm("21:45")), P_STATION_BY_USER, ANA.userId);
    const plan = applyLens(buildDay(PLAN_DATE, hm("21:45"), f), ANA, f);
    expect(plan.phase.id).toBe("closed");
    const closing = item(plan, "closing");
    expect(closing).toMatchObject({ band: "done", done: { byName: "Ana", autoFinalized: false } });
    expect(closing.pin).toBeUndefined();
  });
});

// Nav PR 6, the two other declared engine edits (plan r3, 8.1 items 10 and 11, engine halves).
describe("nav PR 6 engine edits", () => {
  it("ruling 7: a PM report with autoFinalized renders done.autoFinalized true; without the field, false; cash too", () => {
    const at = hm("21:30");
    const base = pStreet(at);
    const done = { forDate: PLAN_DATE, state: "submitted" as const, at: "2026-11-19T02:00:00.000Z", byName: null };
    const auto = buildDay(PLAN_DATE, at, { ...base, pm: { kind: "ok", value: { ...done, autoFinalized: true } }, cash: { kind: "ok", value: done } });
    expect(auto.items.find((i) => i.id === "pm_report")!.done).toEqual({ at: done.at, byName: null, autoFinalized: true });
    expect(auto.items.find((i) => i.id === "cash")!.done).toEqual({ at: done.at, byName: null, autoFinalized: false });
    const plain = buildDay(PLAN_DATE, at, { ...base, pm: { kind: "ok", value: done } });
    expect(plain.items.find((i) => i.id === "pm_report")!.done?.autoFinalized).toBe(false);
  });

  it("SCH: the engine reads the day's start from hours.dayPrepStartQ (absent = the saved start; scheduled = the schedule's; unknown = none)", () => {
    const at = (t: string, starts: Record<string, { kind: "scheduled"; q: number } | { kind: "unknown" }>) => {
      const base = pStreet(hm(t));
      if (base.hours.kind !== "ok") throw new Error("hours");
      const moved: ShopFacts = { ...base, hours: { kind: "ok", value: { ...base.hours.value, dayPrepStartQ: starts } } };
      return buildDay(PLAN_DATE, hm(t), moved);
    };
    expect(at("06:30", {})).toEqual(buildDay(PLAN_DATE, hm("06:30"), pStreet(hm("06:30"))));
    expect(at("06:30", {}).items.find((i) => i.id === "opening")).toMatchObject({ band: "upcoming", at: hm("07:00") });
    expect(at("06:30", { [PLAN_DATE]: { kind: "scheduled", q: 24 } }).phase.id).toBe("opening_check");
    expect(at("06:30", { [PLAN_DATE]: { kind: "unknown" } }).notes.map((n) => n.reason.key)).toContain("day.fail.day_start");
  });
});
