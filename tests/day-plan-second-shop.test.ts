/**
 * Nav PR 5, group 6 (plan r4, 11.2): Capitol Hill comes out different only because its rows are different. Shipped
 * defaults (`decidedBy: default` for the morning clock phases, the GM nudge with minLevel 7), no marked station (the
 * trigger is Crunchy Boi by earliest usual time), its own earlier events, its own cutoffs. Nothing in the engine names a
 * shop.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planDay, type DayPlan } from "@/lib/day-plan-shared";
import { ANA, GM, hm, item, PLAN_DATE, phaseText, reasonText } from "./fixtures/day-plan/build";
import { C_SHOP, capitolHill } from "./fixtures/day-plan/capitol-hill";
import { P_SHOP, pStreetPlan } from "./fixtures/day-plan/p-street";

const ch = (t: string, opts: Parameters<typeof capitolHill>[1] = {}, v = GM) =>
  planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: capitolHill(hm(t), opts) }) as DayPlan;

describe("Capitol Hill on the shipped defaults", () => {
  it("the morning clock phases say default; the GM sees the hours nudge (minLevel 7), a key holder does not", () => {
    expect(ch("06:00").phase).toMatchObject({ id: "before_opening", decidedBy: "default" });
    expect(ch("07:00").phase).toMatchObject({ id: "opening_check", decidedBy: "default" });
    expect(ch("08:00").phase).toMatchObject({ id: "morning_prep", decidedBy: "event" });
    expect(ch("10:30", { events: false }).phase.id).toBe("service");
    expect(ch("07:00").notes).toEqual([{ reason: { key: "day.note.default_hours", params: {} }, minLevel: 7 }]);
    expect(ch("07:00", {}, ANA).notes).toEqual([]);
  });

  it("with its events: Mid-day at 13:10 by event (before Crunchy Boi's 14:00 usual time)", () => {
    expect(ch("13:09").phase.id).toBe("service");
    expect(phaseText(ch("13:15"))).toBe("midday (event) since.station_closed{station=Crunchy Boi Station,time=13:10}");
    expect(item(ch("13:45"), "mid_day_prep").band).toBe("now");
  });

  it("8:30 PM: Closed, Next up 'closed', while P Street at the same minute is in Night", () => {
    const p = ch("20:30");
    expect(phaseText(p)).toBe("closed (event) since.closing_done{time=19:10}");
    expect(p.nextUp).toEqual({ kind: "closed" });
    expect(pStreetPlan(GM, hm("20:30")).phase.id).toBe("night");
  });

  it("with no events: Mid-day by the clock at 14:00, 3rd Party past due from 15:30, and no Night", () => {
    expect(ch("13:59", { events: false }).phase.id).toBe("service");
    expect(phaseText(ch("14:00", { events: false }))).toBe("midday (clock) since.station_usual{station=Crunchy Boi Station,time=14:00}");
    expect(ch("15:29", { events: false }).stations.filter((s) => s.pastDue).map((s) => s.name)).toEqual(["Crunchy Boi Station"]);
    expect(ch("15:30", { events: false }).stations.filter((s) => s.pastDue).map((s) => s.name)).toEqual(["Crunchy Boi Station", "3rd Party Station"]);
    for (let m = 0; m < 1440; m += 5) expect(ch(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, { events: false }).phase.id).not.toBe("night");
  });

  it("Vendor B's shop row (13:00) governs over the both-shops row (21:00); P Street's own Vendor A row never governs here", () => {
    const p = ch("12:00", { vendorBOrdered: null });
    expect(reasonText(item(p, "ordering").reasons[0]!)).toBe("ordering.soon{vendor=Vendor B,time=13:00,day=2026-11-19}");
    expect(JSON.stringify(item(p, "ordering"))).not.toContain("Vendor A");
  });

  it("a heavy day by TOTAL: three orders of 20", () => {
    expect(ch("08:00").phase.heavy).toBe(true);
    expect(reasonText(item(ch("08:00"), "opening").reasons[1]!)).toBe("heavy.today{guests=60,time=11:30,start=07:00}");
  });
});

describe("nothing in the engine names a shop", () => {
  it("no shop id, code or name literal in the engine's source", () => {
    const src = readFileSync("lib/day-plan-shared.ts", "utf8");
    for (const lit of [P_SHOP.id, C_SHOP.id, "P Street", "Capitol Hill", "Cap Hill", "P St", "Crunchy", "3rd Party", "Walk Ins", "Expo"]) {
      expect(src, lit).not.toMatch(new RegExp(String.raw`\b${lit}\b`));
    }
    expect(src).not.toMatch(/["'`](EM|MEP|P|C)["'`]/);
  });
});
