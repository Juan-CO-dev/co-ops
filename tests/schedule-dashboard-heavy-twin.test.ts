/**
 * PR SCH (plan r5, 12.7; r1 8.7; rulings A4, D5): THE TWIN — the schedule and the Dashboard read ONE rule. For r1's 8.1
 * table and 200 generated order sets (a seeded LCG), the two views agree on:
 *  (a) the heavy verdict: the Dashboard's heavy day = `isHeavyCateringDay` = the schedule's sites A (the stations per-day
 *      limit rise) and C (the crew catering shift's extra heads);
 *  (b) every order's window: the schedule's `cateringWindows` = `cateringPrepWindowQ` over the Dashboard's own orders;
 *  (c) THE START: for every opening status (none / proposed / declined / accepted / manual / auto) the schedule's built
 *      `DayContext` gives `scheduledDayStartQ(day, saved)`, and fed to `buildDay` as the loader would
 *      (`{ kind: "scheduled", q }`), the Dashboard's day start is exactly the schedule's — never earlier.
 * (d) The unknown start and the loader cases (settings drift, inherited origins, a failed context read) are on the real
 *     loader in tests/day-plan-load.test.ts (22.3, 23.2) and the engine table in tests/day-plan-heavy-catering.test.ts (22.4).
 * (e) Lead ruling H2 (SCH-1 code review r1): the same start agreement on REAL generator output. (c) above builds its own
 *     `DayContext` (kept as the helper-level SCH-2 prep for the proposed / auto statuses); (e) runs the actual generator of
 *     each engine (stations `buildWeek` on the SCH stations week, its 120-guest Wednesday; crew `generateWeek` on the P Street
 *     week, its heavy-by-total Tuesday), stores the week's context through the real snapshot path (`toContextSnapshot`),
 *     reads the date's start from the stored JSON as the loader's path does (`days-><date>->structure->shopDay->prepStartQ`),
 *     maps it with the loader's own `dayPrepStarts` (-> `dayPrepStartFor`) and feeds `buildDay`. The Dashboard's start must be
 *     the schedule's: the date's applied opening (none / accepted / manual) AND the first quarter its board covers or declares.
 * (f) PR SCH-2: the same on real generator output with the shop's STORED mode (`catering.earlyOpenMode`): semi stores a
 *     proposal and the Dashboard keeps the usual start (a proposal never moves either view); auto opens the date and the
 *     Dashboard's start is the opening, both engines.
 */
import { describe, expect, it } from "vitest";
import { dayPrepStarts, type ScheduleStartRows } from "@/lib/day-plan-load-shared";
import { buildDay, type CateringOrder, type DayPrepStart, type ShopFacts } from "@/lib/day-plan-shared";
import { cateringPrepWindowQ, isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import { toContextSnapshot, type DayContext } from "@/lib/scheduling/context-shared";
import { crewRequired } from "@/lib/scheduling/crew-gap-verifier-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { resolveOpening, scheduledDayStartQ, structureForDay, type OpeningDecision, type OpeningStatus } from "@/lib/scheduling/opening-shared";
import { cateringWindows } from "@/lib/scheduling/people-rules-shared";
import { scheduledOut, type ScheduleStructure, type ShiftType } from "@/lib/scheduling/structure-shared";
import { ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";
import { DATES as CREW_DATES, WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { DATES as ST_DATES, I, structure, WEEK as ST_WEEK } from "./fixtures/schedule/fixtures";
import { schCrewInputs, schStationsWeek } from "./fixtures/schedule/sch-fixtures";

type Raw = { headcount: number | null; eventQ: number | null };
const TABLE: Array<{ name: string; orders: Raw[]; min: number }> = [
  { name: "3 × 20", orders: [{ headcount: 20, eventQ: 36 }, { headcount: 20, eventQ: 44 }, { headcount: 20, eventQ: 50 }], min: 30 },
  { name: "1 × 25", orders: [{ headcount: 25, eventQ: 48 }], min: 30 },
  { name: "1 × 120", orders: [{ headcount: 120, eventQ: 36 }], min: 30 },
  { name: "20 + no count + 15", orders: [{ headcount: 20, eventQ: 40 }, { headcount: null, eventQ: 38 }, { headcount: 15, eventQ: null }], min: 30 },
  { name: "setting 0, one order", orders: [{ headcount: 5, eventQ: 52 }], min: 0 },
  { name: "setting 0, no order", orders: [], min: 0 },
];
function generated(n: number): Array<{ name: string; orders: Raw[]; min: number }> {
  let seed = 20261121;
  const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  return Array.from({ length: n }, (_, i) => ({
    name: `generated #${i}`, min: [0, 30, 60][rnd(3)]!,
    orders: Array.from({ length: rnd(5) }, () => ({ headcount: rnd(6) === 0 ? null : rnd(90), eventQ: rnd(5) === 0 ? null : 24 + rnd(57) })),
  }));
}
const CASES = [...TABLE, ...generated(200)];

const TYPE: ShiftType = { id: "opener", name: "Opener", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$PREP], countsTowardMod: true };
const shop = (min: number, engine: "stations" | "crew" = "stations"): ScheduleStructure => structure((s) => {
  s.catering.minHeadcount = min;
  if (engine === "crew") { s.engine = "crew"; s.shiftTypes = [TYPE]; s.catering.crewShift = { enabled: true, typeId: "opener", extraHeads: 1 }; }
});
/** The schedule's events (a missing count becomes 0, as the loader's conversion does). */
const events = (orders: Raw[]) => orders.map((o, i) => ({ id: `o-${i}`, headcount: o.headcount ?? 0, eventQ: o.eventQ }));
/** The Dashboard's facts for the same orders (a missing count stays null), with the loader's per-date start. */
function dashboard(orders: Raw[], s: ScheduleStructure, start?: number | DayPrepStart): ShopFacts {
  const base = pStreet(0);
  if (base.hours.kind !== "ok") throw new Error("hours");
  const dash: CateringOrder[] = orders.map((o, i) => ({ id: `o-${i}`, source: "pipeline", eventQ: o.eventQ, headcount: o.headcount, state: "to_go_out", outAt: null }));
  return { ...base, cateringToday: ok({ forDate: PLAN_DATE, orders: dash }),
    hours: ok({ ...base.hours.value, shopDay: { prepStartQ: s.shopDay.prepStartQ, serviceStartQ: s.shopDay.serviceStartQ }, catering: { ...base.hours.value.catering, minHeadcount: s.catering.minHeadcount },
      dayPrepStartQ: start === undefined ? {} : { [PLAN_DATE]: typeof start === "number" ? { kind: "scheduled" as const, q: start } : start } as Record<string, DayPrepStart> }) };
}
/** The schedule's built DayContext for a date, at a given opening status. */
function scheduleDay(s: ScheduleStructure, orders: Raw[], status: OpeningStatus | "none"): DayContext {
  const ev = events(orders);
  const persistent: Record<string, OpeningDecision> = { accepted: { kind: "accepted", startQ: 22 }, manual: { kind: "manual", startQ: 23 }, declined: { kind: "declined" } };
  const n = buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: scheduledOut(s, 45), hourlyCents: null, demandKind: "no_history", catering: ev,
    ...(persistent[status] ? { decision: persistent[status] } : {}) });
  let { structure: ds, opening } = n;
  if (status === "proposed" || status === "auto") {
    // The helper-level proposed / auto cases (the mode given explicitly); (f) below runs them through the stored mode (SCH-2).
    opening = resolveOpening(s, ev, null, status === "auto" ? "auto" : "semi");
    ds = structureForDay(s, ev, opening).structure;
  }
  return { structureVersionId: "sv", structure: ds, dayType: "normal", closingMinutes: 45, scheduledOutQ: scheduledOut(s, 45), need: n.need,
    inputs: { demandKind: "no_history", hourlyCents: null, dayCents: null, dayTypeSource: "no_history", overrideId: null, cateringEvents: ev },
    ...(opening ? { opening } : {}) };
}
const dashboardStart = (f: ShopFacts) => buildDay(PLAN_DATE, 0, f).items.find((i) => i.id === "opening")!.at;

describe("the twin: one rule, two views", () => {
  it(`(a) the same heavy verdict on ${CASES.length} order sets: the Dashboard = isHeavyCateringDay = site A (stations limit rise) = site C (crew extra heads)`, () => {
    for (const c of CASES) {
      const s = shop(c.min);
      const heavy = isHeavyCateringDay(c.orders, s.catering);
      expect(buildDay(PLAN_DATE, 0, dashboard(c.orders, s)).heavy.today?.heavy ?? false, c.name).toBe(heavy);
      expect(isHeavyCateringDay(events(c.orders), s.catering), c.name).toBe(heavy);
      expect(structureForDay(s, events(c.orders), null).base !== null, `${c.name} site A`).toBe(heavy);
      const crew = scheduleDay(shop(c.min, "crew"), c.orders, "none");
      expect(crewRequired(TYPE, crew) - 1, `${c.name} site C`).toBe(heavy ? 1 : 0);
    }
  });

  it("(b) the same per-order windows: the schedule's cateringWindows = cateringPrepWindowQ over the Dashboard's orders", () => {
    for (const c of CASES) {
      const s = shop(c.min);
      const sorted = c.orders.map((o, i) => ({ ...o, id: `o-${i}` })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(cateringWindows(scheduleDay(s, c.orders, "none")), c.name).toEqual(sorted.map((o) => [...cateringPrepWindowQ(o.eventQ, s.catering)]));
    }
  });

  it("(c) the start agrees for every opening status: the Dashboard's day start IS the schedule's (never earlier)", () => {
    const statuses = ["none", "proposed", "declined", "accepted", "manual", "auto"] as const;
    for (const c of [...TABLE, ...generated(60)]) {
      for (const engine of ["stations", "crew"] as const) {
        const s = shop(c.min, engine);
        for (const status of statuses) {
          const day = scheduleDay(s, c.orders, status);
          const q = scheduledDayStartQ(day, s);
          const label = `${c.name} ${engine} ${status}`;
          expect(dashboardStart(dashboard(c.orders, s, q)), label).toBe(q * 15);
          // An applied opening is the only thing that moves it, and never later than the usual start.
          if (status === "accepted" || status === "manual") expect(q, label).toBeLessThan(s.shopDay.prepStartQ);
          if (status === "none" || status === "proposed" || status === "declined") expect(q, label).toBe(s.shopDay.prepStartQ);
          if (status === "auto") expect(q, label).toBe(day.opening ? day.opening.startQ : s.shopDay.prepStartQ);
        }
      }
    }
  });

  it("the Dashboard no longer moves the start on a heavy day by itself: with no schedule it is the saved start, 120 guests at 9:00 or not", () => {
    const s = shop(30);
    expect(dashboardStart(dashboard([{ headcount: 120, eventQ: 36 }], s))).toBe(28 * 15);
    expect(dashboardStart(dashboard([], s))).toBe(28 * 15);
  });
});

/**
 * (e) The loader's read of ONE stored context, exactly as `lib/day-plan.ts` does it: the head's row for the date (no inherited
 * origin), the JSON path `days-><date>->structure->shopDay->prepStartQ` over the snapshot as stored, then the loader's own
 * mapping (`dayPrepStarts` -> `dayPrepStartFor`).
 */
function loaderStart(storedJson: string, weekStart: string, date: string): DayPrepStart | undefined {
  const stored = JSON.parse(storedJson) as { days?: Record<string, { structure?: { shopDay?: { prepStartQ?: unknown } } }> };
  const rows: ScheduleStartRows = {
    weeks: [{ week_start: weekStart, head_revision_id: "rev-head" }],
    days: [{ revision_id: "rev-head", business_date: date, origin_revision_id: null }],
    starts: { "rev-head": { [date]: stored.days?.[date]?.structure?.shopDay?.prepStartQ } },
  };
  return dayPrepStarts(rows, [date], () => weekStart)[date];
}
/** The first quarter the date's board covers or declares: a shift's start or a declared gap's start. */
const boardStartQ = (out: GeneratorOutput, date: string) =>
  Math.min(...out.shifts.filter((x) => x.date === date).map((x) => x.startQ), ...out.gaps.filter((g) => g.date === date).map((g) => g.fromQ));

type Decision = { kind: "accepted"; startQ: number } | { kind: "manual"; startQ: number } | null;
const ENGINES: Record<"stations" | "crew", (decision: Decision) => { out: GeneratorOutput; date: string; s: ScheduleStructure; week: string; orders: Raw[] }> = {
  // The SCH stations week (v17 roster), its 120-guest Wednesday.
  stations: (decision) => {
    const input = schStationsWeek();
    const date = ST_DATES[2]!;
    input.days = input.days.map((d) => (d.date === date && decision ? { ...d, decision } : d));
    return { out: buildWeek(input), date, s: input.structure, week: ST_WEEK, orders: [{ headcount: 120, eventQ: 36 }] };
  },
  // The P Street crew week (the live configuration, its own structure), its 3 x 20 Tuesday (heavy by the day total only).
  crew: (decision) => {
    const date = CREW_DATES[1]!;
    const g = generatorInputFor(schCrewInputs(), CREW_WEEK, { today: CREW_WEEK, ...(decision ? { openingOverride: { date, decision } } : {}) });
    return { out: generateWeek(g), date, s: g.structure, week: CREW_WEEK, orders: [0, 1, 2].map(() => ({ headcount: 20, eventQ: 36 })) };
  },
};

describe("(e) ruling H2: the twin on real generator output, through the snapshot and the loader's mapping, both engines", () => {
  const decisions: Array<[string, Decision]> = [["none", null], ["accepted 5:30", { kind: "accepted", startQ: 22 }], ["manual 5:45", { kind: "manual", startQ: 23 }]];
  for (const engine of ["stations", "crew"] as const) {
    for (const [label, decision] of decisions) {
      it(`${engine}, heavy date, opening ${label}: the Dashboard's start is the generated schedule's`, () => {
        const { out, date, s, week, orders } = ENGINES[engine](decision);
        expect(out.context.days[date]!.structure.engine ?? "stations").toBe(engine);
        expect(isHeavyCateringDay(orders, s.catering)).toBe(true);
        const expected = decision ? decision.startQ : s.shopDay.prepStartQ;
        // The schedule's start, read from the schedule itself (not from the stored structure the Dashboard reads).
        expect(out.context.days[date]!.opening?.status ?? "none").toBe(decision ? decision.kind : "none");
        expect(out.context.days[date]!.opening?.startQ ?? s.shopDay.prepStartQ).toBe(expected);
        expect(boardStartQ(out, date)).toBe(expected);
        // The Dashboard: the snapshot as stored -> the loader's path and mapping -> buildDay.
        const start = loaderStart(toContextSnapshot(out.context).json, week, date);
        expect(start).toEqual({ kind: "scheduled", q: expected });
        expect(dashboardStart(dashboard(orders, s, start))).toBe(expected * 15);
      }, 120000);
    }
  }
});

describe("(f) PR SCH-2: the twin with the stored mode, real generator output, both engines", () => {
  const run = (engine: "stations" | "crew", mode: "semi" | "auto") => {
    if (engine === "stations") {
      const input = schStationsWeek();
      input.structure = { ...input.structure, catering: { ...input.structure.catering, earlyOpenMode: mode } };
      return { out: buildWeek(input), date: ST_DATES[2]!, s: input.structure, week: ST_WEEK, orders: [{ headcount: 120, eventQ: 36 }] };
    }
    const inputs = schCrewInputs();
    inputs.structure = { ...inputs.structure, structure: { ...inputs.structure.structure, catering: { ...inputs.structure.structure.catering, earlyOpenMode: mode } } };
    const g = generatorInputFor(inputs, CREW_WEEK, { today: CREW_WEEK });
    return { out: generateWeek(g), date: CREW_DATES[1]!, s: g.structure, week: CREW_WEEK, orders: [0, 1, 2].map(() => ({ headcount: 20, eventQ: 36 })) };
  };
  for (const engine of ["stations", "crew"] as const) {
    for (const mode of ["semi", "auto"] as const) {
      it(`${engine}, ${mode}: the Dashboard's start is the generated schedule's (${mode === "semi" ? "a proposal moves neither" : "the automatic opening"})`, () => {
        const { out, date, s, week, orders } = run(engine, mode);
        const expected = mode === "auto" ? 22 : s.shopDay.prepStartQ;
        expect(out.context.days[date]!.opening).toMatchObject({ status: mode === "auto" ? "auto" : "proposed", startQ: 22 });
        expect(boardStartQ(out, date)).toBe(expected);
        const start = loaderStart(toContextSnapshot(out.context).json, week, date);
        expect(start).toEqual({ kind: "scheduled", q: expected });
        expect(dashboardStart(dashboard(orders, s, start))).toBe(expected * 15);
      }, 120000);
    }
  }
});
