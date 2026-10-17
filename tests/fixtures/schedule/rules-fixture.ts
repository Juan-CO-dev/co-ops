/**
 * A small, explicit shop for the validator's unit tests (Scheduling Phase 2, Task 3): the mockup v17
 * Capitol Hill position set (scripts/schedule-structure-cases.mjs `shopBase`), the week of
 * 2026-10-19 with today = Wednesday 2026-10-21, and a handful of people by id. The need grid is ZERO
 * unless a test sets it, and the MoD requirement is OFF unless a test turns it on, so each test
 * exercises exactly the rule it names. Ids only; names are never logic.
 */
import { CASE_POSITION_IDS, shopBase } from "../../../scripts/schedule-structure-cases.mjs";
import type { DayContext, DayNeed, RuleContext, RulePerson } from "@/lib/scheduling/context-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import type { DeclaredGap, DayRecord, Segment, Shift, WeekSchedule } from "@/lib/scheduling/rules-shared";

export const P = {
  PREP: CASE_POSITION_IDS.$PREP, DISH: CASE_POSITION_IDS.$DISH, REG: CASE_POSITION_IDS.$REG, EXPO: CASE_POSITION_IDS.$EXPO,
  WALKON: CASE_POSITION_IDS.$WALKON, WALK: CASE_POSITION_IDS.$WALK, BOI: CASE_POSITION_IDS.$BOI, THIRD: CASE_POSITION_IDS.$THIRD,
} as const;
export const LOC = "1c000000-0000-4000-8000-000000000001";
export const WEEK = "2026-10-19";
export const DATES = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
export const TODAY = "2026-10-21";
export const [MON, TUE, WED, THU, FRI, SAT, SUN] = DATES as [string, string, string, string, string, string, string];

const person = (userId: string, over: Partial<RulePerson>): RulePerson => ({
  userId, role: "employee", activeMember: true, workType: "foh", alsoAllowed: [], leaderSetting: null, coverPositions: [],
  salaried: false, presenceOnly: false, softMinH: null, softMaxH: null, availability: {}, flexDates: [], untouchableDates: [],
  newerPositions: [], strongPositions: [], ...over,
});

export const U = {
  maya: "u-maya", ben: "u-ben", kai: "u-kai", iris: "u-iris", dani: "u-dani", alex: "u-alex", pete: "u-pete", tess: "u-tess", eli: "u-eli",
} as const;

export function people(): Record<string, RulePerson> {
  const list = [
    person(U.maya, { role: "trainer" }),
    person(U.ben, { role: "employee" }),
    person(U.kai, { role: "employee", workType: "boh" }),
    person(U.iris, { role: "key_holder", leaderSetting: "closes" }),
    person(U.dani, { role: "shift_lead", workType: "management", leaderSetting: "opens", coverPositions: [P.REG, P.EXPO] }),
    person(U.alex, { role: "gm", workType: "management", leaderSetting: "opens", coverPositions: [P.PREP, P.EXPO, P.REG], salaried: true }),
    person(U.pete, { role: "owner", workType: "management", leaderSetting: "mix", coverPositions: [P.PREP], presenceOnly: true }),
    person(U.tess, { role: "employee", activeMember: false }),
    person(U.eli, { role: "trainee" }),
  ];
  return Object.fromEntries(list.map((p) => [p.userId, p]));
}

export function structure(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  const s = shopBase() as ScheduleStructure;
  s.leadership.modRequired = false;
  over(s);
  return s;
}

export const zeros = () => new Array<number>(96).fill(0);

export function emptyNeed(s: ScheduleStructure): DayNeed {
  return {
    positions: Object.fromEntries(Object.keys(s.positions).sort().map((id) => [id, zeros()])),
    lineTotal: zeros(), minHeads: zeros(), maxHeads: zeros(), sources: [], shapeNote: "normal",
  };
}

export function dayContext(s: ScheduleStructure = structure()): DayContext {
  return {
    structureVersionId: "sv-1", structure: s, dayType: "normal", closingMinutes: 45, scheduledOutQ: 83, need: emptyNeed(s),
    inputs: { demandKind: "no_history", hourlyCents: null, dayCents: null, dayTypeSource: "no_history", overrideId: null, cateringEvents: [] },
  };
}

/** The context with built days = today onward (Wed–Sun) unless `built` says otherwise. */
export function context(opts: { built?: string[]; s?: ScheduleStructure } = {}): RuleContext {
  const built = opts.built ?? DATES.filter((d) => d >= TODAY);
  return {
    version: 1, locationId: LOC, weekStart: WEEK, today: TODAY, dates: [...DATES],
    days: Object.fromEntries(built.map((d) => [d, dayContext(structuredClone(opts.s ?? structure()))])),
    budgetByDate: Object.fromEntries(DATES.map((d) => [d, null])),
    closingWindowByDate: Object.fromEntries(DATES.map((d) => [d, { fromQ: 80, toQ: 83 }])),
    people: people(),
  };
}

/** Set the need of one position on one date over [from, to). */
export function setNeed(ctx: RuleContext, date: string, positionId: string, from: number, to: number, heads = 1): void {
  const arr = ctx.days[date]!.need.positions[positionId]!;
  for (let q = from; q < to; q++) arr[q] = heads;
}

export function shift(userId: string, date: string, startQ: number, endQ: number, positionId: string, extra: Partial<Shift> = {}, seg: Partial<Segment> = {}): Shift {
  return { userId, date, startQ, endQ, segments: [{ positionId, startQ, endQ, ...seg }], closingManager: false, flex: false, pinned: false, ...extra };
}

export function week(shifts: Shift[], gaps: DeclaredGap[] = [], days: DayRecord[] = []): WeekSchedule {
  return { locationId: LOC, weekStart: WEEK, shifts, gaps, days };
}
