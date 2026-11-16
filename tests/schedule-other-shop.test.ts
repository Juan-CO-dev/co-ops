/**
 * W25 / B134 — a person at two shops is never double-booked: the other shop's head shifts narrow their availability
 * here (the generator, both engines, never places over them), the validator raises `other_shop_overlap` (an error,
 * blocking Approve; a manager's edit is saved and shown), and overtime stays PER SHOP (owner decision W25-1 b).
 */
import { describe, expect, it } from "vitest";
import { buildWeek, type GeneratorInput, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { buildCrewWeek } from "@/lib/scheduling/generator/crew-shared";
import { mergeElsewhere, narrowAroundElsewhere, toSchedPeople, type SchedPerson } from "@/lib/scheduling/people-input-shared";
import { approvalRefusal, checkScheduleRules, generatorRefuses, type WeekSchedule } from "@/lib/scheduling/rules-shared";
import type { ScheduleStructure, ShiftType } from "@/lib/scheduling/structure-shared";
import { DATES, I, day, fixture, small, structure } from "./fixtures/schedule/fixtures";
import { P, THU, U, WED, context, shift } from "./fixtures/schedule/rules-fixture";

const MON = DATES[0]!;
const week = (out: GeneratorOutput): WeekSchedule => ({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, days: out.days, gaps: out.gaps });
/** What toSchedPeople does for an ElsewhereShift: the busy runs, and the window narrowed around them. */
function busyAt(p: SchedPerson, date: string, from: number, to: number, shopDay: { fromQ: number; toQ: number }): void {
  const runs = mergeElsewhere([{ startQ: from, endQ: to }]);
  p.elsewhere = { ...(p.elsewhere ?? {}), [date]: runs };
  p.availability[date] = narrowAroundElsewhere(p.availability[date], runs, shopDay);
}
const overlapsElsewhere = (out: GeneratorOutput) => out.shifts.some((sh) => (out.context.people[sh.userId]?.elsewhere?.[sh.date] ?? []).some(([a, z]) => sh.startQ < z && sh.endQ > a));

describe("the availability window around another shop's shifts", () => {
  const shopDay = { fromQ: 24, toQ: 92 };
  it("keeps the longest free run (a tie keeps the earlier); no free quarter → not available; no information → the shop day", () => {
    expect(mergeElsewhere([{ startQ: 60, endQ: 70 }, { startQ: 44, endQ: 62 }, { startQ: 80, endQ: 80 }])).toEqual([[44, 70]]);
    expect(narrowAroundElsewhere({ fromQ: 24, toQ: 92, source: "manager_set" }, [[44, 76]], shopDay)).toEqual({ fromQ: 24, toQ: 44, source: "manager_set" });
    expect(narrowAroundElsewhere({ fromQ: 24, toQ: 92, source: "toast_pattern" }, [[30, 60]], shopDay)).toEqual({ fromQ: 60, toQ: 92, source: "toast_pattern" });
    expect(narrowAroundElsewhere({ fromQ: 40, toQ: 60, source: "toast_pattern" }, [[44, 56]], shopDay)).toEqual({ fromQ: 40, toQ: 44, source: "toast_pattern" });
    expect(narrowAroundElsewhere({ fromQ: 40, toQ: 60, source: "toast_pattern" }, [[30, 70]], shopDay)).toBeNull();
    expect(narrowAroundElsewhere(null, [[30, 40]], shopDay)).toBeNull();
    expect(narrowAroundElsewhere(undefined, [[24, 60]], shopDay)).toEqual({ fromQ: 60, toQ: 92, source: "insufficient_history" });
  });

  it("toSchedPeople: absent elsewhere changes nothing; a block narrows that date only and is carried on the person", () => {
    const s = structure();
    const base = { members: [{ userId: "u1", role: "employee" as const, active: true }], settings: [], patterns: {}, dates: DATES, structure: s,
      shopDay: { fromQ: s.shopDay.prepStartQ, toQ: s.shopDay.outLatestQ }, wages: { byUserCents: {}, estimateHourlyCents: null }, skills: null };
    const plain = toSchedPeople(base).people[0]!;
    expect("elsewhere" in plain).toBe(false);
    const p = toSchedPeople({ ...base, elsewhere: [{ userId: "u1", date: MON, startQ: s.shopDay.prepStartQ, endQ: 60 }, { userId: "u2", date: MON, startQ: 0, endQ: 96 }, { userId: "u1", date: "2099-01-01", startQ: 0, endQ: 96 }] }).people[0]!;
    expect(p.elsewhere).toEqual({ [MON]: [[s.shopDay.prepStartQ, 60]] });
    expect(p.availability[MON]).toEqual({ fromQ: 60, toQ: s.shopDay.outLatestQ, source: "insufficient_history" });
    for (const d of DATES.slice(1)) expect(p.availability[d]).toEqual(plain.availability[d]);
  });
});

describe("the validator", () => {
  it("other_shop_overlap is an ERROR naming the other shop's times (blocks Approve); no overlap, no problem", () => {
    const ctx = context();
    ctx.people[U.maya]!.elsewhere = { [WED]: [[44, 76]] };
    const ps = checkScheduleRules({ locationId: ctx.locationId, weekStart: ctx.weekStart, shifts: [shift(U.maya, WED, 60, 80, P.REG)], gaps: [], days: [] }, ctx);
    const hit = ps.filter((p) => p.code === "other_shop_overlap");
    expect(hit).toEqual([expect.objectContaining({ severity: "error", day: WED, userId: U.maya, q: 60, params: { fromQ: 44, toQ: 76 } })]);
    expect(approvalRefusal({ locationId: ctx.locationId, weekStart: ctx.weekStart, shifts: [], gaps: [], days: [] }, ps)).toBe("rules_failing");
    const clear = checkScheduleRules({ locationId: ctx.locationId, weekStart: ctx.weekStart, shifts: [shift(U.maya, WED, 76, 92, P.REG), shift(U.maya, THU, 44, 60, P.REG)], gaps: [], days: [] }, ctx);
    expect(clear.filter((p) => p.code === "other_shop_overlap")).toEqual([]);
  });

  it("overtime stays PER SHOP (owner decision W25-1 b): hours at the other shop never count toward this shop's line", () => {
    const ctx = context();
    ctx.people[U.maya]!.elsewhere = Object.fromEntries(DATES.slice(0, 5).map((d) => [d, [[0, 40]] as Array<[number, number]>])); // 50 h elsewhere
    const ps = checkScheduleRules({ locationId: ctx.locationId, weekStart: ctx.weekStart, shifts: [shift(U.maya, WED, 44, 76, P.REG)], gaps: [], days: [] }, ctx);
    expect(ps.filter((p) => p.code === "overtime")).toEqual([]);
  });
});

describe("the generators never place over another shop's time", () => {
  it("station engine: a person busy elsewhere across their own shift is planned around it, clean", () => {
    const input = small();
    const out0 = buildWeek(input);
    const sh = out0.shifts.find((x) => !input.people.find((p) => p.userId === x.userId)!.salaried && x.date >= input.today)!;
    expect(sh).toBeTruthy();
    const again: GeneratorInput = structuredClone(input);
    const s = again.structure;
    busyAt(again.people.find((p) => p.userId === sh.userId)!, sh.date, sh.startQ, sh.endQ, { fromQ: s.shopDay.prepStartQ, toQ: s.shopDay.outLatestQ });
    const out = buildWeek(again);
    expect(overlapsElsewhere(out)).toBe(false);
    expect(out.context.people[sh.userId]!.elsewhere).toEqual({ [sh.date]: [[sh.startQ, sh.endQ]] });
    expect(checkScheduleRules(week(out), out.context).filter((p) => !p.inherited && generatorRefuses(p))).toEqual([]);
  });

  it("crew engine: the busy person is skipped for the window; the free one holds it", () => {
    const type = (over: Partial<ShiftType> = {}): ShiftType => ({ id: "mid", name: "Mid", fromQ: 44, toQ: 64, startFlexQ: 0, minLengthQ: 16,
      headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$REG], countsTowardMod: true, ...over });
    const s: ScheduleStructure = structure((st) => {
      st.engine = "crew";
      st.shiftTypes = [type()];
      st.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 44, serviceCloseQ: 64, outEarliestQ: 64, outLatestQ: 68 };
      st.positions = { [I.$REG]: { role: "register", openQ: 44, trimQ: 64, closeQ: 64, headsBefore: 1, headsAfter: 1, allowedRoles: ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"] } };
      st.priority = [];
      st.leadership.modRequired = false;
      for (const dt of ["slow", "normal", "busy", "weekend"] as const) st.crews[dt] = {
        prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0, waves: { setup: { heads: 1, atQ: 44 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } },
        close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 }, lineMinHeads: { [I.$REG]: 1 },
      };
    });
    const mk = () => {
      const i = fixture({ structure: s, specs: [{ id: "a", role: "employee" }, { id: "b", role: "employee" }], days: [day(MON, { scheduledOutQ: 64, closingMinutes: 0, demandKind: "no_history", hourlyCents: null, dayCents: null }, s)] });
      for (const p of i.people) p.workModes = Object.fromEntries(DATES.map((d) => [d, p.availability[d] === null ? "off" : "works"]));
      return i;
    };
    const base = buildCrewWeek(mk());
    const who = base.shifts.find((x) => x.date === MON)!.userId;
    const i = mk();
    busyAt(i.people.find((p) => p.userId === who)!, MON, 40, 68, { fromQ: 40, toQ: 68 });
    const out = buildCrewWeek(i);
    expect(overlapsElsewhere(out)).toBe(false);
    expect(out.shifts.filter((x) => x.date === MON).map((x) => x.userId)).not.toContain(who);
    expect(out.shifts.some((x) => x.date === MON)).toBe(true);
    expect(checkScheduleRules(week(out), out.context).filter((p) => !p.inherited && generatorRefuses(p))).toEqual([]);
  });
});
