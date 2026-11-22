/**
 * Nav PR 5, group 1 (plan r4, 11.5 and 12): the worked example AS AMENDED by Juan's station-close ruling. P Street
 * (fixture 11.1) at 7:00, 11:30, 1:35 PM (no event yet: Mid-day by the clock), 1:45 PM, 3:45 PM, 8:00 PM (Night by the
 * clock, mixed sources) and 8:30 PM: the exact item ids in order, bands, reason keys and params, the phase, how it was
 * decided and since when, for the key holder (Ana), GM, catering manager (member shop), MoO and crew (Luis, Rosa). Then
 * the heavy variant.
 */
import { describe, expect, it } from "vitest";
import type { DayPlan } from "@/lib/day-plan-shared";
import { ANA, CATERING_MEMBER, GM, hm, item, itemsText, LUIS, MOO, phaseText, reasonText, ROSA } from "./fixtures/day-plan/build";
import { pStreetPlan } from "./fixtures/day-plan/p-street";

const at = (t: string, v = ANA) => pStreetPlan(v, hm(t));
const reasons = (plan: DayPlan, id: Parameters<typeof item>[1]) => item(plan, id).reasons.map(reasonText);
const holderText = (plan: DayPlan, id: Parameters<typeof item>[1]) => {
  const h = item(plan, id).holder;
  return h.kind === "named" ? `named:${h.firstName}` : h.kind;
};

describe("the key holder's list (Ana), normal day", () => {
  it("7:00 AM: Opening check by the clock; Opening first, the closing checklist pinned second", () => {
    const p = at("07:00");
    expect(phaseText(p)).toBe("opening_check (clock) since.day_start{time=07:00}");
    expect(itemsText(p)).toEqual([
      "opening now", "closing upcoming/compact", "receiving now", "catering_today upcoming", "ordering upcoming",
      "mid_day_prep upcoming", "am_prep upcoming", "cash upcoming", "pm_report upcoming", "counts tool",
    ]);
    expect(item(p, "opening")).toMatchObject({ mine: true, at: hm("10:30") });
    expect(reasons(p, "opening")).toEqual(["opening.start{}"]);
    expect(reasons(p, "closing")).toEqual(["midday.waiting{station=Crunchy Boi Station,time=13:30}"]);
    expect(reasons(p, "receiving")).toEqual(["receiving.expected_one{vendors=Vendor C}"]);
    expect(item(p, "catering_today").at).toBe(hm("08:30"));
    expect(reasons(p, "catering_today")).toEqual(["catering.upcoming_one{guests=25,time=12:00,start=08:30}"]);
    expect(item(p, "ordering").at).toBe(hm("14:00"));
    expect(reasons(p, "ordering")).toEqual(["ordering.upcoming_other{n=2,vendor=Vendor A,time=14:00}"]);
    expect(reasons(p, "mid_day_prep")).toEqual(["midday.waiting{station=Crunchy Boi Station,time=13:30}"]);
    expect(holderText(p, "mid_day_prep")).toBe("named:Luis");
    for (const id of ["am_prep", "cash", "pm_report"] as const) expect(reasons(p, id)).toEqual(["night.waiting{}"]);
    expect(item(p, "cash").mine).toBe(true);
    expect(reasons(p, "counts")).toEqual(["count.tool{}"]);
    expect(p.nextUp).toEqual({ kind: "item", index: 0 });
  });

  it("11:30 AM: Service by event (Opening done 9:50); Catering urgent first", () => {
    const p = at("11:30");
    expect(phaseText(p)).toBe("service (event) since.opening_done{time=09:50}");
    expect(itemsText(p)).toEqual([
      "catering_today urgent", "closing upcoming/compact", "ordering upcoming", "mid_day_prep upcoming",
      "am_prep upcoming", "cash upcoming", "pm_report upcoming", "opening done", "receiving done", "counts tool",
    ]);
    expect(reasons(p, "catering_today")).toEqual(["catering.urgent{time=12:00,guests=25}"]);
    expect(hm("14:00") - hm("11:30")).toBe(150);
    expect(reasons(p, "receiving")).toEqual(["receiving.done_one{}"]);
  });

  it("1:35 PM, no event yet (r2, reversed): Mid-day by the clock, Crunchy Boi past due, Mid-day prep now", () => {
    const p = at("13:35");
    expect(phaseText(p)).toBe("midday (clock) since.station_usual{station=Crunchy Boi Station,time=13:30}");
    expect(itemsText(p)).toEqual([
      "closing upcoming/full", "ordering urgent", "mid_day_prep now", "am_prep upcoming", "cash upcoming", "pm_report upcoming",
      "opening done", "receiving done", "catering_today done", "counts tool",
    ]);
    expect(reasons(p, "closing")).toEqual(["closing.next{station=3rd Party Station,time=15:30}", "closing.past_due_one{names=Crunchy Boi Station}"]);
    expect(reasons(p, "ordering")).toEqual(["ordering.urgent_other{vendor=Vendor A,time=14:00,minutes=25}"]);
    expect(item(p, "mid_day_prep").at).toBe(hm("15:30"));
    expect(reasons(p, "mid_day_prep")).toEqual(["midday.clock{station=Crunchy Boi Station,time=13:30}"]);
    expect(holderText(p, "mid_day_prep")).toBe("named:Luis");
    expect(item(p, "catering_today").done?.at).toBeTruthy();
    expect(p.nextUp).toEqual({ kind: "item", index: 1 });
  });

  it("1:45 PM: Mid-day by event (Crunchy Boi 13:40); no past-due line; Mid-day prep's urgent minute is 15:40", () => {
    const p = at("13:45");
    expect(phaseText(p)).toBe("midday (event) since.station_closed{station=Crunchy Boi Station,time=13:40}");
    expect(itemsText(p).slice(0, 3)).toEqual(["closing upcoming/full", "ordering urgent", "mid_day_prep now"]);
    expect(reasons(p, "closing")).toEqual(["closing.next{station=3rd Party Station,time=15:30}"]);
    expect(reasons(p, "ordering")).toEqual(["ordering.urgent_other{vendor=Vendor A,time=14:00,minutes=15}"]);
    expect(holderText(p, "ordering")).toBe("nobody");
    expect(item(p, "mid_day_prep").at).toBe(hm("15:40"));
    expect(reasons(p, "mid_day_prep")).toEqual(["midday.event{station=Crunchy Boi Station,time=13:40}"]);
  });

  it("3:45 PM: the closing line names Walk Ins and carries 3rd Party's past-due line", () => {
    const p = at("15:45");
    expect(phaseText(p)).toBe("midday (event) since.station_closed{station=Crunchy Boi Station,time=13:40}");
    expect(itemsText(p)).toEqual([
      "closing upcoming/full", "ordering upcoming", "am_prep upcoming", "cash upcoming", "pm_report upcoming",
      "opening done", "receiving done", "catering_today done", "mid_day_prep done", "counts tool",
    ]);
    expect(reasons(p, "closing")).toEqual(["closing.next{station=Walk Ins Station,time=20:00}", "closing.past_due_one{names=3rd Party Station}"]);
    expect(item(p, "ordering").at).toBe(hm("21:00"));
    expect(reasons(p, "ordering")).toEqual(["ordering.left_one{vendor=Vendor B,time=21:00}"]);
    expect(p.nextUp).toEqual({ kind: "nothing_due", nextIndex: 1 });
  });

  it("8:00 PM (r4, E3): Night by the clock with mixed sources, Expo past due", () => {
    const p = at("20:00");
    expect(phaseText(p)).toBe("night (clock) since.last_station_mixed_one{time=20:00}");
    expect(p.phase.since?.params.time?.t).toBe("usual");
    expect(reasons(p, "closing")).toEqual(["closing.sections_other{n=6}", "closing.past_due_one{names=Expo Station}"]);
    for (const id of ["am_prep", "cash", "pm_report"] as const) expect(item(p, id).band).toBe("now");
  });

  it("8:30 PM: Night by event (Expo 20:05)", () => {
    const p = at("20:30");
    expect(phaseText(p)).toBe("night (event) since.last_station{time=20:05}");
    expect(itemsText(p)).toEqual([
      "closing upcoming/full", "ordering urgent", "am_prep now", "cash now", "pm_report now",
      "opening done", "receiving done", "catering_today done", "mid_day_prep done", "counts tool",
    ]);
    expect(reasons(p, "closing")).toEqual(["closing.sections_other{n=4}"]);
    expect(reasons(p, "ordering")).toEqual(["ordering.urgent_other{vendor=Vendor B,time=21:00,minutes=30}"]);
    expect(reasons(p, "am_prep")).toEqual(["amprep.now{}"]);
    expect(reasons(p, "cash")).toEqual(["cash.now{}"]);
    expect(reasons(p, "pm_report")).toEqual(["pm.now{}"]);
    expect(item(p, "cash").mine).toBe(true);
  });
});

describe("the four roles, top of the page", () => {
  it.each(["07:00", "11:30", "13:35", "13:45", "15:45", "20:00", "20:30"])("%s: GM, catering manager and MoO see the key holder's list", (t) => {
    const kh = itemsText(at(t, ANA));
    for (const v of [GM, CATERING_MEMBER, MOO]) {
      expect(itemsText(at(t, v)), v.role).toEqual(kh);
      expect(phaseText(at(t, v))).toBe(phaseText(at(t, ANA)));
    }
  });

  it("the GM sees names, and Ordering 'Nobody yet' with Do it / Assign at 1:35 PM", () => {
    const p = at("13:35", GM);
    expect(reasons(p, "closing")).toContain("closing.past_due_one{names=Crunchy Boi Station}");
    expect(item(p, "ordering")).toMatchObject({ holder: { kind: "nobody" }, actions: ["do", "assign"] });
    expect(item(p, "mid_day_prep").holder).toEqual({ kind: "named", firstName: "Luis" });
    expect(item(at("07:00", GM), "opening").holder).toEqual({ kind: "named", firstName: "Ana" });
    expect(item(at("07:00", GM), "receiving").holder).toEqual({ kind: "nobody" });
  });

  it("the catering manager's catering row is the block (PR 8 draws it first); the pipeline link from shift lead up", () => {
    expect(item(at("11:30", CATERING_MEMBER), "catering_today")).toMatchObject({ placement: "block", destId: "catering-workspace" });
    expect(item(at("11:30", GM), "catering_today")).toMatchObject({ placement: "list", destId: "catering-workspace" });
    expect(item(at("11:30", ANA), "catering_today")).toMatchObject({ placement: "list", destId: "mid-shift", section: "catering" });
  });
});

describe("crew", () => {
  it("Luis (Walk Ins, Mid-day prep): his station card, the closing checklist, Mid-day prep; no past-due line", () => {
    expect(itemsText(at("07:00", LUIS))).toEqual(["station now", "closing upcoming/compact", "mid_day_prep upcoming"]);
    const p135 = at("13:35", LUIS);
    expect(itemsText(p135)).toEqual(["closing upcoming/full", "mid_day_prep now", "station now"]);
    expect(reasons(p135, "closing")).toEqual(["closing.next{station=3rd Party Station,time=15:30}"]);
    expect(reasons(p135, "station")).toEqual(["station.open{}"]);
    expect(p135.nextUp).toEqual({ kind: "item", index: 1 });
    const p145 = at("13:45", LUIS);
    expect(itemsText(p145)).toEqual(["closing upcoming/full", "mid_day_prep now", "station now"]);
    expect(p145.nextUp).toEqual({ kind: "item", index: 1 });
    expect(item(at("19:57", LUIS), "station").band).toBe("now");
    expect(item(at("19:58", LUIS), "station")).toMatchObject({ band: "done", section: "Walk Ins Station" });
  });

  it("Rosa (Crunchy Boi, nothing assigned) at 1:35 PM: the full pin first, then her past-due card; done from 13:40", () => {
    const p = at("13:35", ROSA);
    expect(itemsText(p)).toEqual(["closing upcoming/full", "station now"]);
    expect(reasons(p, "station")).toEqual(["station.past_due{station=Crunchy Boi Station,time=13:30}"]);
    expect(p.nextUp).toEqual({ kind: "item", index: 1 });
    const p140 = at("13:40", ROSA);
    expect(item(p140, "station").band).toBe("done");
    expect(reasons(p140, "station")).toEqual(["station.closed{station=Crunchy Boi Station,time=13:40}"]);
  });
});

describe("the heavy day, with an accepted 5:30 opening on the schedule (PR SCH: the schedule's start)", () => {
  const heavy = (t: string, v = ANA) => pStreetPlan(v, hm(t), { heavy: true, opening: true });

  it("the night before at 8:30 PM: the heads-up, and the AM prep list first among the night reports with the heavy lines", () => {
    const p = pStreetPlan(ANA, hm("20:30"), { nightBefore: true, opening: true });
    expect(reasonText(p.headsUp)).toBe("heavy.tomorrow_other{orders=2,guests=145,start=05:30}");
    const night = itemsText(p).filter((x) => /^(am_prep|cash|pm_report) /.test(x));
    expect(night).toEqual(["am_prep now", "cash now", "pm_report now"]);
    expect(reasons(p, "am_prep")).toEqual(["amprep.now{}", "heavy.tomorrow_other{orders=2,guests=145,start=05:30}", "heavy.flagged_other{n=4}"]);
    expect(item(p, "am_prep").heavy).toBe(true);
  });

  it("5:45 AM: Opening check, heavy (clock: day start 5:30); Opening now first with the heavy lines", () => {
    const p = heavy("05:45");
    expect(phaseText(p)).toBe("opening_check (clock) since.day_start{time=05:30}");
    expect(p.phase.heavy).toBe(true);
    expect(itemsText(p).slice(0, 2)).toEqual(["opening now", "closing upcoming/compact"]);
    expect(reasons(p, "opening")).toEqual([
      "opening.start{}", "heavy.today{guests=145,time=09:00,start=05:30}", "heavy.flagged_other{n=4}",
    ]);
  });

  it("7:00 AM: the check is in at 7:35, so at 7:00 still the first step; at 7:40 the step-two line, still first, still heavy", () => {
    expect(reasons(heavy("07:00"), "opening")[0]).toBe("opening.start{}");
    const p = heavy("07:40");
    expect(itemsText(p)[0]).toBe("opening now");
    expect(reasons(p, "opening")).toEqual(["opening.step2{}", "heavy.today{guests=145,time=09:00,start=05:30}", "heavy.flagged_other{n=4}"]);
  });

  it("8:29 AM now, 8:30 AM urgent (opening.urgent_heavy {9:00}), 9:00 AM still urgent", () => {
    expect(item(heavy("08:29"), "opening").band).toBe("now");
    const p830 = heavy("08:30");
    expect(item(p830, "opening").band).toBe("urgent");
    expect(reasons(p830, "opening")[0]).toBe("opening.urgent_heavy{time=09:00}");
    const p900 = heavy("09:00");
    expect(item(p900, "opening").band).toBe("urgent");
    expect(reasons(p900, "opening")[0]).toBe("opening.late_heavy{time=09:00}");
  });

  it("usual close times are not shifted on the heavy day", () => {
    expect(phaseText(heavy("13:35"))).toBe(phaseText(at("13:35")));
    expect(reasons(heavy("13:35"), "closing")).toEqual(reasons(at("13:35"), "closing"));
  });
});

describe("the heavy day with NO opening (PR SCH, Juan: more people early inside the normal morning)", () => {
  const heavy = (t: string, v = ANA) => pStreetPlan(v, hm(t), { heavy: true });

  it("the night before: the heads-up names the 7:00 start", () => {
    const p = pStreetPlan(ANA, hm("20:30"), { nightBefore: true });
    expect(reasonText(p.headsUp)).toBe("heavy.tomorrow_other{orders=2,guests=145,start=07:00}");
  });

  it("5:45 AM: still before opening; 7:00 the opening check by the clock, with the heavy line at 7:00", () => {
    expect(phaseText(heavy("05:45"))).toBe("before_opening (clock)");
    const p = heavy("07:00");
    expect(phaseText(p)).toBe("opening_check (clock) since.day_start{time=07:00}");
    expect(reasons(p, "opening")).toEqual(["opening.start{}", "heavy.today{guests=145,time=09:00,start=07:00}", "heavy.flagged_other{n=4}"]);
  });

  it("the 9:00 deadline is unchanged: now at 8:29, urgent from 8:30", () => {
    expect(item(heavy("08:29"), "opening").band).toBe("now");
    expect(reasons(heavy("08:30"), "opening")[0]).toBe("opening.urgent_heavy{time=09:00}");
  });
});
