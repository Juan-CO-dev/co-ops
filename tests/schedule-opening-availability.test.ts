/**
 * PR SCH (plan r5, 22.2; rulings E1, F2): an OPENED date widens the ESTIMATED availability window to its opening, and only
 * that. Explicit (manager-set) windows, off days, exclusions, time off and other-shop narrowing are unchanged; a proposed or
 * declined date is never widened. The widening is resolved per date BEFORE availability is estimated (`generatorInputFor`).
 */
import { describe, expect, it } from "vitest";
import type { RuleContext } from "@/lib/scheduling/context-shared";
import { generatorInputFor, type SchedulingInputs, type StoredWeek } from "@/lib/scheduling/inputs-shared";
import type { DayOpening } from "@/lib/scheduling/opening-shared";
import { toSchedPeople, type PersonPattern, type ToSchedPeopleInput } from "@/lib/scheduling/people-input-shared";
import { structure } from "./fixtures/schedule/fixtures";
import { acceptanceInputs, DATES, WEEK, personId } from "./fixtures/schedule/crew-p-street-2026-10-19";

const MON = "2026-10-26";
const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const SHOP = { fromQ: 28, toQ: 84 };
const S = structure();
const pattern = (p10InQ: number | null, share = 0.9, weeksObserved = 6): PersonPattern => ({
  byDow: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { weeksWorked: Math.round(share * weeksObserved), weeksObserved, share, p10InQ, p90OutQ: 64 }])),
  meanWeeklyHours: 30, firstWeek: "2026-09-01",
});
const people = (over: Partial<ToSchedPeopleInput>) => toSchedPeople({
  members: [{ userId: "u", role: "employee", active: true }], settings: [], patterns: {}, dates, structure: S, shopDay: SHOP, skills: null,
  wages: { byUserCents: {}, estimateHourlyCents: 1900 }, ...over,
}).people;
const on = (over: Partial<ToSchedPeopleInput>, date = MON) => people(over)[0]?.availability[date];
const OPEN = { estimateFromQByDate: { [MON]: 22 } };

describe("only the estimate widens", () => {
  it("too little history: from the opening on the opened date; from the saved start on an unopened date of the same week", () => {
    expect(on(OPEN)).toEqual({ fromQ: 22, toQ: 84, source: "insufficient_history" });
    expect(on(OPEN, dates[1])).toEqual({ fromQ: 28, toQ: 84, source: "insufficient_history" });
  });
  it("a punch pattern still bounds the person: p10 − pad at 6:15 → 6:15; at 5:00 → the opening (5:30); a share under the minimum stays unavailable", () => {
    expect(on({ ...OPEN, patterns: { u: pattern(27) } })).toMatchObject({ fromQ: 25, source: "toast_pattern" });
    expect(on({ ...OPEN, patterns: { u: pattern(22) } })).toMatchObject({ fromQ: 22, source: "toast_pattern" });
    expect(on({ ...OPEN, patterns: { u: pattern(20) } })).toMatchObject({ fromQ: 22 });
    expect(on({ ...OPEN, patterns: { u: pattern(20, 0.1) } })).toBeNull();
  });
  it("explicit availability is unchanged: a manager-set 7:00–15:00 stays; a missing start still defaults to the SAVED start; off stays off", () => {
    const set = (a: Record<string, unknown>) => [{ userId: "u", workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null,
      fullTime: false, fullTimeMinH: null, rosterInclude: null, worksAs: null, availability: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, a])) }] as unknown as ToSchedPeopleInput["settings"];
    expect(on({ ...OPEN, settings: set({ mode: "works", fromQ: 28, toQ: 60 }) })).toEqual({ fromQ: 28, toQ: 60, source: "manager_set" });
    expect(on({ ...OPEN, settings: set({ mode: "works" }) })).toEqual({ fromQ: 28, toQ: 84, source: "manager_set" });
    expect(on({ ...OPEN, settings: set({ mode: "off" }) })).toBeNull();
  });
  it("exclusions and time off: an excluded person stays off the roster; nobody gains an untouchable or flex date", () => {
    expect(people({ ...OPEN, excludedUserIds: ["u"] })).toEqual([]);
    const p = people(OPEN)[0]!;
    expect([p.untouchableDates, p.flexDates]).toEqual([[], []]);
  });
  it("another shop: a 5:00–7:00 shift elsewhere narrows the widened window; the person is never offered before 7:00", () => {
    const w = on({ ...OPEN, elsewhere: [{ userId: "u", date: MON, startQ: 20, endQ: 28 }] });
    expect(w).toMatchObject({ fromQ: 28, toQ: 84 });
  });
});

describe("the per-date handoff (generatorInputFor)", () => {
  const TUE = DATES[1]!;
  const headWith = (opening: DayOpening | undefined): SchedulingInputs => {
    const inputs = acceptanceInputs();
    const context = { version: 1, locationId: inputs.locationId, weekStart: WEEK, today: WEEK, dates: DATES, days: {}, budgetByDate: {}, closingWindowByDate: {}, people: {} } as unknown as RuleContext;
    inputs.weeks[WEEK] = { weekStart: WEEK, weekId: "w", headRevisionId: "h", approvedRevisionId: null, edited: false,
      head: { revision: { id: "h", kind: "generated", basedOnRevisionId: null, structureVersionId: "structure-acceptance", createdAt: "x", createdBy: null, actorContext: "user", generatorVersion: "crew.2", inputsDigest: "d" },
        shifts: [], days: [], gaps: [], reasons: {}, context, inheritedOpenings: opening ? { [TUE]: opening } : {} } } satisfies StoredWeek;
    return inputs;
  };
  const opening = (status: DayOpening["status"]): DayOpening => ({ status, startQ: 22, normalStartQ: 28, triggers: [], guests: 0, orders: 0 });
  const earliest = (inputs: SchedulingInputs, d: string) => Math.min(...generatorInputFor(inputs, WEEK, { today: WEEK }).people.map((p) => p.availability[d]?.fromQ ?? 96));

  it("an applied (inherited) decision widens its date; a proposed or declined one is never widened", () => {
    expect(earliest(headWith(opening("accepted")), TUE)).toBe(22);
    expect(earliest(headWith(opening("manual")), TUE)).toBe(22);
    expect(earliest(headWith(opening("proposed")), TUE)).toBe(28);
    expect(earliest(headWith(opening("declined")), TUE)).toBe(28);
    expect(earliest(headWith(opening("accepted")), DATES[2]!)).toBe(28);
  });
  it("the carried decision reaches the build day (proposed / auto never do: they are recomputed)", () => {
    const day = (o: DayOpening) => generatorInputFor(headWith(o), WEEK, { today: WEEK }).days.find((d) => d.date === TUE)!;
    expect(day(opening("accepted")).decision).toEqual({ kind: "accepted", startQ: 22 });
    expect(day(opening("declined")).decision).toEqual({ kind: "declined" });
    expect(day(opening("proposed")).decision).toBeUndefined();
    expect(day(opening("auto")).decision).toBeUndefined();
  });
  it("a manager-set window (Henry works Tue from 7:00) is not widened by the opening", () => {
    const g = generatorInputFor(headWith(opening("accepted")), WEEK, { today: WEEK });
    expect(g.people.find((p) => p.userId === personId("Henry"))!.availability[TUE]).toMatchObject({ fromQ: 28, source: "manager_set" });
  });
});
