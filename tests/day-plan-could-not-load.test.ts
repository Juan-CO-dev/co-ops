/**
 * Nav PR 5, group 5 (plan r4, 7): "could not load", per fact. Each fact failed alone, then all together: the failed fact's
 * own item is never done and keeps its place, no item disappears, no empty line ("no cutoff", "no delivery", "no catering",
 * "nothing assigned") is produced from a failure, the notes of section 7 appear, and a failed `hours` gives
 * `decidedBy: default`.
 */
import { describe, expect, it } from "vitest";
import { planDay, type DayPlan, type ItemId, type ShopFacts } from "@/lib/day-plan-shared";
import { ANA, FACT_FIELDS, failed, forViewer, hm, item, LUIS, PLAN_DATE, ROSA, withFailed } from "./fixtures/day-plan/build";
import { P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";

const EMPTY_KEYS = ["day.reason.ordering.none", "day.reason.receiving.none", "day.reason.catering.none", "day.empty.crew"];
const TIMES = ["07:00", "11:30", "13:45", "20:30"];
const plan = (v: typeof ANA, t: string, facts: ShopFacts, planDate = PLAN_DATE): DayPlan => {
  const p = planDay({ planDate, nowMin: hm(t), viewer: v, facts: forViewer(facts, P_STATION_BY_USER, v.userId) });
  if (p.kind !== "shop") throw new Error("shop");
  return p;
};
/** The item each failed fact drives. */
const OWN_ITEM: Partial<Record<(typeof FACT_FIELDS)[number], ItemId>> = {
  opening: "opening", closing: "closing", amPrep: "am_prep", midDay: "mid_day_prep", cash: "cash", pm: "pm_report",
  ordering: "ordering", receiving: "receiving", rhythm: "receiving", cateringToday: "catering_today", counts: "counts",
};
const allKeys = (p: DayPlan) => JSON.stringify(p).match(/day\.[a-z_.]+/g) ?? [];

describe("each fact failed alone", () => {
  for (const field of FACT_FIELDS) {
    it(`${field}`, () => {
      for (const t of TIMES) {
        for (const v of [ANA, LUIS]) {
          const good = plan(v, t, pStreet(hm(t)));
          // A failed myStation cannot name the viewer's station, so only the station card may go; with assignments failed
          // crew keep exactly the closing checklist and their station card (plan 6.3), since no task is known to be theirs.
          const failedFacts = withFailed(forViewer(pStreet(hm(t)), P_STATION_BY_USER, v.userId), [field]);
          const bad = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: failedFacts }) as DayPlan;
          const want = good.items.map((i) => i.id)
            .filter((id) => (field !== "myStation" || id !== "station") && (field !== "assignments" || v.level >= 4 || id === "closing" || id === "station")).sort();
          expect(bad.items.map((i) => i.id).sort(), `${field} ${v.userId} ${t}`).toEqual(want);
          const own = OWN_ITEM[field];
          if (own && bad.items.some((i) => i.id === own)) {
            expect(item(bad, own).state, `${field} ${t}`).toBe("unknown");
            expect(item(bad, own).band, `${field} ${t}`).not.toBe("done");
          }
          for (const k of EMPTY_KEYS) expect(allKeys(bad), `${field} ${v.userId} ${t}`).not.toContain(k);
        }
      }
    });
  }

  it("hours failed: the shipped defaults, decidedBy default, and the note day.fail.shop_day", () => {
    const p = plan(ANA, "07:00", { ...pStreet(hm("07:00")), hours: failed() });
    expect(p).toEqual(plan(ANA, "07:00", withFailed(pStreet(hm("07:00")), ["hours"])));
    expect(p.phase).toMatchObject({ id: "opening_check", decidedBy: "default" });
    expect(item(p, "opening").at).toBe(hm("10:30"));
    expect(p.notes.map((n) => n.reason.key)).toEqual(["day.fail.shop_day"]);
  });

  it("stations failed: no clock fallback, the waiting_first line, the note, the closing checklist still second", () => {
    const p = plan(ANA, "14:00", withFailed(pStreet(hm("14:00")), ["stations"]));
    expect(p.phase.id).toBe("service");
    expect(p.notes.map((n) => n.reason.key)).toEqual(["day.fail.stations"]);
    expect(item(p, "mid_day_prep").reasons.map((r) => r.key)).toEqual(["day.reason.midday.waiting_first"]);
    expect(p.items.findIndex((i) => i.id === "closing")).toBe(1);
    expect(p.stations).toEqual([]);
  });

  it("closing failed never yields Closed; opening failed does not block the Service clock", () => {
    expect(plan(ANA, "22:00", withFailed(pStreet(hm("22:00")), ["closing"])).phase.id).toBe("night");
    expect(plan(ANA, "10:30", withFailed(pStreet(hm("10:30")), ["opening"])).phase).toMatchObject({ id: "service", decidedBy: "clock" });
  });

  it("assignments failed: holders unknown for KH+; crew get the closing checklist and their station card, plus the note", () => {
    const kh = plan(ANA, "13:45", withFailed(pStreet(hm("13:45")), ["assignments"]));
    expect(item(kh, "ordering").holder).toEqual({ kind: "unknown" });
    expect(item(kh, "ordering").actions).toEqual(["do"]);
    expect(kh.notes.map((n) => n.reason.key)).not.toContain("day.fail.assignments");
    const luis = plan(LUIS, "13:45", withFailed(pStreet(hm("13:45")), ["assignments"]));
    expect(luis.items.map((i) => i.id).sort()).toEqual(["closing", "station"]);
    expect(luis.notes.map((n) => n.reason.key)).toEqual(["day.fail.assignments"]);
    expect(luis.empty).toBeNull();
  });

  it("(review r1) myStation failed: crew and KH+ get day.fail.own_station; never with day.fail.all; none when it loaded", () => {
    for (const v of [LUIS, ANA]) {
      for (const t of ["07:00", "13:45", "20:30"]) {
        const facts = { ...forViewer(pStreet(hm(t)), P_STATION_BY_USER, v.userId), myStation: failed<{ stationId: string } | null>() };
        const p = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts }) as DayPlan;
        expect(p.notes.map((n) => n.reason.key), `${v.userId} ${t}`).toContain("day.fail.own_station");
        expect(p.items.map((i) => i.id)).not.toContain("station");
      }
    }
    // Control: loaded, with a station (Luis) or with none (Ana): no note.
    expect(plan(LUIS, "13:45", pStreet(hm("13:45"))).notes.map((n) => n.reason.key)).not.toContain("day.fail.own_station");
    expect(plan(ANA, "13:45", pStreet(hm("13:45"))).notes.map((n) => n.reason.key)).not.toContain("day.fail.own_station");
    // Everything failed: day.fail.all alone covers it.
    const all = planDay({ planDate: PLAN_DATE, nowMin: hm("13:45"), viewer: LUIS, facts: withFailed(pStreet(hm("13:45")), FACT_FIELDS) }) as DayPlan;
    expect(all.notes.map((n) => n.reason.key)).toEqual(["day.fail.all"]);
  });

  it("flaggedLines failed: the flagged line is omitted (never '0 lines'); cateringTomorrow failed: no heads-up", () => {
    const heavy = plan(ANA, "08:00", withFailed(pStreet(hm("08:00"), { heavy: true }), ["flaggedLines"]));
    expect(item(heavy, "opening").reasons.map((r) => r.key)).toEqual(["day.reason.opening.step2", "day.reason.heavy.today"]);
    const nb = plan(ANA, "20:30", withFailed(pStreet(hm("20:30"), { nightBefore: true }), ["cateringTomorrow"]), "2026-11-17");
    expect(nb.headsUp).toBeNull();
    expect(nb.notes).toEqual([]);
  });

  it("rhythm failed: ordering keeps its row without {day}; receiving is unknown", () => {
    const p = plan(ANA, "20:00", withFailed(pStreet(hm("20:00")), ["rhythm"]));
    expect(item(p, "ordering").reasons[0]!.key).toBe("day.reason.ordering.soon_no_day");
    expect(item(p, "receiving").state).toBe("unknown");
  });
});

describe("every fact failed together", () => {
  it.each(TIMES)("%s: every item the viewer may open, in DAY_ORDER, state unknown, under day.fail.all", (t) => {
    const all = withFailed(pStreet(hm(t)), FACT_FIELDS);
    const run = (v: typeof ANA) => planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: all }) as DayPlan;
    const kh = run(ANA);
    expect(kh.items.map((i) => i.id)).toEqual(["opening", "closing", "mid_day_prep", "catering_today", "ordering", "receiving", "am_prep", "cash", "pm_report", "counts"]);
    for (const i of kh.items) expect(i.state, i.id).toBe("unknown");
    expect(kh.notes.map((n) => n.reason.key)).toEqual(["day.fail.all"]);
    expect(kh.phase.decidedBy).toBe("default");
    for (const k of EMPTY_KEYS) expect(allKeys(kh)).not.toContain(k);
    for (const v of [LUIS, ROSA]) {
      const crew = run(v);
      expect(crew.items.map((i) => i.id)).toEqual(["closing"]);
      expect(crew.empty).toBeNull();
      expect(crew.notes.map((n) => n.reason.key)).toEqual(["day.fail.all"]);
    }
  });
});
