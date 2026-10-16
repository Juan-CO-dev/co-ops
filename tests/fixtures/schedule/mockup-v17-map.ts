/**
 * Maps the read-only mockup v17 export (tests/fixtures/schedule/mockup-v17-week.json, written by
 * scripts/schedule-mockup-export.cjs) onto the validator's types, for the parity pin (Scheduling
 * Phase 2, Task 3). Mockup position ids ('boi', 'hybrid', …) are used AS the position ids — they are
 * ids here, never names; mockup role labels map to `RoleCode`s; hours become quarters; mockup day 0..6
 * becomes the week of 2026-10-19 with mockup `today` (2) = Wednesday 2026-10-21. Every mockup day is a
 * BUILT day under the one structure (the mockup re-checks past days under `defaultStructure`, which
 * the sample never changes).
 *
 * The need grid is the mockup's own `headCount(id, q)` — the head limit inside [open, min(close,
 * scheduled out)) — because the mockup has no other notion of need; and the MoD requirement is the
 * mockup structure's `leadership.modRequired`.
 */
import exported from "./mockup-v17-week.json";
import type { RoleCode } from "@/lib/roles";
import type { DayContext, RuleContext, RulePerson, WorkType } from "@/lib/scheduling/context-shared";
import type { CrewRow, CrewType, LeaderSetting, PositionRole, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { CALLOUT_LAST_RESORT, type Shift, type WeekSchedule } from "@/lib/scheduling/rules-shared";

type MockSegment = { position: string; start: number; end: number; reason?: string };
export type MockShift = {
  id: number; day: number; person: string; start: number; end: number; position: string; segments?: MockSegment[];
  closingManager?: boolean; flex?: boolean; added?: boolean; rule?: string; coverFor?: string;
};
type MockPerson = {
  id: string; role: string; workType: string; alsoAllowed: string[]; off: number[]; leaderShift: string | null;
  coverPreferences: string[] | null; salaried: boolean; visitor: boolean; hourly: boolean; flexDay: number;
};

export const MOCK = exported as unknown as {
  today: number; days: string[]; shopDay: Record<string, number>; scheduledOutQ: number; checklistMinutes: number; revenue: number[];
  defaultStructure: {
    slowBelow: number; busyAbove: number; weekend: boolean[];
    catering: { subs: number; start: number; end: number; service: number; extraPrepDish: number };
    crews: Record<string, Record<string, number>>;
    stations: Record<string, { open: number; trim: number; close: number; before: number; after: number }>;
    positionPriority: Record<string, string>;
    allowedRoles: Record<string, string[]>;
    leadership: { modRequired: boolean; closingRoles: string[]; roleDefaults: Record<string, string> };
    limits: Record<string, number>;
  };
  priorityPairs: Record<string, [string, string]>;
  people: MockPerson[];
  shifts: MockShift[];
  sampleProblems: string[];
  controls: {
    short_pete: { added: MockShift[]; messages: string[] };
    g_dani: { list: MockShift[]; messages: string[] };
    h_without_primary: { removedIds: number[]; messages: string[] };
    i_alex: { list: MockShift[]; messages: string[] };
  };
};

export const WEEK = "2026-10-19";
export const DATES = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
export const dateOf = (day: number) => DATES[day]!;
export const DAY_LABEL: Record<string, string> = Object.fromEntries(DATES.map((d, i) => [d, MOCK.days[i]!]));

export const ROLE: Record<string, RoleCode> = {
  Employee: "employee", Trainee: "trainee", Trainer: "trainer", "Key Holder": "key_holder", "Shift Lead": "shift_lead",
  AGM: "agm", GM: "gm", "Manager of Operations": "moo", Owner: "owner",
};
const POSITION_ROLE: Record<string, PositionRole> = {
  boi: "line_other", third: "line_other", walk: "walk", hybrid: "walk_online", expo: "expo", register: "register", prep: "prep", prepDish: "prep_dish",
};
const SETTING: Record<string, LeaderSetting> = { "Opens only": "opens", "Closes only": "closes", Mix: "mix" };
const WORK: Record<string, WorkType> = { Management: "management", BOH: "boh", FOH: "foh" };
const q = (hours: number) => Math.round(hours * 4);

export function mockStructure(): ScheduleStructure {
  const d = MOCK.defaultStructure;
  const sd = MOCK.shopDay;
  const primaries = new Set(Object.values(d.positionPriority));
  const secondaries = new Set(Object.values(MOCK.priorityPairs).flat().filter((id) => !primaries.has(id)));
  const lineIds = Object.keys(d.stations).filter((id) => !["prep", "prepDish"].includes(id));
  const lineMinHeads = Object.fromEntries(lineIds.map((id) => [id, secondaries.has(id) ? 0 : 1]));
  const crew = (c: Record<string, number>): CrewRow => ({
    prepHeads: c.prep!, prepUntilQ: q(c.prepUntil!), prepDishHeads: c.prepDish!,
    waves: { setup: { heads: c.setup!, atQ: q(c.setupTime!) }, service: { heads: c.service! }, rush: { heads: c.rush!, atQ: q(c.rushTime!) } },
    close: { registerHeads: c.closeRegister!, walkHeads: c.closeWalk!, prepDishHeads: c.closeDish! },
    lineMinHeads: { ...lineMinHeads },
  });
  return {
    version: 1,
    shopDay: { prepStartQ: q(sd.prep!), prepDishArrivalQ: q(sd.prepDish!), serviceStartQ: q(sd.service!), serviceCloseQ: q(sd.serviceClose!), outEarliestQ: q(sd.outEarliest!), outLatestQ: q(sd.outLatest!) },
    dayTypes: { slowBelowCents: d.slowBelow * 100, busyAboveCents: d.busyAbove * 100, weekendIsoDows: d.weekend.flatMap((w, i) => (w ? [i + 1] : [])) },
    crews: { slow: crew(d.crews.Slow!), normal: crew(d.crews.Normal!), busy: crew(d.crews.Busy!), weekend: crew(d.crews.Weekend!) },
    positions: Object.fromEntries(Object.entries(d.stations).map(([id, r]) => [id, {
      role: POSITION_ROLE[id]!, openQ: q(r.open), trimQ: q(r.trim), closeQ: q(r.close), headsBefore: r.before, headsAfter: r.after,
      allowedRoles: d.allowedRoles[id]!.map((x) => ROLE[x]!),
    }])),
    priority: Object.values(MOCK.priorityPairs).map((pair) => ({ pair: [pair[0], pair[1]] as [string, string], primary: pair.find((x) => primaries.has(x))! })),
    leadership: {
      modRequired: d.leadership.modRequired,
      closingRoles: d.leadership.closingRoles.map((x) => ROLE[x]!),
      leaderDefaults: Object.fromEntries(Object.entries(d.leadership.roleDefaults).map(([r, v]) => [ROLE[r]!, SETTING[v]!])),
    },
    limits: {
      minimumShiftQ: q(d.limits.minimumShift!), flexMinimumQ: q(d.limits.flexMinimum!), flexUsesPer2w: d.limits.flexUses!, flexMaxQ: q(d.limits.flexLength!),
      overtimeH: d.limits.overtime!, managerFloorH: d.limits.managerFloor!, gmMinimumH: d.limits.gmMinimum!, agmMinimumH: d.limits.agmMinimum!,
      closingMinutesOverride: d.limits.checklistMinutes!, segmentMinQ: 2, rushShiftMaxQ: 4,
    },
    catering: { minHeadcount: d.catering.subs, extraPrepDishHeads: d.catering.extraPrepDish, defaultStartQ: q(d.catering.start), defaultEndQ: q(d.catering.end), leadMinutes: Math.round((d.catering.service - d.catering.start) * 60) },
    labor: { targetPct: 28, basis: "total", strong: 0.8, watch: 0.65, budgetDeadbandH: 2 },
    roster: { excludedRoles: ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] },
  };
}

/** The mockup's dayType(d): weekend first, then the revenue thresholds (the sample has no overrides). */
export function mockDayType(day: number): CrewType {
  const d = MOCK.defaultStructure;
  if (d.weekend[day]) return "weekend";
  const r = MOCK.revenue[day]!;
  return r < d.slowBelow ? "slow" : r > d.busyAbove ? "busy" : "normal";
}

export function mockPeople(): Record<string, RulePerson> {
  return Object.fromEntries(MOCK.people.map((p) => [p.id, {
    userId: p.id, role: ROLE[p.role]!, activeMember: true, workType: WORK[p.workType]!,
    alsoAllowed: p.alsoAllowed.map((w) => WORK[w]!).filter((w): w is "boh" | "foh" => w === "boh" || w === "foh"),
    leaderSetting: p.leaderShift ? SETTING[p.leaderShift]! : null, coverPositions: p.coverPreferences ?? [],
    salaried: p.salaried, presenceOnly: p.visitor, softMinH: null, softMaxH: null,
    availability: Object.fromEntries(p.off.map((d) => [dateOf(d), null])),
    flexDates: [dateOf(p.flexDay)], untouchableDates: [], newerPositions: [], strongPositions: [],
  } satisfies RulePerson]));
}

function headCountNeed(s: ScheduleStructure, outQ: number): Record<string, number[]> {
  return Object.fromEntries(Object.entries(s.positions).sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, r]) => {
    const arr = new Array<number>(96).fill(0);
    for (let x = r.openQ; x < Math.min(r.closeQ, outQ); x++) arr[x] = x < r.trimQ ? r.headsBefore : r.headsAfter;
    return [id, arr];
  }));
}

export function mockContext(): RuleContext {
  const s = mockStructure();
  const days: Record<string, DayContext> = {};
  DATES.forEach((date, i) => {
    days[date] = {
      structureVersionId: "mockup-v17", structure: structuredClone(s), dayType: mockDayType(i), closingMinutes: MOCK.checklistMinutes,
      scheduledOutQ: MOCK.scheduledOutQ,
      need: { positions: headCountNeed(s, MOCK.scheduledOutQ), lineTotal: new Array(96).fill(0), minHeads: new Array(96).fill(0), maxHeads: new Array(96).fill(0), sources: [], shapeNote: "normal" },
      inputs: { demandKind: "no_history", hourlyCents: null, dayCents: MOCK.revenue[i]! * 100, dayTypeSource: "forecast", overrideId: null, cateringEvents: [] },
    };
  });
  return {
    version: 1, locationId: "mockup-v17-capitol-hill", weekStart: WEEK, today: dateOf(MOCK.today), dates: [...DATES], days,
    budgetByDate: Object.fromEntries(DATES.map((d) => [d, null])),
    closingWindowByDate: Object.fromEntries(DATES.map((d) => [d, { fromQ: s.shopDay.serviceCloseQ, toQ: MOCK.scheduledOutQ }])),
    people: mockPeople(),
  };
}

export function toShift(m: MockShift): Shift {
  const segs = m.segments ?? [{ position: m.position, start: m.start, end: m.end }];
  return {
    userId: m.person, date: dateOf(m.day), startQ: m.start, endQ: m.end,
    segments: segs.map((g) => {
      const reason = String(g.reason || m.rule || "");
      return {
        positionId: g.position, startQ: g.start, endQ: g.end,
        ...(reason.includes("last-resort") ? { lastResort: true } : {}),
        ...(m.coverFor ? { coverFor: m.coverFor } : {}),
        ...(reason.includes("call-out last resort") ? { reasonKey: CALLOUT_LAST_RESORT } : {}),
      };
    }),
    closingManager: !!m.closingManager, flex: !!m.flex, pinned: !!m.added,
  };
}

export function mockWeek(list: readonly MockShift[] = MOCK.shifts): WeekSchedule {
  return { locationId: "mockup-v17-capitol-hill", weekStart: WEEK, shifts: list.map(toShift), gaps: [], days: [] };
}
