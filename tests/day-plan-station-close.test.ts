/**
 * Nav PR 5, group 3 (plan r4, 5.1-5.3 and 12), REVERSED by Juan's station-close ruling (2026-11-21): a station closes at
 * its real close event, or once its usual close time passes; a station closed only by the clock is PAST DUE. The clock
 * moves the phase, Mid-day prep and the past-due prompts, and never makes closing work urgent.
 */
import { describe, expect, it } from "vitest";
import { applyLens, buildDay, effectiveClose, normalizeStations, type DayModel, type DayStation, type ShopFacts } from "@/lib/day-plan-shared";
import { ANA, forViewer, hm, iso, item, itemsText, LUIS, PLAN_DATE, phaseText, reasonText, ROSA, station } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { NO_EVENTS, P_STATION_BY_USER, pStreet, type PStreetOptions } from "./fixtures/day-plan/p-street";
import { lateClose } from "./fixtures/day-plan/p-street-late-close";

const none = (extra: PStreetOptions = {}): PStreetOptions => ({ timeline: NO_EVENTS, ...extra });
const day = (min: number, facts: ShopFacts) => buildDay(PLAN_DATE, min, facts);
const kh = (min: number, facts: ShopFacts) => applyLens(day(min, facts), ANA, forViewer(facts, P_STATION_BY_USER, ANA.userId));
const crew = (v: typeof ROSA, min: number, facts: ShopFacts) => applyLens(day(min, facts), v, forViewer(facts, P_STATION_BY_USER, v.userId));
const mapStations = (f: ShopFacts, fn: (s: DayStation) => DayStation): ShopFacts =>
  f.stations.kind !== "ok" ? f : { ...f, stations: { kind: "ok", value: { ...f.stations.value, stations: f.stations.value.stations.map(fn) } } };
const phaseChanges = (facts: (m: number) => ShopFacts, from = 0, to = 1439) => {
  const out: [number, string][] = [];
  let last = "";
  for (let m = from; m <= to; m++) {
    const p = day(m, facts(m)).phase;
    const label = `${p.id}/${p.decidedBy}`;
    if (label !== last) out.push([m, label]);
    last = label;
  }
  return out;
};

describe("the boundary and the one comparison", () => {
  const raw = [
    station({ id: "late", name: "Late", sort: 1, floor: true, usuallyClosesAt: "20:00:00" }),
    station({ id: "none", name: "None", sort: 2, floor: true }),
    station({ id: "early", name: "Early", sort: 4, floor: true, usuallyClosesAt: "13:30:00" }),
    station({ id: "tie", name: "Tie", sort: 3, floor: true, usuallyClosesAt: "13:30:00" }),
  ];
  const [late, none, early, tie] = normalizeStations(raw);

  it("normalizeStations: the raw time is gone; an opaque usual value and an ordinal rank by time, ties by sort", () => {
    expect(Object.keys(late!)).not.toContain("usuallyClosesAt");
    expect([late!.usualRank, none!.usualRank, early!.usualRank, tie!.usualRank]).toEqual([2, null, 1, 0]);
    expect(early!.usual?.wall).toBe("13:30:00");
    expect(none!.usual).toBeNull();
  });

  it("effectiveClose: the usual time once reached; no usual time means event only; an event always wins, even later", () => {
    expect(effectiveClose(early!, hm("13:29"), PLAN_DATE)).toBeNull();
    expect(effectiveClose(early!, hm("13:30"), PLAN_DATE)).toEqual({ min: hm("13:30"), iso: null, by: "clock" });
    expect(effectiveClose(none!, hm("23:59"), PLAN_DATE)).toBeNull();
    const at = iso(PLAN_DATE, "14:05");
    expect(effectiveClose({ ...early!, closedAt: at }, hm("15:00"), PLAN_DATE)).toEqual({ min: hm("14:05"), iso: at, by: "event" });
    expect(effectiveClose({ ...none!, closedAt: iso(PLAN_DATE, "09:00") }, hm("08:00"), PLAN_DATE)?.by).toBe("event");
  });
});

describe("(a) no events at all: the usual time is the fallback", () => {
  it("Service until 13:29, Mid-day (clock) from 13:30, Night (clock) from 20:00; changes only at clock edges", () => {
    expect(phaseChanges((m) => pStreet(m, none()))).toEqual([
      [0, "before_opening/clock"], [hm("07:00"), "opening_check/clock"], [hm("10:30"), "service/clock"],
      [hm("13:30"), "midday/clock"], [hm("20:00"), "night/clock"],
    ]);
  });

  it("Crunchy Boi past due from 13:30, 3rd Party from 15:30", () => {
    const pd = (m: number) => day(m, pStreet(m, none())).stations.filter((s) => s.pastDue).map((s) => s.name);
    expect(pd(hm("13:29"))).toEqual([]);
    expect(pd(hm("13:30"))).toEqual(["Crunchy Boi Station"]);
    expect(pd(hm("15:29"))).toEqual(["Crunchy Boi Station"]);
    expect(pd(hm("15:30"))).toEqual(["Crunchy Boi Station", "3rd Party Station"]);
    expect(reasonText(day(hm("13:30"), pStreet(hm("13:30"), none())).phase.since)).toBe("since.station_usual{station=Crunchy Boi Station,time=13:30}");
  });
});

describe("(b) an event before the usual time, (c) an event after the clock flip", () => {
  it("(b) Crunchy Boi closed at 13:10: Mid-day from 13:10 by event, no past due, Mid-day prep urgent at 15:10", () => {
    const f = (m: number) => pStreet(m, { close: { crunchy: "13:10" } });
    expect(day(hm("13:09"), f(hm("13:09"))).phase.id).toBe("service");
    const d = day(hm("13:10"), f(hm("13:10")));
    expect(d.phase).toMatchObject({ id: "midday", decidedBy: "event" });
    expect(d.stations.some((s) => s.pastDue)).toBe(false);
    const mid = (m: number) => day(m, { ...f(m), midDay: { kind: "ok", value: { forDate: PLAN_DATE, instances: [] } } }).items.find((i) => i.id === "mid_day_prep")!;
    expect(mid(hm("13:10"))).toMatchObject({ band: "now", at: hm("15:10") });
    expect(mid(hm("15:09")).band).toBe("now");
    expect(mid(hm("15:10")).band).toBe("urgent");
  });

  it("(c) Crunchy Boi closed at 14:05: Mid-day stays; the source, the since line and the urgent minute move to the event", () => {
    const f = (m: number) => ({ ...pStreet(m, { close: { crunchy: "14:05" } }), midDay: { kind: "ok" as const, value: { forDate: PLAN_DATE, instances: [] } } });
    const changes = phaseChanges(f, hm("13:00"), hm("15:00"));
    expect(changes).toEqual([[hm("13:00"), "service/event"], [hm("13:30"), "midday/clock"], [hm("14:05"), "midday/event"]]);
    const before = kh(hm("14:04"), f(hm("14:04")));
    const after = kh(hm("14:05"), f(hm("14:05")));
    expect(reasonText(before.phase.since)).toBe("since.station_usual{station=Crunchy Boi Station,time=13:30}");
    expect(reasonText(after.phase.since)).toBe("since.station_closed{station=Crunchy Boi Station,time=14:05}");
    expect(item(before, "closing").reasons.map(reasonText)).toContain("closing.past_due_one{names=Crunchy Boi Station}");
    expect(item(after, "closing").reasons.map((r) => r.key)).not.toContain("day.reason.closing.past_due_one");
    expect(item(before, "mid_day_prep").at).toBe(hm("15:30"));
    expect(item(after, "mid_day_prep").at).toBe(hm("16:05"));
  });
});

describe("(d) past due", () => {
  it("a clock-closed floor station's card is now (never done) with station.past_due; only a real event makes it done", () => {
    for (const t of ["13:30", "15:00", "20:00", "23:59"]) {
      const card = item(crew(ROSA, hm(t), pStreet(hm(t), none())), "station");
      expect(card.band, t).toBe("now");
      expect(card.reasons.map(reasonText)).toEqual(["station.past_due{station=Crunchy Boi Station,time=13:30}"]);
    }
    expect(item(crew(ROSA, hm("14:20"), pStreet(hm("14:20"), { close: { crunchy: "14:10" } })), "station").band).toBe("done");
  });

  it("KH+ get closing.past_due_one/_other with the names; crew get no such line", () => {
    const at1545 = pStreet(hm("15:45"), none());
    expect(item(kh(hm("15:45"), at1545), "closing").reasons.map(reasonText))
      .toEqual(["closing.next{station=Walk Ins Station,time=20:00}", "closing.past_due_other{n=2,names=Crunchy Boi Station+3rd Party Station}"]);
    expect(item(crew(LUIS, hm("15:45"), at1545), "closing").reasons.map(reasonText)).toEqual(["closing.next{station=Walk Ins Station,time=20:00}"]);
  });

  it("a station that is not a floor station is never past due, whatever its usual time", () => {
    const f = pStreet(hm("15:00"), none({ usual: { prepFridge: "12:00:00" } }));
    const d = day(hm("15:00"), f);
    expect(d.stations.find((s) => s.name === "Prep Fridge")).toMatchObject({ pastDue: false, close: { by: "clock" } });
    expect(JSON.stringify(d.closing.reasons)).not.toContain("Prep Fridge");
  });
});

describe("(e) closing work is never urgent by any clock (S2 sizing Q4)", () => {
  const VARIANTS: [string, (m: number) => ShopFacts][] = [
    ["P Street", (m) => pStreet(m)], ["P Street, no events", (m) => pStreet(m, none())], ["P Street heavy", (m) => pStreet(m, { heavy: true })],
    ["night before", (m) => pStreet(m, { nightBefore: true })], ["Capitol Hill", (m) => capitolHill(m)], ["Capitol Hill, no events", (m) => capitolHill(m, { events: false })],
    ["live-data", (m) => lateClose(m)], ["live-data, no mid-day prep", (m) => lateClose(m, { midDaySubmitted: false, closingManagerFloor: true })],
  ];
  it.each(VARIANTS)("%s: 0:00 to 23:59, the closing checklist, AM prep list, cash deposit and PM report are never urgent", (_l, facts) => {
    for (let m = 0; m < 1440; m += 5) {
      const d: DayModel = day(m, facts(m));
      expect(d.closing.band, `closing ${m}`).not.toBe("urgent");
      for (const i of d.items) if (["am_prep", "cash", "pm_report"].includes(i.id)) expect(i.band, `${i.id} ${m}`).not.toBe("urgent");
    }
  });
});

describe("(f) no usual time closes by event only; (g) no plan-date station facts, no fallback", () => {
  it("(f) a floor station with no usual time: without its event Night never starts", () => {
    const f = (m: number) => pStreet(m, none({ usual: { expo: null } }));
    for (let m = 0; m < 1440; m += 5) expect(day(m, f(m)).phase.id).not.toBe("night");
    expect(day(hm("23:00"), pStreet(hm("23:00"), none({ usual: { expo: null }, close: { expo: "22:00" } }))).phase).toMatchObject({ id: "night", decidedBy: "clock" });
  });

  it.each([
    ["failed", { kind: "failed" }], ["another_day", { kind: "another_day", stationDate: "2026-11-17" }], ["not_shown", { kind: "not_shown" }],
  ] as const)("(g) stations %s: no Mid-day, no Night, no past due, whatever the clock", (_l, stations) => {
    for (let m = 0; m < 1440; m += 5) {
      const d = day(m, { ...pStreet(m, none()), stations });
      expect(["midday", "night"]).not.toContain(d.phase.id);
      expect(d.stations).toEqual([]);
      expect(d.closing.reasons.map((r) => r.key)).toEqual(["day.reason.midday.waiting_first"]);
    }
  });
});

describe("(h) the trigger default (rulings B8)", () => {
  const unmark = (f: ShopFacts) => mapStations(f, (s) => ({ ...s, startsMidDay: false }));

  it("the marked station starts Mid-day", () => {
    const f = mapStations(pStreet(hm("14:00"), none({ usual: { crunchy: "16:00:00" } })), (s) => s);
    expect(day(hm("15:35"), f).phase.id).toBe("service"); // 3rd Party passed 15:30, but Crunchy Boi is marked
    expect(reasonText(day(hm("16:00"), f).phase.since)).toBe("since.station_usual{station=Crunchy Boi Station,time=16:00}");
  });

  it("no marked station: the earliest usual time, ties by sort; another station's earlier event does not start Mid-day", () => {
    const f = (m: number) => unmark(pStreet(m, none({ usual: { third: "13:30:00" }, close: { walk: "12:00" } })));
    expect(day(hm("12:30"), f(hm("12:30"))).phase.id).toBe("service");
    expect(reasonText(day(hm("13:30"), f(hm("13:30"))).phase.since)).toBe("since.station_usual{station=Crunchy Boi Station,time=13:30}");
    const swapped = (m: number) => mapStations(f(m), (s) => (s.name.startsWith("3rd") ? { ...s, sort: 0 } : s));
    expect(reasonText(day(hm("13:30"), swapped(hm("13:30"))).phase.since)).toBe("since.station_usual{station=3rd Party Station,time=13:30}");
  });

  it("no marked station and no usual times: the first floor station to close by event, waiting_first before it", () => {
    const f = (m: number) => unmark(pStreet(m, none({ usual: { crunchy: null, third: null, walk: null, expo: null }, close: { third: "12:40", crunchy: "13:00" } })));
    const at = (t: string) => day(hm(t), f(hm(t)));
    expect(at("12:00").items.find((i) => i.id === "mid_day_prep")!.reasons.map(reasonText)).toEqual(["midday.waiting_first{}"]);
    expect(at("12:00").closing.reasons.map(reasonText)).toEqual(["midday.waiting_first{}"]);
    expect(reasonText(at("12:40").phase.since)).toBe("since.station_closed{station=3rd Party Station,time=12:40}");
  });
});

describe("(i) the live-data day (11.3)", () => {
  const plan = (t: string, opts: Parameters<typeof lateClose>[1] = {}, v = ANA) => {
    const f = forViewer(lateClose(hm(t), opts), P_STATION_BY_USER, v.userId);
    return applyLens(buildDay(PLAN_DATE, hm(t), f), v, f);
  };

  it("13:35: Service by event; ordering urgent; the closing checklist pinned second with Crunchy Boi's 14:00 line", () => {
    const p = plan("13:35");
    expect(phaseText(p)).toBe("service (event) since.opening_done{time=09:50}");
    expect(itemsText(p).slice(0, 2)).toEqual(["ordering urgent", "closing upcoming/compact"]);
    expect(item(p, "closing").reasons.map(reasonText)).toEqual(["midday.waiting{station=Crunchy Boi Station,time=14:00}"]);
    expect(item(p, "mid_day_prep").reasons.map(reasonText)).toEqual(["midday.waiting{station=Crunchy Boi Station,time=14:00}"]);
    expect(item(plan("13:35", {}, ROSA), "station").reasons.map(reasonText)).toEqual(["station.open{}"]);
  });

  it("14:00: Mid-day by the clock; the full pin names 3rd Party (no time) and Crunchy Boi past due; Mid-day prep now at 16:00", () => {
    const p = plan("14:00", { midDaySubmitted: false });
    expect(phaseText(p)).toBe("midday (clock) since.station_usual{station=Crunchy Boi Station,time=14:00}");
    expect(itemsText(p)[0]).toBe("closing upcoming/full");
    expect(item(p, "closing").reasons.map(reasonText)).toEqual(["closing.next_no_time{station=3rd Party Station}", "closing.past_due_one{names=Crunchy Boi Station}"]);
    expect(item(p, "mid_day_prep")).toMatchObject({ band: "now", at: hm("16:00") });
    expect(item(p, "mid_day_prep").reasons.map(reasonText)).toEqual(["midday.clock{station=Crunchy Boi Station,time=14:00}"]);
    expect(item(plan("14:00", {}, ROSA), "station").reasons.map(reasonText)).toEqual(["station.past_due{station=Crunchy Boi Station,time=14:00}"]);
  });

  it.each(["15:00", "18:00", "20:00"])("%s: the same pin and past-due line; Mid-day prep done (or urgent, late_usual); night reports never urgent", (t) => {
    const p = plan(t);
    expect(phaseText(p)).toBe("midday (clock) since.station_usual{station=Crunchy Boi Station,time=14:00}");
    expect(item(p, "closing").reasons.map(reasonText)).toContain("closing.past_due_one{names=Crunchy Boi Station}");
    expect(item(p, "mid_day_prep").band).toBe("done");
    const late = plan(t, { midDaySubmitted: false });
    const lateFrom16 = hm(t) >= hm("16:00");
    expect(item(late, "mid_day_prep").band).toBe(lateFrom16 ? "urgent" : "now");
    expect(item(late, "mid_day_prep").reasons.map((r) => r.key)).toEqual([lateFrom16 ? "day.reason.midday.late_usual" : "day.reason.midday.clock"]);
    for (const id of ["am_prep", "cash", "pm_report"] as const) expect(item(p, id).band).toBe("upcoming");
    expect(item(plan(t, {}, ROSA), "station").reasons[0]!.key).toBe("day.reason.station.past_due");
    expect(item(p, "ordering").band).toBe(hm(t) >= hm("19:00") ? "now" : "upcoming");
  });

  it("20:16: Mid-day by event; the past-due line is gone; next is Expo; ordering urgent from 20:30; Rosa's card done", () => {
    const p = plan("20:16");
    expect(phaseText(p)).toBe("midday (event) since.station_closed{station=Crunchy Boi Station,time=20:15}");
    expect(item(p, "closing").reasons.map(reasonText)).toEqual(["closing.next_no_time{station=Expo Station}"]);
    expect(item(p, "ordering").band).toBe("now");
    expect(item(plan("20:30"), "ordering").band).toBe("urgent");
    expect(item(plan("20:16", {}, ROSA), "station").reasons.map(reasonText)).toEqual(["station.closed{station=Crunchy Boi Station,time=20:15}"]);
  });

  it("21:25: Night by event when Closing Manager is not a floor station; still Mid-day when it is", () => {
    const p = plan("21:25");
    expect(phaseText(p)).toBe("night (event) since.last_station{time=21:24}");
    for (const id of ["am_prep", "cash", "pm_report"] as const) expect(item(p, id).band).toBe("now");
    expect(item(p, "closing").reasons[0]!.key).toMatch(/^day\.reason\.closing\.(sections_one|sections_other|wrap_up)$/);
    expect(plan("21:25", { closingManagerFloor: true }).phase.id).toBe("midday");
  });
});

describe("(j) source-agnostic, (k) no heavy-day shift", () => {
  it("(j) the same closedAt, tagged as a tap or as a section completion, gives identical output", () => {
    const tag = (f: ShopFacts, source: string) => mapStations(f, (s) => ({ ...s, closeSource: source }) as DayStation);
    const f = pStreet(hm("15:00"));
    expect(day(hm("15:00"), tag(f, "explicit tap"))).toEqual(day(hm("15:00"), tag(f, "section complete")));
  });

  it("(k) usual times never shift on the heavy variant", () => {
    expect(phaseChanges((m) => pStreet(m, none({ heavy: true })), hm("10:00"))).toEqual(phaseChanges((m) => pStreet(m, none()), hm("10:00")));
  });
});

describe("(l) mixed-source Night (r3, D6), both orderings", () => {
  const night = (opts: PStreetOptions, t: string) => reasonText(day(hm(t), pStreet(hm(t), opts)).phase.since);

  it("Walk Ins by the clock at 19:00, Expo by event at 20:05 → Night (clock), mixed_one with the event's instant", () => {
    const opts = { usual: { walk: "19:00:00" }, close: { walk: null, expo: "20:05" } };
    expect(day(hm("20:05"), pStreet(hm("20:05"), opts)).phase).toMatchObject({ id: "night", decidedBy: "clock" });
    expect(night(opts, "20:05")).toBe("since.last_station_mixed_one{time=20:05}");
    expect(day(hm("20:05"), pStreet(hm("20:05"), opts)).phase.since?.params.time?.t).toBe("instant");
  });

  it("Walk Ins by event at 19:30, Expo by the clock at 20:00 → Night (clock), mixed_one with Expo's usual time", () => {
    const opts = { close: { walk: "19:30", expo: null } };
    expect(night(opts, "20:00")).toBe("since.last_station_mixed_one{time=20:00}");
    expect(day(hm("20:00"), pStreet(hm("20:00"), opts)).phase.since?.params.time?.t).toBe("usual");
  });

  it("two by the clock → mixed_other with n; all by event → last_station; all by clock → last_station_usual", () => {
    expect(night({ close: { walk: null, expo: null } }, "20:00")).toBe("since.last_station_mixed_other{n=2,time=20:00}");
    expect(night({}, "20:30")).toBe("since.last_station{time=20:05}");
    expect(night(none(), "20:00")).toBe("since.last_station_usual{station=Expo Station,time=20:00}");
  });
});
