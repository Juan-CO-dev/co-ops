import { describe, expect, it } from "vitest";
import { buildCrewWeek, CREW_GENERATOR_VERSION } from "@/lib/scheduling/generator/crew-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { buildWeek, GENERATOR_VERSION, type GeneratorInput, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { checkCertificate, checkScheduleRules, generatorRefuses, MOD, proveGap, REPAIR_LIMITS, salariedWeek, shiftCountsAsMod, type DeclaredGap, type WeekSchedule } from "@/lib/scheduling/rules-shared";
import { verifyCrewGap } from "@/lib/scheduling/crew-gap-verifier-shared";
import type { ShiftType, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { structureProblem } from "@/lib/scheduling/structure-shared";
import { DATES, I, day, fixture, structure, type PersonSpec } from "./fixtures/schedule/fixtures";

const MON = DATES[0]!;
const TUE = DATES[1]!;

it("assigns a BOH primary before its lexically earlier secondary", () => {
  const prep = "00000000-0000-4000-8000-000000000001";
  const dish = "00000000-0000-4000-8000-000000000002";
  const s = shop((st) => {
    st.positions = {
      [prep]: { role: "prep", openQ: 44, trimQ: 64, closeQ: 64, headsBefore: 1, headsAfter: 1, allowedRoles: ["employee"] },
      [dish]: { role: "prep_dish", openQ: 44, trimQ: 64, closeQ: 64, headsBefore: 1, headsAfter: 1, allowedRoles: ["employee"] },
    };
    st.priority = [{ pair: [prep, dish], primary: dish }];
    st.shiftTypes = [type({ stations: [prep, dish], headcount: { slow: 2, normal: 2, busy: 2, weekend: 2 } })];
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) {
      st.crews[dt].prepHeads = 1; st.crews[dt].prepDishHeads = 1; st.crews[dt].prepUntilQ = 64;
      st.crews[dt].lineMinHeads = {};
    }
  });
  const i = input([{ id: "a", role: "employee", workType: "boh", cover: [prep] }, { id: "b", role: "employee", workType: "boh", cover: [dish] }], s);
  const out = buildCrewWeek(i);
  for (const id of [prep, dish]) expect(out.shifts.some((sh) => sh.segments.some((g) => g.positionId === id && g.startQ === 44 && g.endQ === 64))).toBe(true);
  clean(out); stationHolds(out, "BOH primary");
});
const type = (over: Partial<ShiftType> = {}): ShiftType => ({ id: "mid", name: "Mid", fromQ: 44, toQ: 64, startFlexQ: 0, minLengthQ: 16,
  headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$REG], countsTowardMod: true, ...over });
function shop(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  return structure((s) => {
    s.engine = "crew";
    s.shiftTypes = [type()];
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 44, serviceCloseQ: 64, outEarliestQ: 64, outLatestQ: 68 };
    s.positions = { [I.$REG]: { role: "register", openQ: 44, trimQ: 64, closeQ: 64, headsBefore: 1, headsAfter: 1,
      allowedRoles: ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"] } };
    s.priority = [];
    s.leadership.modRequired = false;
    s.limits.gmMinimumH = 4;
    s.limits.agmMinimumH = 4;
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) s.crews[dt] = {
      prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0, waves: { setup: { heads: 1, atQ: 44 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } },
      close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 }, lineMinHeads: { [I.$REG]: 1 },
    };
    over(s);
  });
}
function input(specs: PersonSpec[] = [{ id: "a", role: "employee" }], s = shop(), dates = [MON]): GeneratorInput {
  const result = fixture({ structure: s, specs, days: dates.map((date) => day(date, { scheduledOutQ: 64, closingMinutes: 0, demandKind: "no_history", hourlyCents: null, dayCents: null }, s)) });
  for (const p of result.people) p.workModes = Object.fromEntries(DATES.map((d) => [d, p.availability[d] === null ? "off" : "works"]));
  return result;
}
function usual(i: GeneratorInput, id: string, typeId = "mid", fromQ: number | null = null, toQ: number | null = null): void {
  i.people.find((p) => p.userId === id)!.usualShift = { value: fromQ === null || toQ === null ? { typeId } : { typeId, fromQ, toQ }, source: "manager", deletedTypeId: null };
}
const users = (out: GeneratorOutput, date = MON) => out.shifts.filter((s) => s.date === date).map((s) => s.userId);
const week = (out: GeneratorOutput): WeekSchedule => ({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, days: out.days, gaps: out.gaps });
function clean(out: GeneratorOutput): void {
  const schedule = week(out);
  const problems = checkScheduleRules(schedule, out.context);
  expect(problems.filter((p) => !p.inherited && generatorRefuses(p))).toEqual([]);
  for (const gap of out.gaps) {
    expect(checkCertificate(gap, schedule, out.context), JSON.stringify(gap)).toBe(true);
    if (gap.cause === "crew_shortfall") expect(verifyCrewGap(gap, schedule, out.context), JSON.stringify(gap)).toBe(true);
  }
}
/** The validator does not enforce station holds; assert this generator contract independently. */
function stationHolds(out: GeneratorOutput, label: string): void {
  for (const sh of out.shifts) {
    const day = out.context.days[sh.date];
    const meta = day?.crew?.shifts.find((m) => m.userId === sh.userId && m.startQ === sh.startQ);
    if (!day || sh.pinned || meta?.source === "pin" || meta?.source === "manual" || out.days.find((d) => d.date === sh.date)?.inherited) continue;
    const runs: Array<{ positionId: string; startQ: number; endQ: number }> = [];
    for (const segment of sh.segments) {
      const last = runs[runs.length - 1];
      if (last?.positionId === segment.positionId && last.endQ === segment.startQ) last.endQ = segment.endQ;
      else runs.push({ positionId: segment.positionId, startQ: segment.startQ, endQ: segment.endQ });
    }
    for (const run of runs.filter((r) => r.positionId !== MOD)) expect(run.endQ - run.startQ,
      `${label}, ${sh.date}, ${sh.userId}: ${JSON.stringify(sh.segments)}`).toBeGreaterThanOrEqual(day.structure.limits.segmentMinQ);
  }
}

describe("crew dispatch and usual blocks", () => {
  it("dispatches without changing the station path or its version", () => {
    const station = input(); station.structure.engine = "stations";
    expect(generateWeek(station)).toEqual(buildWeek(station));
    expect(generateWeek(station).version).toBe(GENERATOR_VERSION);
    const crew = input();
    expect(generateWeek(crew)).toEqual(buildCrewWeek(crew));
    expect(generateWeek(crew).version).toBe(CREW_GENERATOR_VERSION);
    expect(CREW_GENERATOR_VERSION).not.toBe(GENERATOR_VERSION);
  });
  it("places the complete usual block and records its type and source", () => {
    const i = input(); usual(i, "a"); const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ userId: "a", startQ: 44, endQ: 64 }]);
    expect(out.context.days[MON]!.crew!.shifts).toEqual([{ userId: "a", startQ: 44, typeId: "mid", source: "usual" }]);
    clean(out);
  });
  it("clips a usual block to availability without extending it", () => {
    const i = input([{ id: "a", role: "employee", window: { fromQ: 48, toQ: 68 } }]); usual(i, "a");
    const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ startQ: 48, endQ: 64 }]); clean(out);
  });
  it("refuses a clipped fragment below the effective minimum and names the omitted person", () => {
    const i = input([{ id: "a", role: "employee", window: { fromQ: 49, toQ: 64 } }]); usual(i, "a");
    const out = buildCrewWeek(i);
    expect(out.shifts).toEqual([]);
    expect(out.notes.some((n) => n.userId === "a")).toBe(true);
    expect(out.gaps.some((g) => g.code === "open_shift")).toBe(true); clean(out);
  });
  it("keeps all usual people above target, preserving unassigned paid time", () => {
    const i = input([{ id: "a", role: "employee" }, { id: "b", role: "employee" }]); usual(i, "a"); usual(i, "b");
    const out = buildCrewWeek(i);
    expect(users(out)).toEqual(["a", "b"]);
    expect(out.shifts.every((s) => s.startQ === 44 && s.endQ === 64)).toBe(true);
    expect(out.shifts.some((s) => s.segments.some((seg) => seg.positionId === MOD))).toBe(true); clean(out);
  });
  it("honors own times rather than silently replacing them with the type's standard block", () => {
    const i = input(); usual(i, "a", "mid", 40, 60);
    const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ startQ: 40, endQ: 60 }]); clean(out);
  });
  it("excludes explicit Off and time-off dates even when availability would fit", () => {
    const i = input([{ id: "a", role: "employee" }, { id: "b", role: "employee" }]);
    usual(i, "a"); usual(i, "b"); i.people[0]!.workModes![MON] = "off"; i.people[1]!.untouchableDates = [MON];
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]); clean(out);
  });
});

describe("crew fixed inputs and weekly accounting", () => {
  it("reserves a pin before usual placement and never allocates a second overlapping block", () => {
    const i = input(); usual(i, "a");
    i.pins = [{ id: "pin", userId: "a", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
    const out = buildCrewWeek(i);
    expect(out.shifts).toHaveLength(1); expect(out.shifts[0]).toMatchObject({ userId: "a", startQ: 44, endQ: 64, pinned: true }); clean(out);
  });
  it("surfaces an invalid fixed input without moving the pin to repair it", () => {
    const i = input([{ id: "a", role: "employee", window: { fromQ: 48, toQ: 64 } }]);
    i.pins = [{ id: "pin", userId: "a", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
    const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ userId: "a", startQ: 44, endQ: 64, pinned: true }]);
    expect(out.problems.some((p) => p.code === "outside_assumed_availability")).toBe(true);
  });
  it("preserves a manual deletion across regeneration", () => {
    const i = input(); usual(i, "a");
    i.crew = { manualOverridesByDate: { [MON]: [{ original: { userId: "a", date: MON, startQ: 44 }, replacement: null }] } };
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    expect(out.context.days[MON]!.crew!.manualOverrides).toEqual(i.crew.manualOverridesByDate![MON]); clean(out);
  });
  it("keeps past shifts, reasons, gaps and original day context exactly", () => {
    const first = buildCrewWeek(input());
    const i = input(undefined, shop(), [TUE]); i.today = TUE;
    i.head = { revisionId: "head", shifts: first.shifts, days: first.days.map((d) => ({ ...d, originRevisionId: d.originRevisionId ?? "head" })), gaps: first.gaps, reasons: first.reasons, closingWindowByDate: first.context.closingWindowByDate ?? {} };
    i.crew = { headContext: first.context };
    const out = buildCrewWeek(i);
    expect(out.shifts.filter((s) => s.date === MON)).toEqual(first.shifts);
    expect(out.context.days[MON]).toEqual(first.context.days[MON]);
    expect(out.gaps.filter((g) => g.date === MON)).toEqual(first.gaps);
    for (const [key, reasons] of Object.entries(first.reasons)) expect(out.reasons[key]).toEqual(reasons);
    expect(out.days.find((d) => d.date === MON)).toMatchObject({ inherited: true, originRevisionId: "head" }); clean(out);
  });
  it("never trims a usual shift at the overtime threshold, but notes the overtime", () => {
    const s = shop((s) => { s.limits.overtimeH = 4; }); const i = input(undefined, s); usual(i, "a");
    const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ startQ: 44, endQ: 64 }]);
    expect(out.notes.some((n) => n.code === "overtime_used" && n.userId === "a")).toBe(true); clean(out);
  });
  it("does not let a Step-2 block cross the overtime threshold", () => {
    const i = input(undefined, shop((s) => { s.limits.overtimeH = 4; }));
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]); clean(out);
  });
  it("counts inherited hours against the Step-2 overtime guard", () => {
    const firstInput = input(); usual(firstInput, "a"); const first = buildCrewWeek(firstInput);
    const i = input(undefined, shop((s) => { s.limits.overtimeH = 8; }), [TUE]); i.today = TUE;
    i.head = { revisionId: "head", shifts: first.shifts, days: first.days, gaps: first.gaps, reasons: first.reasons, closingWindowByDate: first.context.closingWindowByDate ?? {} };
    i.crew = { headContext: first.context };
    const out = buildCrewWeek(i); expect(users(out, TUE)).toEqual([]); expect(users(out, MON)).toEqual(["a"]); clean(out);
  });
  it("keeps a manual replacement's complete time and stations fixed", () => {
    const i = input(); usual(i, "a");
    const replacement = { userId: "a", date: MON, startQ: 48, endQ: 64, segments: [{ positionId: I.$REG, startQ: 48, endQ: 64 }], closingManager: false, flex: false, pinned: false };
    i.crew = { manualOverridesByDate: { [MON]: [{ original: { userId: "a", date: MON, startQ: 44 }, replacement }] } };
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([replacement]); clean(out);
  });
  it("admits an exactly affordable block and refuses one quarter less without shaving it", () => {
    const i = input(); usual(i, "a"); i.budgetByDate[MON] = 5;
    const fits = buildCrewWeek(i); expect(fits.shifts).toHaveLength(1); clean(fits);
    i.budgetByDate[MON] = 4.75;
    const short = buildCrewWeek(i); expect(short.shifts).toEqual([]);
    expect(short.notes.some((n) => n.code === "budget_stopped")).toBe(true); clean(short);
  });
  it("preserves the essential-closing exemption as a complete block", () => {
    const s = shop((s) => {
      s.shopDay.serviceCloseQ = 60;
      for (const dt of ["slow", "normal", "busy", "weekend"] as const) s.crews[dt].close.registerHeads = 1;
    });
    const i = input([{ id: "lead", role: "shift_lead", leader: "mix", cover: [I.$REG] }], s); usual(i, "lead"); i.budgetByDate[MON] = 0;
    const out = buildCrewWeek(i); expect(out.shifts).toMatchObject([{ startQ: 44, endQ: 64 }]);
    expect(out.notes.some((n) => n.code === "essential_past_budget")).toBe(true); clean(out);
  });
});

describe("crew fill, leadership and catering", () => {
  it("fills matching if-needed usual people before a more skilled general candidate", () => {
    const i = input([{ id: "a", role: "employee", skills: { [I.$REG]: [1, 1] } }, { id: "z", role: "employee", skills: { [I.$REG]: [0.2, 1] } }]);
    usual(i, "z"); i.people[1]!.workModes![MON] = "if_needed";
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["z"]); clean(out);
  });
  it("ranks deficit below minimum before skill inside the general tier", () => {
    const i = input([{ id: "a", role: "employee", softMin: 10, skills: { [I.$REG]: [1, 1] } }, { id: "z", role: "employee", softMin: 30, skills: { [I.$REG]: [0.5, 1] } }]);
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["z"]); clean(out);
  });
  it("ranks a primary position before a stronger secondary candidate", () => {
    const i = input([{ id: "a", role: "employee", cover: [I.$EXPO, I.$REG], softMin: 32, skills: { [I.$REG]: [1, 1] } },
      { id: "z", role: "employee", cover: [I.$REG], softMin: 10, skills: { [I.$REG]: [0.6, 1] } }]);
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["z"]); clean(out);
  });
  it("respects the weekly day cap and soft maximum rather than adding a partial seat", () => {
    const i = input([{ id: "a", role: "employee", softMax: 9 }], shop(), [MON, TUE]);
    const out = buildCrewWeek(i); expect(out.shifts).toHaveLength(1); clean(out);
    const all = input([{ id: "a", role: "employee", softMax: 50 }], shop(), DATES);
    const whole = buildCrewWeek(all);
    expect(new Set(whole.shifts.map((sh) => sh.date)).size).toBeLessThanOrEqual(5); clean(whole);
  });
  it("considers the full-time minimum and then uses descending skill for equal deficits", () => {
    const i = input([{ id: "a", role: "employee", softMin: 24, skills: { [I.$REG]: [0.9, 1] } }, { id: "z", role: "employee", softMin: 10, fullTime: true, fullTimeMinH: 32, skills: { [I.$REG]: [0.6, 1] } }]);
    expect(users(buildCrewWeek(i))).toEqual(["z"]);
    i.people[1]!.fullTime = false; i.people[1]!.softMinH = 24;
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["a"]); clean(out);
  });
  it("never circumvents leaderSettingAllows and records the leader-setting rejection", () => {
    const i = input([{ id: "a", role: "shift_lead", leader: "opens" }], shop((s) => { s.shiftTypes![0]!.minLengthQ = 20; })); usual(i, "a");
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    const opening = out.gaps.find((g) => g.code === "open_shift");
    expect(opening).toMatchObject({ cause: "crew_shortfall", certificate: { kind: "open_shifts", items: [{ rejected: [{ userId: "a", codes: expect.arrayContaining(["leader_setting"]) }] }] } }); clean(out);
  });
  it("salaried usual placement uses its whole block without arbitrary flex relabeling", () => {
    const i = input([{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG] }]); usual(i, "gm");
    const out = buildCrewWeek(i); expect(out.shifts).toMatchObject([{ userId: "gm", startQ: 44, endQ: 64 }]);
    expect(salariedWeek(week(out), "gm")).toMatchObject({ baseH: 5, flexH: 0 }); clean(out);
  });
  it("uses hourly candidates before if-needed salaried cover", () => {
    const i = input([{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG] }, { id: "z", role: "employee" }]);
    i.people[0]!.workModes![MON] = "if_needed";
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["z"]); clean(out);
    i.people[1]!.workModes![MON] = "off";
    const cover = buildCrewWeek(i); expect(users(cover)).toEqual(["gm"]); clean(cover);
  });
  it("marks only genuine salaried cover beyond the target as flex and respects its allowance", () => {
    const s = shop((s) => { s.limits.salariedTargetWeekH = 4; s.limits.salariedFlexH = 1; s.limits.managerFloorH = 4; });
    const i = input([{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG] }], s);
    i.people[0]!.workModes![MON] = "if_needed";
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["gm"]);
    expect(salariedWeek(week(out), "gm")).toEqual({ totalH: 5, baseH: 4, flexH: 1 }); clean(out);
    s.limits.salariedFlexH = 0.5;
    const refused = buildCrewWeek(i); expect(refused.shifts).toEqual([]); clean(refused);
  });
  it("does not relabel an over-target salaried usual block as flex", () => {
    const i = input([{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG] }], shop((s) => { s.limits.salariedTargetWeekH = 4; s.shiftTypes![0]!.headcount = { slow: 0, normal: 0, busy: 0, weekend: 0 }; }));
    usual(i, "gm"); const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    expect(out.notes.some((n) => n.userId === "gm")).toBe(true); clean(out);
  });
  it("keeps MoD coverage even when the type's headcount is already full", () => {
    const s = shop((s) => { s.leadership.modRequired = true; s.shopDay.prepStartQ = 44; });
    const i = input([{ id: "a", role: "employee" }, { id: "z", role: "gm", leader: "mix", cover: [I.$REG] }], s); usual(i, "a"); usual(i, "z");
    const out = buildCrewWeek(i); expect(users(out)).toEqual(["a", "z"]);
    for (let q = 44; q < 64; q++) expect(out.shifts.some((sh) => sh.startQ <= q && q < sh.endQ && shiftCountsAsMod(sh, out.context.people[sh.userId]!, out.context.days[MON]!, q))).toBe(true);
    clean(out);
  });
  it("reserves the only leader for a MoD-enabled type before filling a non-MoD seat", () => {
    const s = shop((s) => {
      s.shopDay.prepStartQ = 44; s.leadership.modRequired = true;
      s.shiftTypes = [type({ id: "non-mod", countsTowardMod: false }), type({ id: "leader", countsTowardMod: true })];
    });
    const i = input([{ id: "a", role: "shift_lead", leader: "mix", cover: [I.$REG], skills: { [I.$REG]: [1, 1] } },
      { id: "z", role: "employee", skills: { [I.$REG]: [0.6, 1] } }], s);
    const out = buildCrewWeek(i);
    expect(out.context.days[MON]!.crew!.shifts).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "a", typeId: "leader" }), expect.objectContaining({ userId: "z", typeId: "non-mod" }),
    ])); clean(out);
  });
  it("defers a leader's non-MoD usual block when that leader is the only whole-block MoD option", () => {
    const s = shop((s) => {
      s.shopDay.prepStartQ = 44; s.leadership.modRequired = true;
      s.shiftTypes = [type({ id: "non-mod", countsTowardMod: false }), type({ id: "leader", countsTowardMod: true })];
    });
    const i = input([{ id: "lead", role: "shift_lead", leader: "mix", cover: [I.$REG] }, { id: "worker", role: "employee" }], s);
    usual(i, "lead", "non-mod");
    const out = buildCrewWeek(i);
    expect(out.context.days[MON]!.crew!.shifts).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "lead", typeId: "leader" })]));
    expect(out.notes.some((n) => n.userId === "lead" && n.params.reason === "mod_reserved")).toBe(true); clean(out);
  });
  it("does not invent MoD before the key-holder boundary", () => {
    const s = shop((s) => { s.leadership.modRequired = true; s.leadership.keyHolderModAfterQ = 60; s.shopDay.prepStartQ = 44; });
    const i = input([{ id: "kh", role: "key_holder", leader: "mix" }], s); usual(i, "kh");
    const out = buildCrewWeek(i); const sh = out.shifts[0]!;
    expect(shiftCountsAsMod(sh, out.context.people.kh!, out.context.days[MON]!, 59)).toBe(false);
    expect(shiftCountsAsMod(sh, out.context.people.kh!, out.context.days[MON]!, 60)).toBe(true);
    expect(out.gaps.some((g) => g.code === "mod_missing" && g.fromQ < 60)).toBe(true); clean(out);
  });
  it("adds configured catering heads once per qualifying day, selected by ID", () => {
    const s = shop((s) => { s.catering.crewShift = { enabled: true, typeId: "mid", extraHeads: 1 }; });
    const i = input([{ id: "a", role: "employee" }, { id: "b", role: "employee" }, { id: "c", role: "employee" }], s);
    i.days[0]!.catering = [{ id: "e1", headcount: 100, eventQ: 52 }, { id: "e2", headcount: 100, eventQ: 56 }];
    const out = buildCrewWeek(i); expect(out.shifts).toHaveLength(2); clean(out);
    s.catering.crewShift!.enabled = false; expect(buildCrewWeek(i).shifts).toHaveLength(1);
    s.catering.crewShift!.enabled = true; i.days[0]!.catering = [{ id: "small", headcount: s.catering.minHeadcount - 1, eventQ: 52 }];
    expect(buildCrewWeek(i).shifts).toHaveLength(1);
  });
});

describe("crew station assignment and deterministic invariants", () => {
  it("accepts an honest zero-station-search leadership gap only for the crew engine", () => {
    const s = shop((s) => { s.leadership.modRequired = true; s.shopDay.prepStartQ = 44; s.shopDay.prepDishArrivalQ = 44; });
    const out = buildCrewWeek(input([{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG] }], s));
    const schedule = week(out); schedule.shifts = []; schedule.gaps = [];
    out.context.days[MON]!.crew!.shifts = [];
    const gap: DeclaredGap = { code: "mod_missing", cause: "unresolved_search", date: MON, positionId: null, fromQ: 44, toQ: 64,
      certificate: { searched: { steps: 0, donorsTried: 0, chainDepth: 0 }, limits: { ...REPAIR_LIMITS }, candidateIds: ["gm"] } };
    expect(proveGap(gap, schedule, out.context)).toBeNull();
    expect(checkCertificate(gap, schedule, out.context)).toBe(true);
    out.context.days[MON]!.structure.engine = "stations";
    expect(checkCertificate(gap, schedule, out.context)).toBe(false);
  });
  it("does not extend or add shifts to repair station demand outside the crew block", () => {
    const s = shop((s) => { s.shiftTypes![0]!.toQ = 60; }); const i = input(undefined, s); usual(i, "a");
    const out = buildCrewWeek(i);
    expect(out.shifts).toMatchObject([{ startQ: 44, endQ: 60 }]);
    expect(out.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ code: "coverage_gap", cause: "crew_shortfall", fromQ: 60, toQ: 64 })])); clean(out);
  });
  it("coalesces stable station assignments instead of manufacturing short segments", () => {
    const out = buildCrewWeek(input());
    expect(out.shifts[0]!.segments).toMatchObject([{ positionId: I.$REG, startQ: 44, endQ: 64 }]); clean(out);
  });
  it("fills a priority primary before its secondary and holds legal station segments", () => {
    const s = shop((s) => {
      s.positions[I.$EXPO] = { ...s.positions[I.$REG]!, role: "expo" };
      s.priority = [{ pair: [I.$REG, I.$EXPO], primary: I.$REG }];
      s.shiftTypes![0]!.stations = [I.$EXPO, I.$REG];
      for (const dt of ["slow", "normal", "busy", "weekend"] as const) { s.crews[dt].lineMinHeads[I.$EXPO] = 1; s.crews[dt].waves.setup.heads = 2; }
    });
    const out = buildCrewWeek(input([{ id: "a", role: "employee", cover: [I.$EXPO, I.$REG] }], s));
    expect(out.shifts[0]!.segments.every((seg) => seg.positionId === I.$REG || seg.positionId === MOD)).toBe(true);
    expect(out.shifts[0]!.segments.every((seg) => seg.endQ - seg.startQ >= s.limits.segmentMinQ)).toBe(true); clean(out);
  });
  it("reassigns the flexible on-clock person so the constrained person can cover the other station", () => {
    const s = shop((s) => {
      s.positions[I.$EXPO] = { ...s.positions[I.$REG]!, role: "expo", allowedRoles: ["employee"] };
      s.shiftTypes![0]!.stations = [I.$REG, I.$EXPO];
      s.shiftTypes![0]!.headcount = { slow: 2, normal: 2, busy: 2, weekend: 2 };
      for (const dt of ["slow", "normal", "busy", "weekend"] as const) { s.crews[dt].lineMinHeads[I.$EXPO] = 1; s.crews[dt].waves.setup.heads = 2; }
    });
    const i = input([{ id: "a", role: "employee", cover: [I.$REG, I.$EXPO], skills: { [I.$REG]: [1, 1], [I.$EXPO]: [1, 1] } },
      { id: "b", role: "trainee", cover: [I.$REG], skills: { [I.$REG]: [0.6, 1] } }], s);
    const out = buildCrewWeek(i);
    expect(out.shifts.find((sh) => sh.userId === "a")!.segments).toMatchObject([{ positionId: I.$EXPO, startQ: 44, endQ: 64 }]);
    expect(out.shifts.find((sh) => sh.userId === "b")!.segments).toMatchObject([{ positionId: I.$REG, startQ: 44, endQ: 64 }]); clean(out);
  });
  it("uses code-point user IDs for ties and is byte-identical after unordered input permutations", () => {
    const i = input([{ id: "😀", role: "employee" }, { id: "\ue000", role: "employee" }, { id: "z", role: "employee" }], shop(), [MON, TUE]);
    i.days[0]!.catering = [{ id: "😀", headcount: 1, eventQ: 52 }, { id: "\ue000", headcount: 1, eventQ: 52 }];
    const before = JSON.stringify(i); const out = buildCrewWeek(i);
    expect(users(out)).toEqual(["z"]);
    expect(JSON.stringify(i)).toBe(before);
    const permuted = structuredClone(i); permuted.people.reverse(); permuted.days.reverse(); permuted.days.forEach((d) => d.catering.reverse());
    permuted.budgetByDate = Object.fromEntries(Object.entries(permuted.budgetByDate).reverse());
    permuted.skills.byUser = Object.fromEntries(Object.entries(permuted.skills.byUser).reverse());
    expect(JSON.stringify(buildCrewWeek(permuted))).toBe(JSON.stringify(out));
    expect(JSON.stringify(buildCrewWeek(i))).toBe(JSON.stringify(out)); clean(out);
    i.people = i.people.filter((p) => p.userId !== "z"); expect(users(buildCrewWeek(i))).toEqual(["\ue000"]);
  });
  it("random valid crew fixtures never produce generator-hard errors and every declared gap verifies", () => {
    let state = 0x51c0ffee;
    const random = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
    for (let run = 0; run < 40; run++) {
      const count = random(7);
      const s = shop((s) => {
        const heads = random(4); s.shiftTypes![0]!.headcount = { slow: heads, normal: heads, busy: heads, weekend: heads };
        s.shiftTypes![0]!.minLengthQ = 16 + random(5);
      });
      const specs: PersonSpec[] = Array.from({ length: count }, (_, n) => ({ id: `person-${n}`, role: "employee", softMin: random(33), softMax: 40,
        window: { fromQ: 40 + random(10), toQ: 64 }, skills: { [I.$REG]: [random(101) / 100, 1] } }));
      expect(structureProblem(s)).toBeNull();
      const i = input(specs, s, [MON, TUE]);
      for (const p of i.people) {
        if (random(2)) usual(i, p.userId);
        for (const date of [MON, TUE]) p.workModes![date] = (["works", "if_needed", "off"] as const)[random(3)]!;
      }
      if (random(2)) i.budgetByDate[MON] = random(21);
      const out = buildCrewWeek(i); clean(out); stationHolds(out, `simple fixture ${run}`);
      const permuted = structuredClone(i); permuted.people.reverse(); permuted.days.reverse();
      expect(JSON.stringify(buildCrewWeek(permuted)), `seeded case ${run}`).toBe(JSON.stringify(out));
    }
  });
  it("100 mixed full-week fixtures preserve safety, evidence and byte determinism", () => {
    let state = 0x7ea1c0de;
    const random = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * n); };
    for (let run = 0; run < 100; run++) {
      const s = shop((s) => {
        s.leadership.modRequired = random(2) === 1;
        s.leadership.keyHolderModAfterQ = [null, 48, 60][random(3)]!;
        s.limits.managerFloorH = run < 50 ? random(25) : random(97) / 4;
        s.limits.salariedTargetWeekH = run < 50 ? 10 + random(7) * 5 : 10 + random(121) / 4;
        s.limits.salariedFlexH = run < 50 ? random(11) : random(41) / 4;
        s.positions[I.$REG]!.headsBefore = s.positions[I.$REG]!.headsAfter = 1 + random(2);
        s.positions[I.$EXPO] = { ...s.positions[I.$REG]!, role: "expo", allowedRoles: ["employee", "trainer", "key_holder", "shift_lead", "agm", "gm"] };
        if (random(2)) s.priority = [{ pair: [I.$REG, I.$EXPO], primary: I.$REG }];
        for (const dt of ["slow", "normal", "busy", "weekend"] as const) { s.crews[dt].lineMinHeads[I.$EXPO] = 1; s.crews[dt].waves.setup.heads = 2; }
        const heads = () => ({ slow: random(3), normal: random(3), busy: random(3), weekend: random(3) });
        s.shiftTypes = [type({ id: "\ue000", fromQ: 40, toQ: 60, stations: [I.$REG, I.$EXPO], headcount: heads() }),
          type({ id: "😀", stations: [I.$EXPO, I.$REG], headcount: heads() }),
          type({ id: "non-mod", countsTowardMod: false, stations: [I.$REG], headcount: heads() })];
      });
      const specs: PersonSpec[] = Array.from({ length: 4 + random(5) }, (_, n) => ({ id: `${n % 2 ? "😀" : "\ue000"}-${n}`,
        role: (["employee", "trainee", "key_holder", "shift_lead", "gm", "agm"] as const)[random(6)]!,
        leader: (["opens", "closes", "mix"] as const)[random(3)]!, cover: random(2) ? [I.$REG, I.$EXPO] : [I.$EXPO, I.$REG],
        softMin: random(33), softMax: 25 + random(4) * 5, window: { fromQ: 40 + random(5), toQ: 64 },
        skills: { [I.$REG]: [random(101) / 100, 0.8], [I.$EXPO]: [random(101) / 100, 0.8] } }));
      // A legal fixed hourly shift never consumes a manager floor/flex allowance.
      expect(structureProblem(s)).toBeNull();
      specs.push({ id: "fixed", role: "employee", cover: [I.$REG], softMax: 40, window: { fromQ: 40, toQ: 64 } });
      const i = input(specs, s, DATES);
      for (const p of i.people) {
        if (p.userId !== "fixed" && random(2)) usual(i, p.userId, s.shiftTypes![random(3)]!.id);
        for (const date of DATES) p.workModes![date] = (["works", "if_needed", "off"] as const)[random(3)]!;
      }
      for (const d of i.days) { d.dayType = (["slow", "normal", "busy", "weekend"] as const)[random(4)]!; i.budgetByDate[d.date] = random(3) ? random(21) : null; }
      if (random(2)) {
        i.people.find((p) => p.userId === "fixed")!.workModes![MON] = "works";
        i.pins = [{ id: "pin", userId: "fixed", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
      }
      const removed = i.people[0]!;
      if (random(2)) i.crew = { manualOverridesByDate: { [TUE]: [{ original: { userId: removed.userId, date: TUE, startQ: 44 }, replacement: null }] } };
      let out: GeneratorOutput;
      try { out = buildCrewWeek(i); } catch (error) { throw new Error(`mixed fixture ${run}: ${JSON.stringify({ error: (error as { params?: unknown }).params, limits: s.limits, people: i.people.filter((p) => p.salaried), types: s.shiftTypes, budget: i.budgetByDate, pins: i.pins })}`); }
      clean(out); stationHolds(out, `mixed fixture ${run}`);
      const permuted = structuredClone(i); permuted.people.reverse(); permuted.days.reverse(); permuted.pins.reverse();
      expect(JSON.stringify(buildCrewWeek(permuted)), `mixed fixture ${run}`).toBe(JSON.stringify(out));
    }
  }, 60000);
});


describe("chunk 5 independent review regressions", () => {
  it("keeps Tio's entire 52.5-hour usual week above the 40-hour soft maximum", () => {
    const st = shop((s) => {
      s.shopDay.serviceCloseQ = 82; s.shopDay.outEarliestQ = 82; s.shopDay.outLatestQ = 84;
      s.shiftTypes = [type({ fromQ: 40, toQ: 82 })];
    });
    const i = input([{ id: "tio", role: "employee", softMax: 40 }], st, DATES.slice(0, 5));
    i.days.forEach((d) => { d.scheduledOutQ = 82; }); usual(i, "tio");
    const out = buildCrewWeek(i);
    expect(out.shifts).toHaveLength(5);
    expect(out.stats.hourlyHours).toBe(52.5);
    expect(Object.values(out.context.days).flatMap((d) => d.crew!.shifts).every((m) => m.typeId === "mid" && m.source === "usual")).toBe(true);
    expect(out.notes.some((n) => n.code === "over_soft_max")).toBe(true); clean(out);
  });
  it("flexes a closes key holder's 10:00 Mid start forward to 10:30", () => {
    const st = shop((s) => {
      s.shopDay = { prepStartQ: 28, prepDishArrivalQ: 28, serviceStartQ: 42, serviceCloseQ: 80, outEarliestQ: 82, outLatestQ: 84 };
      s.leadership.modRequired = true; s.leadership.keyHolderModAfterQ = 42;
      s.leadership.closingRoles = ["key_holder", "gm"];
      s.shiftTypes = [type({ id: "open", fromQ: 28, toQ: 60 }), type({ fromQ: 40, toQ: 82, startFlexQ: 4 })];
    });
    const i = input([{ id: "gm", role: "gm", leader: "opens" }, { id: "kh", role: "key_holder", leader: "closes" }], st);
    i.days[0]!.scheduledOutQ = 82; usual(i, "gm", "open"); usual(i, "kh");
    const out = buildCrewWeek(i);
    expect(out.shifts.find((s) => s.userId === "kh")).toMatchObject({ startQ: 42, endQ: 82, closingManager: true });
    expect(out.gaps.filter((g) => ["open_shift", "mod_missing", "closing_manager_missing"].includes(g.code))).toEqual([]); clean(out);
  });
  it("tries end flexibility in both directions after start attempts", () => {
    const i = input([{ id: "a", role: "shift_lead", leader: "opens" }], shop((s) => {
      s.shiftTypes = [type({ fromQ: 44, toQ: 64, startFlexQ: 2 })];
    })); usual(i, "a");
    const out = buildCrewWeek(i); expect(out.shifts[0]).toMatchObject({ startQ: 44, endQ: 63 }); clean(out);
    const short = input([{ id: "a", role: "employee" }], shop((s) => {
      s.shopDay.prepStartQ = 44; s.shiftTypes = [type({ fromQ: 44, toQ: 59, startFlexQ: 1 })];
    })); usual(short, "a");
    expect(buildCrewWeek(short).shifts[0]).toMatchObject({ startQ: 44, endQ: 60 });
  });
  it("aggregates forty deleted-type notices into one day/type note", () => {
    const i = input(Array.from({ length: 40 }, (_, n) => ({ id: `p${n}`, role: "employee" as const })));
    for (const p of i.people) p.usualShift = { value: null, deletedTypeId: "retired", source: "manager" };
    const out = buildCrewWeek(i);
    const notes = out.context.days[MON]!.crew!.notes.filter((n) => n.code === "usual_type_deleted");
    expect(notes).toHaveLength(1); expect(notes[0]!.params.count).toBe(40);
    expect(notes[0]!.params.userIds).toHaveLength(40); clean(out);
  });
  it("explains pins blocked by manual deletions and drops separated or time-off replacements", () => {
    const i = input();
    i.pins = [{ id: "pin", userId: "a", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
    i.crew = { manualOverridesByDate: { [MON]: [{ original: { userId: "a", date: MON, startQ: 44 }, replacement: null }] } };
    expect(buildCrewWeek(i).notes.some((n) => n.params.reason === "pin_blocked_by_manual")).toBe(true);
    i.pins = [];
    const replacement = { userId: "gone", date: MON, startQ: 44, endQ: 64, segments: [{ positionId: I.$REG, startQ: 44, endQ: 64 }], closingManager: false, flex: false, pinned: false };
    i.crew.manualOverridesByDate![MON]![0]!.replacement = replacement;
    let out = buildCrewWeek(i); expect(out.notes.some((n) => n.params.reason === "manual_person_unavailable")).toBe(true); clean(out);
    replacement.userId = "a"; i.people[0]!.untouchableDates = [MON];
    out = buildCrewWeek(i); expect(out.shifts).toEqual([]); clean(out);
  });
  it("matches pins by greatest qualifying overlap with code-point ties", () => {
    const i = input([{ id: "kh", role: "key_holder", leader: "mix" }], shop((s) => {
      s.leadership.keyHolderModAfterQ = 40;
      s.shiftTypes = [type({ id: "z", fromQ: 40, toQ: 60 }), type({ id: "a", fromQ: 44, toQ: 64 })];
    }));
    usual(i, "kh", "z");
    i.pins = [{ id: "pin", userId: "kh", date: MON, startQ: 45, endQ: 64, positions: [I.$REG], kind: "added" }];
    let out = buildCrewWeek(i); expect(out.context.days[MON]!.crew!.shifts[0]!.typeId).toBe("a");
    expect(shiftCountsAsMod(out.shifts[0]!, out.context.people.kh!, out.context.days[MON]!, 48)).toBe(true);
    i.structure.shiftTypes![0]!.fromQ = 44; i.structure.shiftTypes![0]!.toQ = 64;
    out = buildCrewWeek(i); expect(out.context.days[MON]!.crew!.shifts[0]!.typeId).toBe("a");
  });
  it("certifies the prep-before-first-type MoD hole and names its settings fix", () => {
    const i = input([{ id: "gm", role: "gm", leader: "mix" }], shop((s) => {
      s.leadership.modRequired = true; s.shopDay.prepStartQ = 28; s.shopDay.prepDishArrivalQ = 28;
      s.shiftTypes = [type({ id: "opener", fromQ: 30, toQ: 64 })];
    })); usual(i, "gm", "opener");
    const out = buildCrewWeek(i);
    expect(out.gaps).toContainEqual(expect.objectContaining({ code: "mod_missing", fromQ: 28, toQ: 30, cause: "structure" }));
    expect(out.notes).toContainEqual(expect.objectContaining({ code: "crew_mod_start_mismatch", params: expect.objectContaining({ earliestQ: 30 }) })); clean(out);
  });
  it("spends scarce usual-block budget on higher-demand dates, earlier ties, then later user IDs", () => {
    const i = input([{ id: "a", role: "employee" }, { id: "z", role: "employee" }], shop(), DATES.slice(0, 3));
    usual(i, "a"); usual(i, "z"); i.days[0]!.dayCents = 100; i.days[1]!.dayCents = 200; i.days[2]!.dayCents = 200;
    for (const d of i.days) i.budgetByDate[d.date] = 5;
    const out = buildCrewWeek(i);
    expect(users(out, MON)).toEqual([]); expect(users(out, TUE)).toEqual(["a", "z"]); expect(users(out, DATES[2]!)).toEqual(["z"]); clean(out);
  });
  it("does not change usual weekly day-cap choices when an ample budget is supplied", () => {
    const i = input([{ id: "a", role: "employee" }], shop(), DATES); usual(i, "a");
    i.days.forEach((d, n) => { d.dayCents = (n + 1) * 100; });
    const unbudgeted = buildCrewWeek(i);
    for (const date of DATES) i.budgetByDate[date] = 100;
    const ample = buildCrewWeek(i);
    expect(ample.shifts).toEqual(unbudgeted.shifts);
    expect(ample.shifts.map((s) => s.date)).toEqual(DATES.slice(0, 5)); clean(ample);
  });
  it("builds a 25-person seven-day week within the generous CI performance bound", () => {
    const i = input(Array.from({ length: 25 }, (_, n) => ({ id: `person-${String(n).padStart(2, "0")}`, role: "employee" as const })), shop(), DATES);
    for (const p of i.people) usual(i, p.userId);
    const start = performance.now(); const out = buildCrewWeek(i); const elapsed = performance.now() - start;
    process.stdout.write(`crew 25-person/7-day generation: ${elapsed.toFixed(1)} ms\n`);
    expect(elapsed).toBeLessThan(3000); clean(out);
  });
});


it("keeps station continuity throughout an unchanged multi-station week", () => {
  const st = shop((s) => {
    s.positions[I.$EXPO] = { ...s.positions[I.$REG]!, role: "expo" };
    s.shiftTypes![0]!.headcount = { slow: 2, normal: 2, busy: 2, weekend: 2 };
    s.shiftTypes![0]!.stations = [I.$REG, I.$EXPO];
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) { s.crews[dt].lineMinHeads[I.$EXPO] = 1; s.crews[dt].waves.setup.heads = 2; }
  });
  const i = input([{ id: "a", role: "employee", cover: [I.$REG, I.$EXPO] }, { id: "b", role: "employee", cover: [I.$REG, I.$EXPO] }], st, DATES);
  const out = buildCrewWeek(i);
  for (const sh of out.shifts) expect(sh.segments).toHaveLength(1);
  clean(out);
});

it("names an essential-exemption displacement instead of blaming the candidate's own hours", () => {
  const st = shop((s) => {
    s.shopDay.serviceCloseQ = 60;
    s.shiftTypes![0]!.headcount = { slow: 2, normal: 2, busy: 2, weekend: 2 };
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) s.crews[dt].close.registerHeads = 1;
  });
  const i = input([{ id: "a", role: "employee", skills: { [I.$REG]: [0.3, 1] } }, { id: "z", role: "employee", skills: { [I.$REG]: [1, 1] } }], st);
  usual(i, "a"); i.budgetByDate[MON] = 0;
  const out = buildCrewWeek(i);
  expect(users(out)).toEqual(["a"]);
  expect(out.notes.some((n) => n.userId === "z" && n.params.reason === "budget_displaced_essential")).toBe(true);
  clean(out);
});


it("measures a budgeted 25-person week with salaried leadership and two stations", () => {
  const st = shop((s) => {
    s.leadership.modRequired = true;
    s.positions[I.$EXPO] = { ...s.positions[I.$REG]!, role: "expo" };
    s.shiftTypes = [type({ fromQ: 40, stations: [I.$REG, I.$EXPO], headcount: { slow: 4, normal: 4, busy: 4, weekend: 4 } })];
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) { s.crews[dt].lineMinHeads[I.$EXPO] = 1; s.crews[dt].waves.setup.heads = 2; }
  });
  const specs: PersonSpec[] = [{ id: "gm", role: "gm", leader: "mix", cover: [I.$REG, I.$EXPO] }, { id: "agm", role: "agm", leader: "mix", cover: [I.$EXPO, I.$REG] },
    ...Array.from({ length: 23 }, (_, n) => ({ id: `worker-${n}`, role: "employee" as const, cover: [I.$REG, I.$EXPO] }))];
  const i = input(specs, st, DATES); for (const p of i.people) usual(i, p.userId);
  for (const date of DATES) i.budgetByDate[date] = 100;
  const start = performance.now(); const out = buildCrewWeek(i); const elapsed = performance.now() - start;
  process.stdout.write(`crew budgeted 25-person/7-day with GM+AGM: ${elapsed.toFixed(1)} ms\n`);
  expect(elapsed).toBeLessThan(3000); clean(out);
});
