/**
 * THE SEEDED GENERATOR FIXTURES (Scheduling Phase 2, Task 8): ids only, no names in logic. Every fixture is
 * a complete `GeneratorInput` built from the mockup v17 Capitol Hill position set (`shopBase`), the week
 * of 2026-10-26 (Mon) with today = Monday, a roster by id with skills, and a demand curve. The constrained
 * fixtures (F0a–F0j) come FIRST and are green before any golden is frozen (r2).
 */
import { CASE_POSITION_IDS as I, shopBase } from "../../../scripts/schedule-structure-cases.mjs";
import type { RoleCode } from "@/lib/roles";
import type { BuildDayInput, GeneratorInput, HeadSnapshot, Pin } from "@/lib/scheduling/generator/build-shared";
import type { SchedPerson, SkillCell, SkillLookup } from "@/lib/scheduling/people-input-shared";
import type { WorkType } from "@/lib/scheduling/context-shared";
import type { LeaderSetting, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { scheduledOut } from "@/lib/scheduling/structure-shared";
import { weekDays } from "@/lib/scheduling/time-shared";

export { I };
export const LOC = "1c000000-0000-4000-8000-000000000002";
export const WEEK = "2026-10-26";
export const DATES = weekDays(WEEK);
export const TODAY = WEEK;
export const SV = "sv-fixture-1";
export const BANDS = { building: 0.45, strong: 0.75 };

export const LINE = [I.$REG, I.$EXPO, I.$WALKON, I.$WALK, I.$BOI, I.$THIRD];
export const ALL_POSITIONS = [I.$PREP, I.$DISH, ...LINE];

export function structure(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  const s = shopBase() as ScheduleStructure;
  over(s);
  return s;
}

export interface PersonSpec {
  id: string;
  role: RoleCode;
  workType?: WorkType;
  alsoAllowed?: Array<"boh" | "foh">;
  leader?: LeaderSetting | null;
  cover?: string[];
  /** ISO weekdays (1 = Mon) the person is OFF; every other day = the shop day. */
  off?: number[];
  /** A fixed availability window on every working day. */
  window?: { fromQ: number; toQ: number };
  softMin?: number | null;
  softMax?: number | null;
  fullTime?: boolean;
  fullTimeMinH?: number | null;
  /** positionId → [value, confidence] with evidence; a missing position is an unproven 0.5. */
  skills?: Record<string, [number, number]>;
  /** The closeOnTime mean. */
  close?: number;
  wage?: number | null;
  active?: boolean;
  presenceOnly?: boolean;
}

export function person(spec: PersonSpec, dates: readonly string[] = DATES): SchedPerson {
  const role = spec.role;
  const salaried = role === "gm" || role === "agm";
  const presenceOnly = spec.presenceOnly ?? (role === "moo" || role === "owner");
  const level = role === "shift_lead" || role === "agm" || role === "gm" || role === "moo" || role === "owner" ? "management" : "foh";
  const availability: SchedPerson["availability"] = {};
  dates.forEach((d, i) => {
    const dow = i + 1;
    availability[d] = spec.off?.includes(dow) ? null : spec.window ? { ...spec.window, source: "toast_pattern" } : { fromQ: 28, toQ: 84, source: "insufficient_history" };
  });
  return {
    userId: spec.id, role, activeMember: spec.active ?? true, workType: spec.workType ?? level, alsoAllowed: [...(spec.alsoAllowed ?? [])].sort(),
    leaderSetting: spec.leader ?? null, coverPositions: spec.cover ?? [], salaried, presenceOnly, backupCover: false,
    softMinH: salaried || presenceOnly ? null : spec.softMin === undefined ? 24 : spec.softMin, softMaxH: salaried || presenceOnly ? null : spec.softMax === undefined ? 40 : spec.softMax,
    availability, flexDates: [], untouchableDates: [], newerPositions: [], strongPositions: [],
    wageCents: salaried || presenceOnly ? null : spec.wage === undefined ? 1900 : spec.wage, wageSource: salaried || presenceOnly ? null : "estimate",
    fullTime: spec.fullTime ?? false, fullTimeMinH: spec.fullTimeMinH ?? null, rosterIncluded: false,
  };
}

/** The skill lookup from the specs; `newerPositions` / `strongPositions` on each person are filled from it. */
export function skillsOf(specs: readonly PersonSpec[], people: SchedPerson[], s: ScheduleStructure): SkillLookup {
  const byUser: Record<string, Record<string, SkillCell>> = {};
  const closeScoreByUser: Record<string, number | null> = {};
  for (const spec of [...specs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cells: Record<string, SkillCell> = {};
    for (const id of Object.keys(spec.skills ?? {}).sort()) {
      const [value, confidence] = spec.skills![id]!;
      cells[id] = { value, confidence, startingPoint: false };
    }
    byUser[spec.id] = cells;
    closeScoreByUser[spec.id] = spec.close ?? null;
  }
  const lookup: SkillLookup = { byUser, closeScoreByUser, bands: BANDS };
  for (const p of people) {
    for (const id of Object.keys(s.positions).sort()) {
      const cell = byUser[p.userId]?.[id];
      if (!cell || cell.confidence < 0.3) continue;
      if (cell.value < BANDS.building) p.newerPositions.push(id);
      if (cell.value >= BANDS.strong) p.strongPositions.push(id);
    }
  }
  return lookup;
}

/** A flat-ish normal day's hourly curve in cents (11:00–20:00), with a lunch peak at 12:00. */
export function normalCurve(scale = 1): number[] {
  const h = new Array<number>(24).fill(0);
  const base: Record<number, number> = { 10: 20000, 11: 60000, 12: 90000, 13: 70000, 14: 40000, 15: 30000, 16: 25000, 17: 35000, 18: 45000, 19: 30000 };
  for (const [k, v] of Object.entries(base)) h[Number(k)] = Math.round(v * scale);
  return h;
}

export function day(date: string, over: Partial<BuildDayInput> = {}, s: ScheduleStructure = structure()): BuildDayInput {
  const closingMinutes = over.closingMinutes ?? 45;
  return {
    date, dayType: "normal", dayTypeSource: "forecast", overrideId: null, closingMinutes, scheduledOutQ: scheduledOut(s, closingMinutes),
    demandKind: "ok", hourlyCents: normalCurve(), dayCents: normalCurve().reduce((a, b) => a + b, 0), catering: [], ...over,
  };
}

export interface FixtureOpts {
  structure?: ScheduleStructure;
  specs: PersonSpec[];
  days?: BuildDayInput[];
  today?: string;
  budgetByDate?: Record<string, number | null>;
  pins?: Pin[];
  head?: HeadSnapshot | null;
}

export function fixture(o: FixtureOpts): GeneratorInput {
  const s = o.structure ?? structure();
  const people = o.specs.map((spec) => person(spec));
  const skills = skillsOf(o.specs, people, s);
  return {
    locationId: LOC, weekStart: WEEK, today: o.today ?? TODAY, structure: s, structureVersionId: SV, people, skills, pins: o.pins ?? [],
    budgetByDate: o.budgetByDate ?? Object.fromEntries(DATES.map((d) => [d, null])), head: o.head ?? null,
    days: o.days ?? DATES.map((d) => day(d, {}, s)),
  };
}

// ─── The v17 roster (F1) by id: 18 people, roles, leader settings, cover preferences and skills ──

const R = { PREP: I.$PREP, DISH: I.$DISH, REG: I.$REG, EXPO: I.$EXPO, WALKON: I.$WALKON, WALK: I.$WALK, BOI: I.$BOI, THIRD: I.$THIRD };
const sk = (o: Record<string, number>, c = 0.7): Record<string, [number, number]> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v, c] as [number, number]]));

export const V17_SPECS: PersonSpec[] = [
  { id: "u-01-maya", role: "trainer", off: [6], skills: sk({ [R.BOI]: 0.95, [R.WALK]: 0.8, [R.EXPO]: 0.6, [R.THIRD]: 0.65, [R.WALKON]: 0.7, [R.PREP]: 0.5 }) },
  { id: "u-02-leo", role: "employee", off: [7], skills: sk({ [R.THIRD]: 0.94, [R.BOI]: 0.82, [R.PREP]: 0.58, [R.WALK]: 0.62, [R.REG]: 0.4, [R.EXPO]: 0.45 }) },
  { id: "u-03-sofia", role: "trainer", workType: "boh", off: [7], skills: sk({ [R.PREP]: 0.96, [R.DISH]: 0.83 }) },
  { id: "u-04-ben", role: "employee", off: [4], skills: sk({ [R.REG]: 0.92, [R.EXPO]: 0.82, [R.WALK]: 0.68, [R.WALKON]: 0.55, [R.THIRD]: 0.45, [R.PREP]: 0.4 }) },
  { id: "u-05-dani", role: "shift_lead", leader: "opens", cover: [R.REG, R.EXPO], off: [1], close: 0.97, skills: sk({ [R.EXPO]: 0.84, [R.WALK]: 0.72, [R.REG]: 0.66, [R.WALKON]: 0.64, [R.BOI]: 0.5 }) },
  { id: "u-06-iris", role: "key_holder", leader: "closes", off: [5], close: 0.94, skills: sk({ [R.WALKON]: 0.84, [R.WALK]: 0.82, [R.EXPO]: 0.7, [R.REG]: 0.67, [R.BOI]: 0.48 }) },
  { id: "u-07-omar", role: "employee", workType: "boh", off: [2], skills: sk({ [R.PREP]: 0.94, [R.DISH]: 0.81 }) },
  { id: "u-08-kai", role: "employee", workType: "boh", off: [3], skills: sk({ [R.DISH]: 0.93, [R.PREP]: 0.81 }) },
  { id: "u-09-tess", role: "employee", alsoAllowed: ["boh"], off: [2], skills: sk({ [R.WALKON]: 0.91, [R.WALK]: 0.87, [R.REG]: 0.72, [R.THIRD]: 0.55, [R.EXPO]: 0.61, [R.BOI]: 0.5 }) },
  { id: "u-10-nora", role: "key_holder", leader: "closes", off: [3], close: 0.95, skills: sk({ [R.EXPO]: 0.88, [R.WALK]: 0.78, [R.WALKON]: 0.7, [R.REG]: 0.64, [R.PREP]: 0.45 }) },
  { id: "u-11-eli", role: "trainee", off: [5], softMin: 20, softMax: 28, skills: sk({ [R.WALK]: 0.64, [R.REG]: 0.58, [R.WALKON]: 0.53, [R.EXPO]: 0.42, [R.BOI]: 0.4, [R.THIRD]: 0.35 }) },
  { id: "u-12-riley", role: "trainer", alsoAllowed: ["boh"], off: [1], skills: sk({ [R.BOI]: 0.9, [R.THIRD]: 0.88, [R.PREP]: 0.69, [R.WALK]: 0.64, [R.EXPO]: 0.56 }) },
  { id: "u-13-sam", role: "employee", off: [7], skills: sk({ [R.EXPO]: 0.9, [R.WALKON]: 0.82, [R.THIRD]: 0.68, [R.WALK]: 0.73, [R.BOI]: 0.62, [R.REG]: 0.6 }) },
  { id: "u-14-wren", role: "employee", off: [1, 2], softMin: 18, softMax: 26, skills: sk({ [R.WALKON]: 0.83, [R.EXPO]: 0.78, [R.WALK]: 0.74, [R.REG]: 0.65, [R.BOI]: 0.61 }) },
  { id: "u-15-alex", role: "gm", leader: "opens", cover: [R.PREP, R.EXPO, R.REG], off: [7], close: 0.9, skills: sk({ [R.PREP]: 0.91, [R.DISH]: 0.82, [R.EXPO]: 0.72, [R.WALK]: 0.68, [R.REG]: 0.56, [R.BOI]: 0.7 }) },
  { id: "u-16-jules", role: "agm", leader: "opens", cover: [R.EXPO, R.REG], off: [1], close: 0.88, skills: sk({ [R.EXPO]: 0.9, [R.PREP]: 0.84, [R.WALK]: 0.66, [R.WALKON]: 0.6, [R.BOI]: 0.75 }) },
  { id: "u-17-cristian", role: "moo", leader: "mix", cover: [R.EXPO], close: 0.9, skills: sk({ [R.EXPO]: 0.93, [R.WALK]: 0.8 }) },
  { id: "u-18-pete", role: "owner", leader: "mix", cover: [R.PREP], skills: sk({ [R.PREP]: 0.82, [R.WALK]: 0.6 }) },
];

/** The mockup's revenue per day ($) → cents, shaped by the normal curve. */
export const V17_REVENUE = [3700, 3900, 4250, 4300, 5000, 4700, 3650];

export function v17Days(s: ScheduleStructure): BuildDayInput[] {
  return DATES.map((d, i) => {
    const total = normalCurve().reduce((a, b) => a + b, 0);
    const scale = (V17_REVENUE[i]! * 100) / total;
    const hourly = normalCurve(scale);
    const dayCents = hourly.reduce((a, b) => a + b, 0);
    const dow = i + 1;
    const dayType = s.dayTypes.weekendIsoDows.includes(dow) ? "weekend" : dayCents < s.dayTypes.slowBelowCents ? "slow" : dayCents > s.dayTypes.busyAboveCents ? "busy" : "normal";
    return day(d, { dayType, dayTypeSource: s.dayTypes.weekendIsoDows.includes(dow) ? "weekend" : "forecast", hourlyCents: hourly, dayCents }, s);
  });
}

/** A small, fully controllable shop: 4 line positions and the two BOH ones, a 9-person roster. */
export const SMALL_SPECS: PersonSpec[] = [
  { id: "u-a-ana", role: "key_holder", leader: "closes", close: 0.9, skills: sk({ [R.WALKON]: 0.9, [R.WALK]: 0.8, [R.REG]: 0.7 }) },
  { id: "u-b-bo", role: "employee", skills: sk({ [R.REG]: 0.9, [R.EXPO]: 0.8, [R.THIRD]: 0.6 }) },
  { id: "u-c-cy", role: "employee", skills: sk({ [R.BOI]: 0.9, [R.THIRD]: 0.85, [R.WALK]: 0.6 }) },
  { id: "u-d-dee", role: "employee", workType: "boh", skills: sk({ [R.DISH]: 0.9, [R.PREP]: 0.8 }) },
  { id: "u-e-eve", role: "employee", workType: "boh", skills: sk({ [R.PREP]: 0.9, [R.DISH]: 0.8 }) },
  { id: "u-f-finn", role: "employee", skills: sk({ [R.WALKON]: 0.7, [R.WALK]: 0.7, [R.EXPO]: 0.6 }) },
  { id: "u-g-gus", role: "shift_lead", leader: "opens", cover: [R.REG, R.EXPO], close: 0.8, skills: sk({ [R.EXPO]: 0.9, [R.REG]: 0.8 }) },
  { id: "u-h-hal", role: "key_holder", leader: "closes", close: 0.85, skills: sk({ [R.REG]: 0.85, [R.WALKON]: 0.75 }) },
  { id: "u-i-ivy", role: "employee", skills: sk({ [R.THIRD]: 0.9, [R.BOI]: 0.8, [R.WALK]: 0.7, [R.EXPO]: 0.6 }) },
  { id: "u-j-gm", role: "gm", leader: "opens", cover: [R.PREP, R.EXPO, R.REG], skills: sk({ [R.PREP]: 0.9, [R.EXPO]: 0.8 }) },
];

export const small = (over: Partial<FixtureOpts> = {}) => fixture({ specs: SMALL_SPECS, ...over });

/**
 * CC chunk H9 (spec §5.1, two days off): with at most 5 dates per hourly person, the 10-person SMALL roster cannot staff a 7-day
 * week (the p2.12 goldens had most of it on 7 days). Fixtures whose point is NOT a short roster add these four people.
 */
export const H9_EXTRA: PersonSpec[] = [
  { id: "u-m-mia", role: "employee", skills: sk({ [R.REG]: 0.7, [R.WALKON]: 0.7, [R.WALK]: 0.7, [R.THIRD]: 0.7, [R.BOI]: 0.7 }) },
  { id: "u-n-noe", role: "employee", skills: sk({ [R.REG]: 0.7, [R.WALKON]: 0.7, [R.WALK]: 0.7, [R.THIRD]: 0.7, [R.BOI]: 0.7 }) },
  { id: "u-o-oz", role: "employee", workType: "boh", skills: sk({ [R.DISH]: 0.8, [R.PREP]: 0.8 }) },
  { id: "u-p-pia", role: "key_holder", leader: "closes", close: 0.8, skills: sk({ [R.REG]: 0.75, [R.WALKON]: 0.75, [R.WALK]: 0.7 }) },
];

// ─── The constrained fixtures F0a–F0j (green BEFORE any golden is frozen) ────

const ALL_ROLES: RoleCode[] = ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"];

/**
 * The "no closing crew, no BOH need, floors carry the line" shop used by the repair fixtures: Register and
 * Walk-ins / Online all day (floors 1, trim at the close so the wave heads stay), Crunchy Boi and 3rd Party
 * from 9:30 (floors 1), Expeditor 11:30–16:00 (a rush head), Walk-ins 16:00–20:00 open to KEY HOLDERS ONLY
 * with a floor of 1 (the evening deficit a KH must take). Waves: setup 4 @ 10:30 → the four primaries;
 * rush 1 @ 11:30 → Expeditor. MoD off.
 */
export function repairShop(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  return structure((s) => {
    s.leadership.modRequired = false;
    const pos = (role: ScheduleStructure["positions"][string]["role"], openQ: number, trimQ: number, closeQ: number, allowedRoles: RoleCode[] = ALL_ROLES) =>
      ({ role, openQ, trimQ, closeQ, headsBefore: 1, headsAfter: 1, allowedRoles: [...allowedRoles] });
    s.positions = {
      [I.$PREP]: pos("prep", 28, 60, 68), [I.$DISH]: pos("prep_dish", 28, 68, 84, ["trainee", "employee", "trainer"]),
      [I.$REG]: pos("register", 42, 80, 80), [I.$WALKON]: pos("walk_online", 42, 80, 80),
      [I.$BOI]: pos("line_other", 38, 56, 56), [I.$THIRD]: pos("line_other", 38, 62, 62),
      [I.$EXPO]: pos("expo", 46, 64, 64), [I.$WALK]: pos("walk", 64, 80, 80, ["key_holder"]),
    };
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      s.crews[t] = {
        prepHeads: 0, prepUntilQ: 60, prepDishHeads: 0,
        waves: { setup: { heads: 4, atQ: 42 }, service: { heads: 0 }, rush: { heads: 1, atQ: 46 } },
        close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 },
        lineMinHeads: { [I.$REG]: 1, [I.$WALKON]: 1, [I.$BOI]: 1, [I.$THIRD]: 1, [I.$EXPO]: 0, [I.$WALK]: 1 },
      };
    }
    over(s);
  });
}

const flatDay = (date: string, s: ScheduleStructure) => day(date, { demandKind: "no_history", hourlyCents: null, dayCents: null, dayTypeSource: "no_history" }, s);

/**
 * (F0i) the 4th-donor case. Walk-ins (KH only) is needed 15:00–20:00 (5 h). The four key holders are on the
 * daytime line: k1 on Crunchy Boi 9:30–13:30 (4 h; with 36 kept hours, the 5 h move would be 41 h: OVERTIME),
 * k2 on 3rd Party (opens-only: a block ending at service close breaks the LEADER SETTING), k3 on Expeditor
 * (AVAILABLE only until 19:30), k4 on Walk-ins / Online (fine). Donors go in order of the skill they leave
 * behind (0.6 / 0.7 / 0.8 / 0.9), so k4 is the 4TH donor; f2 refills his Walk-ins / Online block.
 */
export function f0iFourthDonor(): GeneratorInput {
  const s = repairShop((x) => {
    x.positions[I.$BOI] = { ...x.positions[I.$BOI]!, trimQ: 54, closeQ: 54 };
    x.positions[I.$WALK] = { ...x.positions[I.$WALK]!, openQ: 60 };
  });
  // Soft minimums are flat (0) so skill decides the daytime blocks; k1 alone is under his, which also keeps him first.
  const specs: PersonSpec[] = [
    { id: "u-k1-ot", role: "key_holder", leader: "mix", softMin: 40, skills: { [R.BOI]: [0.6, 0.7], [R.WALK]: [0.9, 0.7] } },
    { id: "u-k2-opens", role: "key_holder", leader: "opens", softMin: 0, skills: { [R.THIRD]: [0.7, 0.7], [R.WALK]: [0.9, 0.7] } },
    { id: "u-k3-avail", role: "key_holder", leader: "mix", softMin: 0, window: { fromQ: 28, toQ: 78 }, skills: { [R.EXPO]: [0.8, 0.7], [R.WALK]: [0.9, 0.7] } },
    { id: "u-k4-ok", role: "key_holder", leader: "mix", softMin: 0, skills: { [R.WALKON]: [0.9, 0.7], [R.WALK]: [0.9, 0.7] } },
    { id: "u-f1-reg", role: "employee", softMin: 0, skills: { [R.REG]: [0.9, 0.7] } },
    { id: "u-f2-fill", role: "employee", softMin: 0, skills: { [R.WALKON]: [0.5, 0.7], [R.EXPO]: [0.3, 0.7], [R.THIRD]: [0.3, 0.7], [R.BOI]: [0.3, 0.7] } },
  ];
  const head: HeadSnapshot = {
    revisionId: "rev-h", gaps: [], days: [], closingWindowByDate: {},
    shifts: DATES.slice(1, 5).map((d) => ({ userId: "u-k1-ot", date: d, startQ: 42, endQ: 78, segments: [{ positionId: R.REG, startQ: 42, endQ: 78 }], closingManager: false, flex: false, pinned: false })),
  };
  return fixture({ structure: s, specs, days: [flatDay(WEEK, s)], head });
}

/** (F0j) the 3-link chain: tess → Walk-ins (close), sam → tess's 3rd Party block, leo (free) → sam's Expeditor block. `fourLinks` removes leo's freedom so a 4th link would be needed. */
export function f0jLongChain(fourLinks = false): GeneratorInput {
  const s = repairShop((x) => {
    x.positions[I.$THIRD]!.allowedRoles = ["employee", "trainer", "key_holder"];
    x.positions[I.$BOI]!.allowedRoles = ["employee", "trainer", "key_holder"];
    // Expeditor takes no key holder, so Tess cannot simply extend into it: the chain is the only way.
    x.positions[I.$EXPO]!.allowedRoles = ["trainee", "employee"];
  });
  const specs: PersonSpec[] = [
    { id: "u-r1", role: "employee", skills: { [R.REG]: [0.95, 0.7], [R.THIRD]: [0.4, 0.7] } },
    { id: "u-w1", role: "employee", skills: { [R.WALKON]: [0.95, 0.7], [R.THIRD]: [0.4, 0.7] } },
    { id: "u-b1", role: "employee", skills: { [R.BOI]: [0.95, 0.7], [R.THIRD]: [0.4, 0.7] } },
    { id: "u-tess", role: "key_holder", leader: "mix", skills: { [R.THIRD]: [0.95, 0.7], [R.WALK]: [0.9, 0.7] } },
    { id: "u-sam", role: "employee", skills: { [R.EXPO]: [0.8, 0.7], [R.THIRD]: [0.8, 0.7] } },
    { id: "u-leo", role: "trainee", off: fourLinks ? [1] : [], skills: { [R.EXPO]: [0.7, 0.7] } },
  ];
  return fixture({ structure: s, specs, days: [flatDay(WEEK, s)] });
}

/** A one-position shop: Register 11:00–15:00 (exactly the 4 h minimum), no BOH, no closing crew; the floor = the limit = 1. */
export function onePosition(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  return structure((s) => {
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 44, serviceCloseQ: 60, outEarliestQ: 60, outLatestQ: 64 };
    s.positions = { [I.$REG]: { role: "register", openQ: 44, trimQ: 60, closeQ: 60, headsBefore: 1, headsAfter: 1, allowedRoles: [...ALL_ROLES] } };
    s.priority = [];
    s.leadership.modRequired = false;
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      s.crews[t] = { prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0, waves: { setup: { heads: 1, atQ: 44 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } }, close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 }, lineMinHeads: { [I.$REG]: 1 } };
    }
    s.limits.gmMinimumH = 4;
    s.limits.agmMinimumH = 4;
    over(s);
  });
}

/**
 * The plan's F10 / F14 / F15 structure: line 11:00–15:00; Walk-ins / Online + Register (primaries, 1/1, trim at
 * the close), Walk-ins + Expeditor (secondaries, 1/1, TRIM 14:00); floors 1/1/0/0 → minHeads 2, maxHeads 4;
 * waves setup 2 @ 11:00, service 0, rush 1 @ 12:00 → W = 2/3/3/2. `onlySecondaries` is F15 (W = 0/2/2/0).
 */
export function f10Structure(onlySecondaries = false): ScheduleStructure {
  const WO = "5f000000-0000-4000-8000-000000000001";
  const RG = "5f000000-0000-4000-8000-000000000002";
  const WK = "5f000000-0000-4000-8000-000000000003";
  const EX = "5f000000-0000-4000-8000-000000000004";
  const pos = (role: "walk_online" | "register" | "walk" | "expo", trimQ: number) => ({ role, openQ: 44, trimQ, closeQ: 60, headsBefore: 1, headsAfter: 1, allowedRoles: [...ALL_ROLES] });
  return structure((st) => {
    st.leadership.modRequired = false;
    st.shopDay = { prepStartQ: 28, prepDishArrivalQ: 28, serviceStartQ: 44, serviceCloseQ: 60, outEarliestQ: 60, outLatestQ: 64 };
    st.positions = onlySecondaries ? { [WK]: pos("walk", 56), [EX]: pos("expo", 56) } : { [WO]: pos("walk_online", 60), [RG]: pos("register", 60), [WK]: pos("walk", 56), [EX]: pos("expo", 56) };
    st.priority = onlySecondaries ? [] : [{ pair: [WO, WK], primary: WO }, { pair: [RG, EX], primary: RG }];
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      st.crews[t] = {
        prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0,
        waves: { setup: { heads: onlySecondaries ? 0 : 2, atQ: 44 }, service: { heads: 0 }, rush: { heads: onlySecondaries ? 2 : 1, atQ: 48 } },
        close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 },
        lineMinHeads: onlySecondaries ? { [WK]: 0, [EX]: 0 } : { [WO]: 1, [RG]: 1, [WK]: 0, [EX]: 0 },
      };
    }
  });
}
export const F10_IDS = { WO: "5f000000-0000-4000-8000-000000000001", RG: "5f000000-0000-4000-8000-000000000002", WK: "5f000000-0000-4000-8000-000000000003", EX: "5f000000-0000-4000-8000-000000000004" };

/** The F10 curves over 11:00–14:00 (hours 11–14), in cents. */
export const f10Cents = (v: [number, number, number, number]) => { const a = new Array<number>(24).fill(0); v.forEach((x, i) => { a[11 + i] = x; }); return a; };

/** (F0e) the "only qualified person used elsewhere" case: Tess, the only Walk-ins / Online closer, was placed on Register at the close; Sam can take Register. */
export function f0eRepairNeeded(): GeneratorInput {
  const s = structure((x) => {
    x.leadership.modRequired = false;
    x.positions[I.$WALKON]!.allowedRoles = ["key_holder"];
    for (const t of ["slow", "normal", "busy", "weekend"] as const) x.crews[t].close = { registerHeads: 1, walkHeads: 1, prepDishHeads: 1 };
    // F0e's premise is ONE key holder holding Walk-ins / Online 10:30 → 20:45 (10.25 h). This fixture tests the repair chain,
    // not the cap, so it pins the shop's cap at 12 h explicitly (independent of the default, 10.5 h since CC chunk C ruling 2).
    // The cap has its own tests (tests/schedule-generator.test.ts "ruling 3", tests/schedule-rules.test.ts).
    x.limits.maxShiftH = 12;
  });
  const specs: PersonSpec[] = [
    { id: "u-tess", role: "key_holder", leader: "closes", close: 0.9, skills: { [R.REG]: [0.95, 0.7], [R.WALKON]: [0.9, 0.7] } },
    { id: "u-sam", role: "shift_lead", leader: "closes", cover: [R.REG, R.EXPO], close: 0.8, skills: { [R.REG]: [0.6, 0.7], [R.EXPO]: [0.9, 0.7] } },
    ...SMALL_SPECS.filter((p) => !["u-a-ana", "u-h-hal", "u-g-gus"].includes(p.id)),
  ];
  return fixture({ structure: s, specs, days: [flatDay(WEEK, s)] });
}

// ─── THE NAMED FIXTURE SET (Task 8): the constrained ones first, then the scenarios ──

const noMod = () => structure((x) => { x.leadership.modRequired = false; });
const budgetAll = (h: number | null) => Object.fromEntries(DATES.map((d) => [d, h]));
const f10People: PersonSpec[] = [
  { id: "u-p1", role: "employee", softMin: 0, skills: { [F10_IDS.RG]: [0.9, 0.7] } }, { id: "u-p2", role: "employee", softMin: 0, skills: { [F10_IDS.WO]: [0.9, 0.7] } },
  { id: "u-p3", role: "employee", softMin: 0, skills: { [F10_IDS.WK]: [0.9, 0.7] } }, { id: "u-p4", role: "employee", softMin: 0, skills: { [F10_IDS.EX]: [0.9, 0.7] } },
];
const f10Day = (date: string, s: ScheduleStructure, cents: number[] | null) =>
  day(date, { demandKind: cents ? "ok" : "no_history", hourlyCents: cents, dayCents: cents ? cents.reduce((a, b) => a + b, 0) : null, scheduledOutQ: 60 }, s);

/** A head whose Sunday (Nov 1) carries an `unresolved_search` gap and whose days are all built records. */
function headWithUnresolvedSunday(): HeadSnapshot {
  const sunday = DATES[6]!;
  return {
    revisionId: "rev-prev", closingWindowByDate: Object.fromEntries(DATES.map((d) => [d, { fromQ: 80, toQ: 83 }])),
    shifts: [{ userId: "u-b-bo", date: sunday, startQ: 42, endQ: 60, segments: [{ positionId: I.$REG, startQ: 42, endQ: 60 }], closingManager: false, flex: false, pinned: false }],
    days: DATES.map((d) => ({ date: d, originRevisionId: "rev-prev", structureVersionId: "sv-prev", inherited: false, problems: [] })),
    gaps: [{ code: "coverage_gap", date: sunday, positionId: I.$WALKON, fromQ: 42, toQ: 83, cause: "unresolved_search",
      certificate: { searched: { steps: 200, donorsTried: 8, chainDepth: 3 }, limits: { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 }, candidateIds: ["u-a-ana"] } }],
  };
}

export const FIXTURES: Record<string, () => GeneratorInput> = {
  // F0: constrained, green before any golden is frozen.
  "F0a-infeasible-structure": () => {
    const s = structure((x) => { x.positions[I.$REG]!.trimQ = 64; x.positions[I.$REG]!.closeQ = 64; x.positions[I.$EXPO]!.trimQ = 84; x.positions[I.$EXPO]!.closeQ = 84; });
    return small({ structure: s, specs: SMALL_SPECS.filter((p) => !["u-g-gus", "u-j-gm"].includes(p.id)), days: [day(WEEK, {}, s)] });
  },
  "F0b-tight-budget-zero": () => small({ structure: noMod(), days: [day(WEEK, {}, noMod())], budgetByDate: { ...budgetAll(null), [WEEK]: 0 } }),
  "F0b-tight-budget-essential-plus-6": () => small({ structure: noMod(), days: [day(WEEK, {}, noMod())], budgetByDate: { ...budgetAll(null), [WEEK]: 22 } }),
  "F0c-no-eligible": () => { const s = structure((x) => { x.leadership.modRequired = false; x.positions[I.$DISH]!.allowedRoles = ["trainer"]; }); return small({ structure: s, days: [day(WEEK, {}, s)] }); },
  "F0d-floor-capped": () => {
    const s = structure((x) => { x.leadership.modRequired = false; x.limits.managerFloorH = 16; x.limits.salariedFlexH = 8; x.positions[I.$EXPO]!.allowedRoles = ["gm"]; x.positions[I.$EXPO]!.openQ = 40; x.positions[I.$EXPO]!.trimQ = 60; x.positions[I.$EXPO]!.closeQ = 60; });
    // CC chunk H9: with two days off (5 dates each) the 10-person roster cannot staff 7 days; F0d is about the GM's floor
    // cap on the GM-only Expo, so the other stations get enough hourly people (H9_EXTRA), and the floor / flex (16 h / 8 h, were
    // 24 h / 10 h) are set so the GM still runs out on the Sunday Expo — the floor_limit this fixture exists for.
    return small({ structure: s, days: DATES.map((d) => day(d, {}, s)), specs: [...SMALL_SPECS, ...H9_EXTRA] });
  },
  "F0e-repair-needed": f0eRepairNeeded,
  "F0f-all-unproven": () => {
    const extra: PersonSpec[] = [{ id: "u-k-kim", role: "employee" }, { id: "u-l-lou", role: "employee", workType: "boh" }];
    // CC chunk H9: two days off (5 dates each) — the roster gains H9_EXTRA so F0f still tests unknown skills, not a short roster.
    return small({ structure: noMod(), specs: [...SMALL_SPECS, ...extra, ...H9_EXTRA].map((p) => ({ ...p, skills: undefined, close: undefined })) });
  },
  "F0g-history": () => {
    const retired = "5c000000-0000-4000-8000-00000000ff01";
    const head: HeadSnapshot = {
      revisionId: "rev-1", closingWindowByDate: { [WEEK]: { fromQ: 80, toQ: 83 } }, gaps: [],
      shifts: [
        { userId: "u-b-bo", date: WEEK, startQ: 44, endQ: 52, segments: [{ positionId: I.$REG, startQ: 44, endQ: 52 }], closingManager: false, flex: false, pinned: false },
        { userId: "u-x-gone", date: WEEK, startQ: 38, endQ: 56, segments: [{ positionId: I.$BOI, startQ: 38, endQ: 56 }], closingManager: false, flex: false, pinned: false },
        { userId: "u-c-cy", date: WEEK, startQ: 42, endQ: 60, segments: [{ positionId: retired, startQ: 42, endQ: 60 }], closingManager: false, flex: false, pinned: false },
      ],
      days: [{ date: WEEK, originRevisionId: "rev-1", structureVersionId: "sv-old", inherited: false, problems: [{ code: "shift_below_minimum", severity: "error", day: WEEK, userId: "u-b-bo", q: 44, params: { minutes: 120, minimumMinutes: 240 }, inherited: false }] }],
    };
    return fixture({ specs: [...SMALL_SPECS, { id: "u-x-gone", role: "employee", active: false }], today: DATES[1]!, days: [day(DATES[1]!)], head });
  },
  "F0h-insufficient-capacity": () => {
    const s = onePosition((x) => {
      x.positions[I.$REG]!.allowedRoles = ["trainer"];
      x.positions[I.$WALKON] = { ...x.positions[I.$REG]!, role: "walk_online" };
      for (const t of ["slow", "normal", "busy", "weekend"] as const) { x.crews[t].lineMinHeads = { [I.$REG]: 1, [I.$WALKON]: 1 }; x.crews[t].waves.setup.heads = 2; }
    });
    return fixture({ structure: s, specs: [{ id: "u-t", role: "trainer", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-e", role: "employee" }], days: [f10Day(WEEK, s, null)], budgetByDate: { ...budgetAll(null), [WEEK]: 400 } });
  },
  "F0i-fourth-donor": f0iFourthDonor,
  "F0j-long-chain": () => f0jLongChain(false),
  "F0j-four-links": () => f0jLongChain(true),
  // F1–F9: the scenarios.
  "F1-mockup-v17": () => fixture({ specs: V17_SPECS, days: v17Days(structure()) }),
  "F2-busy": () => fixture({ specs: V17_SPECS, days: v17Days(structure()).map((d) => ({ ...d, dayType: "busy" as const, dayTypeSource: "override" as const, overrideId: "o-busy" })) }),
  "F3-slow": () => fixture({ specs: V17_SPECS, days: v17Days(structure()).map((d) => ({ ...d, dayType: "slow" as const, dayTypeSource: "override" as const, overrideId: "o-slow" })) }),
  "F4-station-trim": () => { const s = structure((x) => { x.positions[I.$THIRD]!.trimQ = 60; x.positions[I.$THIRD]!.closeQ = 60; x.positions[I.$REG]!.headsBefore = 2; x.crews.normal.waves.rush.heads = 4; }); return fixture({ structure: s, specs: V17_SPECS, days: v17Days(s) }); },
  "F5-priority-flipped": () => {
    const s = structure((x) => { x.priority = x.priority.map((p) => (p.pair.includes(I.$WALK) ? { ...p, primary: I.$WALK } : p)); for (const t of ["slow", "normal", "busy", "weekend"] as const) { x.crews[t].lineMinHeads[I.$WALK] = 1; x.crews[t].lineMinHeads[I.$WALKON] = 0; } });
    return fixture({ structure: s, specs: V17_SPECS, days: v17Days(s) });
  },
  "F6-sparse-sim": () => small({ specs: SMALL_SPECS.slice(0, 9), days: DATES.map((d) => day(d, { demandKind: "no_history", hourlyCents: null, dayCents: null, dayTypeSource: "no_history" })) }),
  "F7-dst-fall": () => small(), // the week of 2026-10-26: Nov 1 is the DST end; the quarter grid is wall-clock, nothing moves
  "F8-partial-month": () => small({ today: DATES[1]!, days: DATES.slice(2, 6).map((d) => day(d)) }), // rest of month from Oct 27: build Oct 28–31; Oct 26, 27 and Nov 1 kept (empty)
  "F9-edited-head": () => {
    const head: HeadSnapshot = {
      revisionId: "rev-edit", gaps: [], closingWindowByDate: Object.fromEntries(DATES.map((d) => [d, { fromQ: 80, toQ: 83 }])),
      shifts: DATES.map((d) => ({ userId: "u-b-bo", date: d, startQ: 42, endQ: 62, segments: [{ positionId: I.$REG, startQ: 42, endQ: 62 }], closingManager: false, flex: false, pinned: false })),
      days: DATES.map((d) => ({ date: d, originRevisionId: "rev-edit", structureVersionId: SV, inherited: false, problems: [] })),
    };
    return small({ today: DATES[1]!, days: DATES.slice(1).map((d) => day(d)), head });
  },
  // F10 / F14 / F15 through the generator.
  "F10-shifted-peaks": () => {
    const s = f10Structure();
    return fixture({ structure: s, specs: f10People, days: [f10Day(DATES[0]!, s, f10Cents([20000, 40000, 20000, 20000])), f10Day(DATES[1]!, s, f10Cents([20000, 20000, 40000, 20000])), f10Day(DATES[2]!, s, null)] });
  },
  "F14-zero-demand": () => { const s = f10Structure(); return fixture({ structure: s, specs: f10People, days: [f10Day(WEEK, s, f10Cents([0, 0, 0, 0]))] }); },
  "F15-zero-profile": () => {
    const s = f10Structure(true);
    return fixture({ structure: s, specs: [{ id: "u-p3", role: "employee", skills: { [F10_IDS.WK]: [0.9, 0.7] } }, { id: "u-p4", role: "employee", skills: { [F10_IDS.EX]: [0.9, 0.7] } }], days: [f10Day(WEEK, s, f10Cents([40000, 0, 0, 40000]))] });
  },
  // Budgets and the inherited unresolved gap.
  "F11-budget-week-then-month": () => small({ structure: noMod(), days: DATES.map((d) => day(d, {}, noMod())), budgetByDate: { ...budgetAll(60), [DATES[6]!]: 48 } }),
  "F13-budget-partial-week": () => small({ structure: noMod(), days: DATES.map((d) => day(d, {}, noMod())), budgetByDate: { ...budgetAll(40), [DATES[6]!]: null } }),
  "F17-inherited-unresolved": () => small({ today: DATES[2]!, days: DATES.slice(2, 6).map((d) => day(d)), head: headWithUnresolvedSunday() }),
};
