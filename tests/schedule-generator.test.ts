/**
 * Scheduling Phase 2, Tasks 6–7 — the templates (the shaped waves, the closing / BOH reservations, the
 * salaried MoD blocks) and the generator's rules: assignment, repair, cover, priority, the Closing
 * Manager, MoD, certificates, reasons, the historical contract, team strength.
 */
import { describe, expect, it } from "vitest";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { salariedBlocks, templatesFor } from "@/lib/scheduling/generator/templates-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { checkCertificate, checkScheduleRules, zeroCostCovers } from "@/lib/scheduling/rules-shared";
import { moneyStrip } from "@/lib/scheduling/board-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { enforcePriority, type BuildCtx, type GShift, type WeekState } from "@/lib/scheduling/generator/assign-shared";
import { teamStrength } from "@/lib/scheduling/strength-shared";
import {
  DATES, I, SMALL_SPECS, day, f0eRepairNeeded, f0iFourthDonor, f0jLongChain, fixture, person, repairShop, skillsOf, small, structure, type PersonSpec,
} from "./fixtures/schedule/fixtures";

const [MON, TUE, WED, THU, FRI, SAT, SUN] = DATES as [string, string, string, string, string, string, string];
void TUE; void WED; void THU; void FRI; void SAT; void SUN;

/** Validator-clean: no new error-class problem, every gap certified (no undeclared / uncertified). */
export function expectClean(out: GeneratorOutput): void {
  const errors = out.problems.filter((p) => p.severity === "error" && !p.inherited);
  expect(errors, JSON.stringify(errors.slice(0, 5))).toEqual([]);
  expect(out.gaps.every((g) => out.problems.some((p) => p.day === g.date && p.severity === "gap" && p.q === g.fromQ))).toBe(true);
}

describe("Task 6: templates in the mockup's order, from the need grid", () => {
  const s = structure();
  const d = day(MON, { demandKind: "no_history", hourlyCents: null, dayCents: null }, s);
  const { need } = buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: d.scheduledOutQ, hourlyCents: null, demandKind: "no_history", catering: [] });
  const templates = templatesFor(need, s);

  it("the closing crew comes first (line primaries before secondaries, then BOH), then BOH, then the shaped line arrivals; exactly one closingLead", () => {
    const sources = templates.map((t) => t.source);
    const firstShape = sources.indexOf("shape");
    expect(sources.slice(0, firstShape).every((x) => x !== "shape")).toBe(true);
    expect(templates.filter((t) => t.closingLead)).toHaveLength(1);
    const lead = templates.find((t) => t.closingLead)!;
    expect(lead.source).toBe("closing_crew");
    expect([I.$REG, I.$WALKON].includes(lead.positionId)).toBe(true);
    expect(templates.filter((t) => t.source === "closing_crew").map((t) => t.positionId)).toEqual([I.$REG, I.$WALKON, I.$WALK, I.$DISH]);
    expect(templates.every((t) => t.essential === (t.source === "closing_crew"))).toBe(true);
  });

  it("counts equal the need grid, head for head, at every quarter; no template outside its position's window", () => {
    for (const id of Object.keys(need.positions)) {
      for (let q = 0; q < 96; q++) {
        const heads = templates.filter((t) => t.positionId === id && t.fromQ <= q && q < t.toQ).length;
        expect(heads, `${id}@${q}`).toBe(need.positions[id]![q]);
      }
    }
    for (const t of templates) {
      const pos = s.positions[t.positionId]!;
      expect(t.fromQ).toBeGreaterThanOrEqual(pos.openQ);
      expect(t.toQ).toBeLessThanOrEqual(pos.closeQ);
    }
  });

  it("a catering day adds the extra Prep/Dishwasher template; a bigger limit lets it land", () => {
    const two = structure((x) => { x.positions[I.$DISH]!.headsBefore = 2; });
    const { need: cat } = buildDayNeed({ structure: two, dayType: "normal", scheduledOutQ: 83, hourlyCents: null, demandKind: "no_history", catering: [{ id: "c-1", headcount: 80, eventQ: 52 }] });
    const extra = templatesFor(cat, two).filter((t) => t.source === "catering");
    expect(extra).toEqual([{ positionId: I.$DISH, fromQ: 38, toQ: 52, source: "catering", essential: false, closingLead: false }]);
  });

  it("salaried MoD blocks: the GM opens at prep start, the AGM at the Prep/Dishwasher arrival, a closer ends at the scheduled out; off / no fit / leader setting skipped", () => {
    const people = [
      person({ id: "u-gm", role: "gm", leader: "opens" }), person({ id: "u-agm", role: "agm", leader: "opens" }),
      person({ id: "u-agm2", role: "agm", leader: "closes" }), person({ id: "u-off", role: "gm", off: [1] }),
      person({ id: "u-late", role: "gm", leader: "opens", window: { fromQ: 50, toQ: 83 } }), person({ id: "u-tight", role: "agm", leader: "mix", window: { fromQ: 40, toQ: 60 } }),
    ];
    const { blocks, skipped } = salariedBlocks(people, s, MON, 83);
    expect(blocks).toEqual([{ userId: "u-agm", startQ: 34, endQ: 66 }, { userId: "u-agm2", startQ: 51, endQ: 83 }, { userId: "u-gm", startQ: 28, endQ: 60 }]);
    expect(skipped).toEqual([{ userId: "u-late", reason: "leader_setting" }, { userId: "u-off", reason: "off" }, { userId: "u-tight", reason: "no_fit" }]);
  });

  it("kept and past days produce NO templates: they are inherited unchanged from the head", () => {
    const head = { revisionId: "rev-1", shifts: [{ userId: "u-b-bo", date: MON, startQ: 42, endQ: 64, segments: [{ positionId: I.$REG, startQ: 42, endQ: 64 }], closingManager: false, flex: false, pinned: false }],
      days: [{ date: MON, originRevisionId: "rev-1", structureVersionId: "sv-old", inherited: false, problems: [] }], gaps: [], closingWindowByDate: {} };
    const out = buildWeek(small({ today: TUE, days: DATES.filter((d) => d >= TUE && d <= WED).map((d) => day(d)), head }));
    expect(out.shifts.filter((x) => x.date === MON)).toEqual(head.shifts);
    expect(out.days.find((d) => d.date === MON)).toMatchObject({ inherited: true, originRevisionId: "rev-1", structureVersionId: "sv-old" });
    expect(out.days.filter((d) => d.inherited).map((d) => d.date)).toEqual([MON, THU, FRI, SAT, SUN]);
    expect(out.shifts.filter((x) => x.date >= THU)).toEqual([]);
    expectClean(out);
  });
});

/** A one-position shop: Register 11:00–15:00 (exactly the 4 h minimum), no BOH, no closing crew; demand shapes nothing (floor = limit = 1). */
function onePosition(over: (s: ScheduleStructure) => void = () => {}): ScheduleStructure {
  return structure((s) => {
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 44, serviceCloseQ: 60, outEarliestQ: 60, outLatestQ: 64 };
    s.positions = { [I.$REG]: { role: "register", openQ: 44, trimQ: 60, closeQ: 60, headsBefore: 1, headsAfter: 1, allowedRoles: ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"] } };
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
const peak = (() => { const h = new Array<number>(24).fill(0); h[11] = 20000; h[12] = 50000; h[13] = 20000; h[14] = 20000; return h; })();
const oneDay = (s: ScheduleStructure, demand: number[] | null = peak) => [day(MON, { demandKind: demand ? "ok" : "no_history", hourlyCents: demand, dayCents: demand ? demand.reduce((a, b) => a + b, 0) : null, scheduledOutQ: 60 }, s)];
const who = (out: GeneratorOutput, date = MON) => out.shifts.filter((x) => x.date === date).map((x) => x.userId);

describe("Task 7: assignment rules, one per rule", () => {
  it("the strongest goes to the rush (0.9 beats 0.6 when the block holds the busiest hour); outside the rush the person furthest under soft-min wins", () => {
    const s = onePosition();
    const specs: PersonSpec[] = [
      { id: "u-x", role: "employee", softMin: 24, skills: { [I.$REG]: [0.9, 0.7] } },
      { id: "u-y", role: "employee", softMin: 40, skills: { [I.$REG]: [0.6, 0.7] } },
    ];
    const rush = buildWeek(fixture({ structure: s, specs, days: oneDay(s) }));
    expectClean(rush);
    expect(who(rush)).toEqual(["u-x"]);
    expect(rush.reasons[Object.keys(rush.reasons)[0]!]!.shift.some((r) => r.key === "strongest_on_position")).toBe(true);
    const quiet = buildWeek(fixture({ structure: s, specs, days: oneDay(s, null) }));
    expectClean(quiet);
    expect(who(quiet)).toEqual(["u-y"]);
    expect(quiet.reasons[Object.keys(quiet.reasons)[0]!]!.shift.some((r) => r.key === "under_soft_min")).toBe(true);
  });

  it("an overtime candidate is skipped while another fits, and used only when none fits (a warning, noted)", () => {
    const s = onePosition();
    const headShifts = DATES.slice(1, 6).map((d) => ({ userId: "u-x", date: d, startQ: 44, endQ: 76, segments: [{ positionId: I.$REG, startQ: 44, endQ: 76 }], closingManager: false, flex: false, pinned: false }));
    const head = { revisionId: "rev-0", shifts: headShifts, days: [], gaps: [], closingWindowByDate: {} };
    const specs: PersonSpec[] = [{ id: "u-x", role: "employee", skills: { [I.$REG]: [0.95, 0.9] } }, { id: "u-y", role: "employee", skills: { [I.$REG]: [0.5, 0.9] } }];
    // 5 × 8 h = 40 h already on kept days: another 4 h would be overtime, so Y takes Monday although X is stronger.
    const out = buildWeek(fixture({ structure: s, specs, days: oneDay(s), head }));
    expectClean(out);
    expect(who(out)).toEqual(["u-y"]);
    const alone = buildWeek(fixture({ structure: s, specs: [specs[0]!], days: oneDay(s), head }));
    expectClean(alone);
    expect(who(alone)).toEqual(["u-x"]);
    expect(alone.problems.some((p) => p.code === "overtime" && p.severity === "warning")).toBe(true);
    expect(alone.notes.some((n) => n.code === "overtime_used" && n.userId === "u-x")).toBe(true);
  });

  it("a full-timer below their minimum is pulled forward of a stronger part-timer", () => {
    const s = onePosition();
    const specs: PersonSpec[] = [
      { id: "u-ft", role: "employee", fullTime: true, fullTimeMinH: 32, skills: { [I.$REG]: [0.5, 0.7] } },
      { id: "u-pt", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } },
    ];
    const out = buildWeek(fixture({ structure: s, specs, days: oneDay(s) }));
    expectClean(out);
    expect(who(out)).toEqual(["u-ft"]);
    expect(out.reasons[Object.keys(out.reasons)[0]!]!.shift.some((r) => r.key === "full_timer_minimum")).toBe(true);
  });

  it("pairing (r2 P1-2): (a) a newer person is placed BESIDE a strong one when one fits; (b) alone, still placed with pairing_unmet; (d) unproven is never newer", () => {
    // Two primaries all day: Register (the strong person S lives here) and Walk-ins / Online (N newer vs R regular, equal skill and soft-min).
    const s = onePosition((x) => {
      x.positions[I.$WALKON] = { ...x.positions[I.$REG]!, role: "walk_online" };
      for (const t of ["slow", "normal", "busy", "weekend"] as const) { x.crews[t].lineMinHeads = { [I.$REG]: 1, [I.$WALKON]: 1 }; x.crews[t].waves.setup.heads = 2; }
    });
    const base: PersonSpec[] = [
      { id: "u-n", role: "employee", softMin: 24, skills: { [I.$WALKON]: [0.3, 0.6], [I.$REG]: [0.2, 0.6] } },
      { id: "u-r", role: "employee", softMin: 24, skills: { [I.$WALKON]: [0.3, 0.6], [I.$REG]: [0.2, 0.6] } },
      { id: "u-s", role: "trainer", skills: { [I.$REG]: [0.95, 0.9], [I.$WALKON]: [0.1, 0.9] } },
    ];
    const a = buildWeek(fixture({ structure: s, specs: base, days: oneDay(s, null) }));
    expectClean(a);
    const walkon = a.shifts.find((x) => x.segments[0]!.positionId === I.$WALKON)!;
    expect(walkon.userId).toBe("u-n");
    expect(a.reasons[`${MON}|u-n|44`]!.shift.some((r) => r.key === "beside_strong")).toBe(true);
    expect(a.notes.filter((n) => n.code === "pairing_unmet")).toEqual([]);
    const b = buildWeek(fixture({ structure: s, specs: [base[0]!, { ...base[2]!, off: [1] }], days: oneDay(s, null) }));
    expectClean(b);
    expect(who(b)).toEqual(["u-n"]);
    expect(b.notes.some((n) => n.code === "pairing_unmet" && n.userId === "u-n")).toBe(true);
    const unproven = buildWeek(fixture({ structure: s, specs: [{ id: "u-u", role: "trainee" }, { id: "u-v", role: "trainee" }], days: oneDay(s, null) }));
    expectClean(unproven);
    expect(unproven.notes.filter((n) => n.code === "pairing_unmet")).toEqual([]);
    expect(unproven.problems.filter((p) => p.code === "pairing_unmet")).toEqual([]);
  });

  it("(c) an entire roster with NO evidence builds a complete week with zero errors and no gap beyond structure / eligibility / availability", () => {
    const s = structure((x) => { x.leadership.modRequired = false; });
    // 12 hourly people, every skill a starting point (an unproven 0.5): nobody is "newer", nothing blocks.
    const extra: PersonSpec[] = [{ id: "u-k-kim", role: "employee" }, { id: "u-l-lou", role: "employee", workType: "boh" }];
    const specs: PersonSpec[] = [...SMALL_SPECS, ...extra].map((p) => ({ ...p, skills: undefined, close: undefined }));
    const out = buildWeek(small({ structure: s, specs }));
    expectClean(out);
    expect(out.shifts.length).toBeGreaterThan(20);
    expect(out.gaps.filter((g) => !["structure", "eligibility", "availability"].includes(g.cause))).toEqual([]);
    expect(out.problems.filter((p) => p.code === "pairing_unmet")).toEqual([]);
    expect(out.strength[MON]!.filter((w) => w.minutes > 0).every((w) => w.word === "unknown")).toBe(true);
  });

  it("the 4 h minimum by extension into the next needed position: a short window becomes a multi-position shift, the reason citing the close", () => {
    // The small shop's roster covers its 10.25 h line day one person per position only with shifts over 10 h; this test is
    // about the multi-position segment, so the shop's cap is 12 h here (CC chunk B ruling 3 has its own tests below).
    const s = structure((x) => { x.positions[I.$BOI]!.openQ = 52; x.limits.maxShiftH = 12; });
    const out = buildWeek(small({ structure: s, days: [day(MON, {}, s)] }));
    expectClean(out);
    const boi = out.shifts.find((x) => x.date === MON && x.segments.some((g) => g.positionId === I.$BOI));
    expect(boi).toBeDefined();
    expect(boi!.segments.length).toBeGreaterThan(1);
    expect(boi!.endQ - boi!.startQ).toBeGreaterThanOrEqual(16);
    const key = `${MON}|${boi!.userId}|${boi!.startQ}`;
    expect(out.reasons[key]!.segments.flat().some((r) => r.key === "next_position" || r.key === "extended_to_minimum")).toBe(true);
    expect(out.gaps.filter((g) => g.positionId === I.$BOI)).toEqual([]);
  });

  it("one person per position at every quarter, and no two shifts of one person overlap", () => {
    const out = buildWeek(small());
    expectClean(out);
    for (const d of DATES) {
      const shifts = out.shifts.filter((x) => x.date === d);
      for (const id of Object.keys(out.context.days[d]!.structure.positions)) {
        const pos = out.context.days[d]!.structure.positions[id]!;
        for (let q = 0; q < 96; q++) {
          const n = shifts.reduce((k, sh) => k + sh.segments.filter((g) => g.positionId === id && g.startQ <= q && g.endQ > q).length, 0);
          expect(n).toBeLessThanOrEqual(q < pos.trimQ ? pos.headsBefore : pos.headsAfter);
        }
      }
    }
  });

  it("the Closing Manager is the best closeScore among eligible closers; never an opens-only leader (the v17 Dani bug)", () => {
    const out = buildWeek(small({ days: [day(MON)] }));
    expectClean(out);
    const cm = out.shifts.filter((x) => x.closingManager);
    expect(cm).toHaveLength(1);
    expect(["u-a-ana", "u-h-hal"]).toContain(cm[0]!.userId);
    expect(cm[0]!.startQ).toBeLessThanOrEqual(80);
    expect(cm[0]!.endQ).toBe(83);
    expect(out.shifts.filter((x) => x.userId === "u-g-gus" && x.closingManager)).toEqual([]);
  });

  it("MoD every slot when required: with KH-as-MoD OFF the evening is a certified mod_missing gap; ON after 16:30 the KH closers cover it", () => {
    const off = buildWeek(small({ structure: structure((x) => { x.leadership.modRequired = true; }), days: [day(MON)] }));
    expectClean(off);
    const modGaps = off.gaps.filter((g) => g.code === "mod_missing");
    expect(modGaps.length).toBeGreaterThan(0);
    expect(modGaps.every((g) => g.fromQ >= 60)).toBe(true);
    const on = buildWeek(small({ structure: structure((x) => { x.leadership.modRequired = true; x.leadership.keyHolderModAfterQ = 66; }), days: [day(MON)] }));
    expectClean(on);
    expect(on.gaps.filter((g) => g.code === "mod_missing" && g.fromQ >= 66)).toEqual([]);
  });

  it("presence pins are fixed blocks at $0 that count toward coverage; an 'added' pin is a fixed hourly block", () => {
    const pins = [
      { id: "pin-1", date: MON, userId: "u-p-pete", startQ: 40, endQ: 56, positions: [I.$PREP], kind: "presence" as const },
      { id: "pin-2", date: MON, userId: "u-c-cy", startQ: 38, endQ: 56, positions: [I.$BOI], kind: "added" as const },
    ];
    const specs = [...SMALL_SPECS, { id: "u-p-pete", role: "owner" as const, cover: [I.$PREP] }];
    const out = buildWeek(fixture({ specs, pins, days: [day(MON)] }));
    expectClean(out);
    const pete = out.shifts.find((x) => x.userId === "u-p-pete")!;
    expect(pete).toMatchObject({ pinned: true, startQ: 40, endQ: 56 });
    const cy = out.shifts.find((x) => x.userId === "u-c-cy")!;
    expect(cy).toMatchObject({ pinned: true, startQ: 38, endQ: 56 });
    expect(cy.segments[0]!.positionId).toBe(I.$BOI);
    const without = buildWeek(fixture({ specs, days: [day(MON)] }));
    expect(out.stats.hourlyCostCents).toBeLessThanOrEqual(without.stats.hourlyCostCents!);
  });

  it("reasons: every shift and segment has >= 1 reason key; who else could cover is listed, strongest first", () => {
    const out = buildWeek(small({ days: [day(MON)] }));
    for (const sh of out.shifts) {
      const r = out.reasons[`${sh.date}|${sh.userId}|${sh.startQ}`]!;
      expect(r.shift.length).toBeGreaterThan(0);
      expect(r.segments).toHaveLength(sh.segments.length);
      for (const seg of r.segments) expect(seg.length).toBeGreaterThan(0);
    }
    const s = onePosition();
    const three = buildWeek(fixture({ structure: s, specs: [
      { id: "u-x", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-y", role: "employee", skills: { [I.$REG]: [0.6, 0.7] } }, { id: "u-z", role: "employee", skills: { [I.$REG]: [0.7, 0.7] } },
    ], days: oneDay(s) }));
    expect(three.reasons[`${MON}|u-x|44`]!.alternates).toEqual([{ userId: "u-z", skill: 0.7 }, { userId: "u-y", skill: 0.6 }]);
  });

  it("Astra chunk B P3: alternates reuse full placement eligibility — the window, untouchable dates, the leader setting", () => {
    const s = onePosition();
    const input = fixture({ structure: s, specs: [
      { id: "u-x", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-y", role: "employee", skills: { [I.$REG]: [0.6, 0.7] } }, { id: "u-z", role: "employee", skills: { [I.$REG]: [0.7, 0.7] } },
      { id: "u-w", role: "employee", window: { fromQ: 44, toQ: 52 }, skills: { [I.$REG]: [0.8, 0.7] } },
      { id: "u-k", role: "key_holder", leader: "closes", skills: { [I.$REG]: [0.85, 0.7] } },
    ], days: oneDay(s) });
    input.people.find((p) => p.userId === "u-y")!.untouchableDates = [MON];
    const out = buildWeek(input);
    const sh = out.shifts.find((x) => x.date === MON && x.userId === "u-x")!;
    expect(sh).toMatchObject({ startQ: 44, endQ: 60 });
    // u-w is available 11:00–13:00 only, u-y's Monday is untouchable, u-k (closes only) may not start before service (11:00 is service start: allowed).
    expect(out.reasons[`${MON}|u-x|44`]!.alternates.map((a) => a.userId)).toEqual(["u-k", "u-z"]);
  });

  it("determinism: byte-identical twice, and with the roster, days and pins shuffled", () => {
    const base = small();
    const a = buildWeek(base);
    const b = buildWeek(base);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const shuffled = { ...base, people: [...base.people].reverse(), days: [...base.days].reverse() };
    expect(JSON.stringify(buildWeek(shuffled))).toBe(JSON.stringify(a));
  });
});

describe("Task 7: budget, certificates and the repair search", () => {
  const noMod = structure((x) => { x.leadership.modRequired = false; });
  const monday = (budget: number | null) => small({ structure: noMod, days: [day(MON, {}, noMod)], budgetByDate: Object.fromEntries(DATES.map((d) => [d, d === MON ? budget : null])) });

  it("budget 0 / tight / loose: non-essential blocks stop, the closing crew still lands, every uncovered deficit is a certified budget gap although people are free", () => {
    const zero = buildWeek(monday(0));
    expectClean(zero);
    expect(zero.shifts.filter((x) => x.date === MON && x.closingManager)).toHaveLength(1);
    expect(zero.gaps.length).toBeGreaterThan(0);
    expect(zero.gaps.every((g) => g.cause === "budget" && g.certificate.hoursNeeded > 0 && g.certificate.budgetHours === 0)).toBe(true);
    const free = Object.keys(zero.context.people).filter((u) => !zero.shifts.some((x) => x.userId === u) && !zero.context.people[u]!.salaried);
    expect(free.length).toBeGreaterThan(0);
    const essential = zero.stats.essentialHours;
    const tight = buildWeek(monday(essential + 6));
    expectClean(tight);
    expect(tight.stats.hourlyHours - tight.stats.essentialHours).toBeLessThanOrEqual(essential + 6);
    expect(tight.gaps.every((g) => g.cause === "budget")).toBe(true);
    expect(tight.gaps.length).toBeLessThan(zero.gaps.length);
    const loose = buildWeek(monday(400));
    expectClean(loose);
    expect(loose.gaps.filter((g) => g.cause === "budget")).toEqual([]);
    expect(loose.notes.some((n) => n.code === "unbudgeted_date")).toBe(false);
    // CC chunk C ruling 3: essential closer hours are exempt from the cap but COUNTED and NAMED — at budget 0 every
    // hourly hour is essential, all of it past the budget; salaried / MoD cover was taken first (no zero-cost fill left).
    expect(zero.stats.hourlyHours).toBe(zero.stats.essentialHours);
    expect(zero.notes.filter((n) => n.code === "essential_past_budget")).toEqual([
      { code: "essential_past_budget", date: null, userId: null, positionId: null, params: { hours: zero.stats.essentialHours, budgetHours: 0 } },
    ]);
    const sched = { locationId: zero.context.locationId, weekStart: zero.context.weekStart, shifts: zero.shifts, gaps: zero.gaps, days: zero.days };
    for (const g of zero.gaps) expect(zeroCostCovers(g, sched, zero.context)).toEqual([]);
    expect(loose.notes.some((n) => n.code === "essential_past_budget")).toBe(false);
  });

  it("Astra chunk B P1-1: budget 0 — the GM on MoD takes Register at ZERO hourly cost before the budget stops the fill; no budget gap a manager could take", () => {
    const s = onePosition();
    const specs: PersonSpec[] = [{ id: "u-e", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-gm", role: "gm", leader: "opens", cover: [I.$REG] }];
    const out = buildWeek(fixture({ structure: s, specs, days: oneDay(s), budgetByDate: Object.fromEntries(DATES.map((d) => [d, d === MON ? 0 : null])) }));
    expectClean(out);
    const gm = out.shifts.find((x) => x.userId === "u-gm")!;
    expect(gm.segments.some((g) => g.positionId === I.$REG)).toBe(true);
    expect(out.stats.hourlyHours).toBe(0);
    const schedule = { locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days };
    for (const g of out.gaps) expect(zeroCostCovers(g, schedule, out.context)).toEqual([]);
    // Astra chunk C P1 (legal placement witness): the hole after the GM's 4 h block has NO legal 4 h block for the
    // employee — Register is held by the GM and closes at 3:00 — so it is NOT a budget proof. CC chunk D ruling 2: the
    // GM now STAYS LONGER at zero hourly cost (2:00 → 2:45 PM), but an opens-only GM must leave before service close
    // (3:00), so the last 15 minutes stay the honest `unresolved_search`. Every remaining gap sits after the GM's shift.
    expect([gm.startQ, gm.endQ]).toEqual([40, 59]);
    expect(out.gaps.every((g) => g.fromQ >= gm.endQ)).toBe(true);
    expect(out.gaps.map((g) => [g.fromQ, g.toQ, g.cause])).toEqual([[59, 60, "unresolved_search"]]);
  });

  it("Astra chunk B P1-2: KH-only roster, KH-as-MoD from noon — the afternoon gets a KH MoD block, no MoD certificate spans the boundary", () => {
    const s = structure((x) => {
      x.leadership.modRequired = true;
      x.leadership.keyHolderModAfterQ = 48;
      for (const id of Object.keys(x.positions)) x.positions[id]!.allowedRoles = ["trainee", "employee", "trainer"];
    });
    const specs: PersonSpec[] = [{ id: "u-k1", role: "key_holder", leader: "mix" }, { id: "u-k2", role: "key_holder", leader: "mix" }];
    const out = buildWeek(fixture({ structure: s, specs, days: [day(MON, {}, s)] }));
    expectClean(out);
    const mods = out.gaps.filter((g) => g.code === "mod_missing");
    expect(mods.every((g) => g.toQ <= 48 || g.fromQ >= 48)).toBe(true);
    expect(mods.filter((g) => g.fromQ < 48).every((g) => g.cause === "structure")).toBe(true);
    expect(mods.filter((g) => g.fromQ >= 48)).toEqual([]);
    const out83 = out.context.days[MON]!.scheduledOutQ;
    for (let q = 48; q < out83; q++) expect(out.shifts.some((x) => x.date === MON && x.startQ <= q && x.endQ > q), `MoD @${q}`).toBe(true);
  });

  it("certificates: eligibility (no member may work the position), availability (everyone off), structure (a secondary while its primary is closed; MoD with no SL+)", () => {
    const noDish = structure((x) => { x.leadership.modRequired = false; x.positions[I.$DISH]!.allowedRoles = ["trainer"]; });
    const elig = buildWeek(small({ structure: noDish, days: [day(MON, {}, noDish)] }));
    expectClean(elig);
    expect(elig.gaps.filter((g) => g.positionId === I.$DISH).map((g) => g.cause)).toEqual(["eligibility"]);

    // Everyone off: the fixed cause order makes `capacity` (0 people can work it) the proof for every coverage deficit;
    // `availability` is therefore the cause of a MoD / Closing Manager deficit (no counting bound applies to those).
    const off = buildWeek(small({ structure: noMod, specs: SMALL_SPECS.map((p) => ({ ...p, off: [2] })), days: [day(TUE, {}, noMod)] }));
    expectClean(off);
    expect(off.gaps.length).toBeGreaterThan(0);
    // A coverage deficit takes `capacity` when the Hall bound is tight at every quarter (0 people can work it), else
    // `availability` (every eligible member is off); both are proofs. The Closing Manager deficit is `availability`.
    for (const g of off.gaps.filter((x) => x.code === "coverage_gap")) {
      expect(["capacity", "availability"]).toContain(g.cause);
      if (g.cause === "capacity") expect(g.certificate.people).toBe(0);
      if (g.cause === "availability") expect(g.certificate.unavailableIds.length).toBeGreaterThan(0);
    }
    expect(off.gaps.some((g) => g.cause === "capacity")).toBe(true);
    expect(off.gaps.filter((g) => g.code === "closing_manager_missing").map((g) => g.cause)).toEqual(["availability"]);
    expect(off.shifts).toEqual([]);
    const managersOff = buildWeek(small({ specs: SMALL_SPECS.map((p) => (["u-g-gus", "u-j-gm"].includes(p.id) ? { ...p, off: [2] } : p)), days: [day(TUE)] }));
    expectClean(managersOff);
    const modGaps2 = managersOff.gaps.filter((g) => g.code === "mod_missing");
    expect(modGaps2.length).toBeGreaterThan(0);
    expect(modGaps2.every((g) => g.cause === "availability" && g.certificate.unavailableIds.includes("u-g-gus"))).toBe(true);

    const closed = structure((x) => { x.leadership.modRequired = false; x.positions[I.$REG]!.trimQ = 64; x.positions[I.$REG]!.closeQ = 64; x.positions[I.$EXPO]!.closeQ = 84; x.positions[I.$EXPO]!.trimQ = 84; });
    const str = buildWeek(small({ structure: closed, days: [day(MON, {}, closed)] }));
    expectClean(str);
    const expoGaps = str.gaps.filter((g) => g.positionId === I.$EXPO && g.fromQ >= 64);
    expect(expoGaps.length).toBeGreaterThan(0);
    expect(expoGaps.every((g) => g.cause === "structure" && g.certificate.rule === "primary_window_closed")).toBe(true);

    const mod = buildWeek(small({ specs: SMALL_SPECS.filter((p) => !["u-g-gus", "u-j-gm"].includes(p.id)), days: [day(MON)] }));
    expectClean(mod);
    const modGaps = mod.gaps.filter((g) => g.code === "mod_missing");
    expect(modGaps.length).toBeGreaterThan(0);
    expect(modGaps.every((g) => g.cause === "structure" && g.certificate.rule === "no_mod_member")).toBe(true);
  });

  it("capacity (r3): two simultaneous required positions, one eligible + available person, ample budget → a capacity certificate with the numbers, no search", () => {
    const s = onePosition((x) => {
      x.positions[I.$REG]!.allowedRoles = ["trainer"];
      x.positions[I.$WALKON] = { ...x.positions[I.$REG]!, role: "walk_online" };
      for (const t of ["slow", "normal", "busy", "weekend"] as const) { x.crews[t].lineMinHeads = { [I.$REG]: 1, [I.$WALKON]: 1 }; x.crews[t].waves.setup.heads = 2; }
    });
    const out = buildWeek(fixture({ structure: s, specs: [{ id: "u-t", role: "trainer", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-e", role: "employee" }], days: oneDay(s, null), budgetByDate: { [MON]: 400 } }));
    expectClean(out);
    expect(out.shifts.map((x) => [x.userId, x.segments[0]!.positionId])).toEqual([["u-t", I.$REG]]);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0]).toMatchObject({ cause: "capacity", positionId: I.$WALKON, certificate: { requiredHeads: 2, people: 1, shortBy: 1, peopleIds: ["u-t"] } });
    expect(out.stats.repair.provenEarly).toBe(1);
  });

  it("floor_limit: salaried managers at 32 h; a position only the GM may work is covered until his floor is spent, then certified floor_limit", () => {
    // Expeditor 10:00–15:00 (needed 10:30–15:00 = 4.5 h) inside the GM's 7:00–15:00 block, GM-only; the floor limit is the 24 h setting:
    // Mon–Fri cover 22.5 h, Saturday's 4.5 h would make 27 > 24 → floor_limit on Sat and Sun.
    const s = structure((x) => {
      x.leadership.modRequired = false;
      x.limits.managerFloorH = 24;
      x.positions[I.$EXPO]!.allowedRoles = ["gm"];
      x.positions[I.$EXPO]!.openQ = 40; x.positions[I.$EXPO]!.trimQ = 60; x.positions[I.$EXPO]!.closeQ = 60;
    });
    const out = buildWeek(small({ structure: s, days: DATES.map((d) => day(d, {}, s)) }));
    expectClean(out);
    const covered = out.shifts.filter((x) => x.userId === "u-j-gm" && x.segments.some((g) => g.positionId === I.$EXPO));
    const coveredHours = covered.reduce((n, x) => n + x.segments.filter((g) => g.positionId === I.$EXPO).reduce((k, g) => k + (g.endQ - g.startQ), 0), 0) / 4;
    expect(covered.length).toBeGreaterThanOrEqual(4);
    expect(coveredHours).toBeLessThanOrEqual(24);
    expect(covered.every((x) => x.segments.every((g) => g.positionId !== I.$EXPO || !g.lastResort))).toBe(true);
    const floorGaps = out.gaps.filter((g) => g.positionId === I.$EXPO);
    expect(floorGaps.length).toBeGreaterThan(0);
    expect(floorGaps.every((g) => g.date > covered[covered.length - 1]!.date)).toBe(true);
    for (const g of floorGaps) {
      expect(g.cause).toBe("floor_limit");
      if (g.cause !== "floor_limit") continue;
      expect(g.certificate).toMatchObject({ managerIds: ["u-j-gm"], limitH: 24, floorHoursUsed: { "u-j-gm": coveredHours } });
      expect(coveredHours + (g.toQ - g.fromQ) / 4).toBeGreaterThan(24);
    }
    expect(out.problems.filter((p) => p.code === "manager_floor_exceeded")).toEqual([]);
  });

  it("manager cover: in preference order (rank), outside the list only as lastResort, never Prep/Dishwasher", () => {
    const s = structure((x) => {
      x.leadership.modRequired = false;
      x.positions[I.$EXPO]!.allowedRoles = ["gm"];
      x.positions[I.$WALK]!.allowedRoles = ["gm"];
      x.positions[I.$DISH]!.allowedRoles = ["gm"];
    });
    const out = buildWeek(small({ structure: s, days: [day(MON, {}, s)] }));
    expectClean(out);
    const gm = out.shifts.find((x) => x.userId === "u-j-gm")!;
    const expo = gm.segments.find((g) => g.positionId === I.$EXPO)!;
    expect(expo.lastResort).toBeUndefined();
    const key = `${MON}|u-j-gm|${gm.startQ}`;
    expect(out.reasons[key]!.shift.some((r) => r.key === "manager_cover" && r.params.rank === 2)).toBe(true);
    const walk = gm.segments.find((g) => g.positionId === I.$WALK);
    if (walk) {
      expect(walk.lastResort).toBe(true);
      expect(out.reasons[key]!.shift.some((r) => r.key === "manager_cover_last_resort")).toBe(true);
    }
    expect(gm.segments.some((g) => g.positionId === I.$DISH)).toBe(false);
    expect(out.gaps.filter((g) => g.positionId === I.$DISH).every((g) => g.cause === "eligibility")).toBe(true);
  });

  it("repair (a) F0e: the only qualified closer was used elsewhere; the chain moves her to the close and Sam takes her block; NO gap", () => {
    const out = buildWeek(f0eRepairNeeded());
    expectClean(out);
    expect(out.gaps.filter((g) => g.positionId === I.$WALKON)).toEqual([]);
    const tess = out.shifts.find((x) => x.userId === "u-tess")!;
    expect(tess.segments.some((g) => g.positionId === I.$WALKON && g.endQ === 83)).toBe(true);
    expect(tess.closingManager).toBe(true);
    // Her Register closing block is refilled by an eligible person (the strongest free one), to the same end.
    const reg = out.shifts.find((x) => x.userId !== "u-tess" && x.segments.some((g) => g.positionId === I.$REG && g.endQ === 83));
    expect(reg).toBeDefined();
    expect(out.gaps.filter((g) => g.positionId === I.$REG)).toEqual([]);
    expect(out.reasons[`${MON}|u-tess|${tess.startQ}`]!.shift.some((r) => r.key === "repair_moved")).toBe(true);
    expect(out.stats.repair.accepted).toBeGreaterThan(0);
  });

  it("repair (b) F0i: the first three donors fail (overtime, leader setting, availability) and the 4th succeeds; r2's 3-donor limit would have failed", () => {
    const out = buildWeek(f0iFourthDonor());
    expectClean(out);
    expect(out.gaps.filter((g) => g.positionId === I.$WALK)).toEqual([]);
    const walk = out.shifts.find((x) => x.date === MON && x.segments.some((g) => g.positionId === I.$WALK))!;
    expect(walk.userId).toBe("u-k4-ok");
    expect(out.stats.repair.donorsTried).toBeGreaterThanOrEqual(4);
    // k4's vacated Walk-ins / Online block is refilled by the free filler.
    const refill = out.shifts.find((x) => x.date === MON && x.userId === "u-f2-fill");
    expect(refill?.segments.map((g) => g.positionId)).toEqual([I.$WALKON]);
    expect(out.problems.filter((p) => p.code === "overtime")).toEqual([]);
    expect(out.shifts.find((x) => x.date === MON && x.userId === "u-k1-ot")?.segments.map((g) => g.positionId)).toEqual([I.$BOI]);
  });

  it("repair (c) F0j: a 3-link ejection chain closes the deficit; the 4-link variant is declared unresolved_search with chainDepth 3, never a proof, never a throw", () => {
    const three = buildWeek(f0jLongChain(false));
    expectClean(three);
    expect(three.gaps).toEqual([]);
    const by = (u: string) => three.shifts.find((x) => x.userId === u)!;
    expect(by("u-tess").segments.map((g) => g.positionId)).toContain(I.$WALK);
    expect(by("u-sam").segments.map((g) => g.positionId)).toContain(I.$THIRD);
    expect(by("u-leo").segments.map((g) => g.positionId)).toContain(I.$EXPO);
    expect(three.stats.repair.chainDepth).toBe(3);
    // With Leo off a 4th link would be needed. The search may still trade the 4 h Walk-ins hole for a shorter one
    // (the uncovered total strictly falls), so exactly one deficit remains, honest and unproven, on Walk-ins or Expeditor.
    const four = buildWeek(f0jLongChain(true));
    expectClean(four);
    expect(four.gaps).toHaveLength(1);
    expect([I.$WALK, I.$EXPO]).toContain(four.gaps[0]!.positionId);
    expect(four.gaps[0]).toMatchObject({ cause: "unresolved_search", certificate: { searched: { chainDepth: 3 }, limits: { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 } } });
    expect(four.problems.some((p) => p.code === "coverage_gap" && p.params.proven === false)).toBe(true);
    expect(four.stats.repair.steps).toBeLessThanOrEqual(200);
  });

  it("the repair never reduces the closing crew or MoD coverage: a chain that would steal the Closing Manager for lunch is refused", () => {
    const s = repairShop((x) => {
      // The afternoon Walk-ins head wants a KH; the only KH is the closer on Register (closing crew 1), so moving her would open the close.
      for (const t of ["slow", "normal", "busy", "weekend"] as const) x.crews[t].close = { registerHeads: 1, walkHeads: 0, prepDishHeads: 0 };
      x.positions[I.$REG]!.closeQ = 84; x.positions[I.$REG]!.trimQ = 84;
    });
    const specs: PersonSpec[] = [
      { id: "u-kh", role: "key_holder", leader: "closes", close: 0.9, skills: { [I.$REG]: [0.9, 0.7], [I.$WALK]: [0.9, 0.7] } },
      { id: "u-e1", role: "employee", skills: { [I.$REG]: [0.5, 0.7], [I.$WALKON]: [0.9, 0.7] } },
      { id: "u-e2", role: "employee", skills: { [I.$BOI]: [0.9, 0.7], [I.$THIRD]: [0.8, 0.7], [I.$EXPO]: [0.8, 0.7] } },
    ];
    const out = buildWeek(fixture({ structure: s, specs, days: [day(MON, { demandKind: "no_history", hourlyCents: null, dayCents: null }, s)] }));
    expectClean(out);
    const kh = out.shifts.find((x) => x.userId === "u-kh")!;
    expect(kh.closingManager).toBe(true);
    expect(kh.endQ).toBe(83);
    expect(out.gaps.filter((g) => g.fromQ >= 80)).toEqual([]);
  });
});

describe("Task 7: the historical contract, strength, the priority relabel", () => {
  it("history (r2 P1-3): a past Monday with a manager-made break, a deactivated person and a retired position is carried byte-identical, inherited, without a throw; the deactivated person gets no new shift", () => {
    const retired = "5c000000-0000-4000-8000-00000000ff01";
    const headShifts = [
      { userId: "u-b-bo", date: MON, startQ: 44, endQ: 52, segments: [{ positionId: I.$REG, startQ: 44, endQ: 52 }], closingManager: false, flex: false, pinned: false },
      { userId: "u-x-gone", date: MON, startQ: 38, endQ: 56, segments: [{ positionId: I.$BOI, startQ: 38, endQ: 56 }], closingManager: false, flex: false, pinned: false },
      { userId: "u-c-cy", date: MON, startQ: 42, endQ: 60, segments: [{ positionId: retired, startQ: 42, endQ: 60 }], closingManager: false, flex: false, pinned: false },
    ];
    const problems = [{ code: "shift_below_minimum" as const, severity: "error" as const, day: MON, userId: "u-b-bo", q: 44, params: { minutes: 120, minimumMinutes: 240 }, inherited: false }];
    const head = { revisionId: "rev-1", shifts: headShifts, days: [{ date: MON, originRevisionId: "rev-1", structureVersionId: "sv-old", inherited: false, problems }], gaps: [], closingWindowByDate: { [MON]: { fromQ: 80, toQ: 83 } } };
    const specs = [...SMALL_SPECS, { id: "u-x-gone", role: "employee" as const, active: false }];
    const out = buildWeek(fixture({ specs, today: TUE, days: [day(TUE)], head }));
    const byUser = (a: { userId: string }, b: { userId: string }) => (a.userId < b.userId ? -1 : 1);
    expect([...out.shifts.filter((x) => x.date === MON)].sort(byUser)).toEqual([...headShifts].sort(byUser));
    const mon = out.days.find((d) => d.date === MON)!;
    expect(mon).toMatchObject({ inherited: true, originRevisionId: "rev-1", structureVersionId: "sv-old" });
    expect(mon.problems).toEqual(problems.map((p) => ({ ...p, inherited: true })));
    expect(out.problems.filter((p) => p.day === MON).every((p) => p.inherited)).toBe(true);
    expect(out.problems.filter((p) => p.severity === "error" && !p.inherited)).toEqual([]);
    expect(out.shifts.filter((x) => x.userId === "u-x-gone" && x.date !== MON)).toEqual([]);
    expect(out.reasons[`${MON}|u-b-bo|44`]!.shift).toEqual([{ key: "inherited", params: {} }]);
  });

  it("team strength: weighted by minutes, MoD excluded, thresholds from the structure, unproven minutes reported separately (never averaged as 0), all-unproven reads unknown", () => {
    const s = structure();
    const people = { a: person({ id: "a", role: "employee" }), b: person({ id: "b", role: "employee" }), u: person({ id: "u", role: "trainee" }), m: person({ id: "m", role: "gm" }) };
    const lookup = skillsOf([{ id: "a", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "b", role: "employee", skills: { [I.$WALKON]: [0.5, 0.7] } }], [], s);
    const shifts = [
      { userId: "a", date: MON, startQ: 44, endQ: 52, segments: [{ positionId: I.$REG, startQ: 44, endQ: 52 }], closingManager: false, flex: false, pinned: false },
      { userId: "b", date: MON, startQ: 44, endQ: 48, segments: [{ positionId: I.$WALKON, startQ: 44, endQ: 48 }], closingManager: false, flex: false, pinned: false },
      { userId: "u", date: MON, startQ: 44, endQ: 52, segments: [{ positionId: I.$WALK, startQ: 44, endQ: 52 }], closingManager: false, flex: false, pinned: false },
      { userId: "m", date: MON, startQ: 28, endQ: 60, segments: [{ positionId: "mod", startQ: 28, endQ: 60 }], closingManager: false, flex: false, pinned: false },
    ];
    const windows = teamStrength(shifts, MON, people, s, lookup, "normal", 83);
    const setup = windows.find((w) => w.key === "setup")!; // 9:30–10:30: nobody on a position (the GM is MoD)
    expect(setup).toMatchObject({ minutes: 0, word: "empty" });
    const lunch = windows.find((w) => w.key === "lunch_rush")!; // 11:30–13:30: a 90 min @ 0.9 + b 30 min @ 0.5; u 90 min unproven
    expect([lunch.fromQ, lunch.toQ]).toEqual([46, 54]);
    expect(lunch).toMatchObject({ minutes: 210, evidenceMinutes: 120, unprovenMinutes: 90, unprovenIds: ["u"] });
    expect(lunch.mean).toBe(Math.round(((90 * 0.9 + 30 * 0.5) / 120) * 1000) / 1000);
    expect(lunch.word).toBe("strong");
    const only = teamStrength(shifts.filter((x) => x.userId === "u"), MON, people, s, lookup, "normal", 83).find((w) => w.key === "lunch_rush")!;
    expect(only).toMatchObject({ mean: null, word: "unknown", unprovenMinutes: 90 });
    const thin = teamStrength(shifts.filter((x) => x.userId === "b"), MON, people, s, lookup, "normal", 83).find((w) => w.key === "lunch_rush")!;
    expect(thin.word).toBe("thin");
  });

  it("priority enforcement relabels a secondary filled without its primary onto the primary when the person is allowed there and it is open", () => {
    const out = buildWeek(small({ days: [day(MON)] }));
    const b: BuildCtx = { ctx: out.context, structure: out.context.days[MON]!.structure, people: Object.fromEntries(small().people.map((p) => [p.userId, p])), lookup: small().skills, budgetedDates: [], budgetHours: 0, busiest: {}, notes: [], pinCover: {} };
    const walkOnly: GShift = { userId: "u-f-finn", date: MON, startQ: 44, endQ: 60, segments: [{ positionId: I.$WALK, startQ: 44, endQ: 60, reasons: [] }], closingManager: false, flex: false, pinned: false, reasons: [], origin: "hourly" };
    const week: WeekState = { built: { [MON]: [walkOnly] }, inherited: [] };
    enforcePriority(b, week, MON);
    expect(week.built[MON]![0]!.segments.map((g) => [g.positionId, g.startQ, g.endQ])).toEqual([[I.$WALKON, 44, 60]]);
    expect(week.built[MON]![0]!.segments[0]!.reasons[0]!.key).toBe("priority_cover");
  });
});

describe("buildWeek smoke: the small shop builds a validator-clean week", () => {
  it("builds every day, fills the closing crew with a Closing Manager, and leaves no new error", () => {
    const out = buildWeek(small({ days: [day(MON), day(TUE)] }));
    expectClean(out);
    expect(out.shifts.filter((x) => x.date === MON).length).toBeGreaterThan(3);
    expect(out.shifts.filter((x) => x.date === MON && x.closingManager)).toHaveLength(1);
    const again = checkScheduleRules({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days }, out.context);
    expect(JSON.stringify(again)).toBe(JSON.stringify(out.problems));
  });
});

describe("CC chunk B ruling 3: the daily maximum shift is HARD in the generator", () => {
  const longest = (out: GeneratorOutput) => Math.max(...out.shifts.map((x) => x.endQ - x.startQ));

  it("never produces a shift over limits.maxShiftH (default 10.5 h, CC chunk C ruling 2); a 13.75 h Prep/Dishwasher day is split across two people, covered", () => {
    const s = structure((x) => { x.leadership.modRequired = false; });
    const out = buildWeek(small({ structure: s, days: [day(MON, {}, s)] }));
    expectClean(out);
    expect(longest(out)).toBeLessThanOrEqual(42);
    // Prep/Dishwasher is needed 7:00 → everyone out (28 → 83): no one person can hold it, so two people do, and it is covered.
    const dish = out.shifts.filter((x) => x.date === MON && x.segments.some((g) => g.positionId === I.$DISH));
    expect(new Set(dish.map((x) => x.userId)).size).toBeGreaterThanOrEqual(2);
    expect(out.gaps.filter((g) => g.positionId === I.$DISH)).toEqual([]);
  });

  it("follows the setting: at 12 h the cap is 48 quarters; at 8 h it is 32; every output stays validator-clean", () => {
    for (const h of [12, 8]) {
      const s = structure((x) => { x.leadership.modRequired = false; x.limits.maxShiftH = h; });
      const out = buildWeek(small({ structure: s, days: [day(MON, {}, s)] }));
      expectClean(out);
      expect(longest(out)).toBeLessThanOrEqual(h * 4);
    }
  });

  it("a run longer than the cap is split into the fewest near-equal parts: Prep/Dishwasher 7:00 → 8:00 PM (no closing head) is 28–54 + 54–80", () => {
    const s = structure((x) => { x.leadership.modRequired = false; for (const t of ["slow", "normal", "busy", "weekend"] as const) x.crews[t].close.prepDishHeads = 0; });
    const out = buildWeek(small({ structure: s, days: [day(MON, {}, s)] }));
    expectClean(out);
    const dish = out.shifts.filter((x) => x.date === MON && x.segments.some((g) => g.positionId === I.$DISH)).map((x) => [x.startQ, x.endQ]);
    expect(dish).toEqual([[28, 54], [54, 80]]);
    expect(out.gaps.filter((g) => g.positionId === I.$DISH)).toEqual([]);
  });

  it("the whole sample week (the mockup's people, MoD on) has no shift over the 10.5 h default", () => {
    const out = buildWeek(small({ days: DATES.map((d) => day(d)) }));
    expectClean(out);
    expect(longest(out)).toBeLessThanOrEqual(42);
  });
});

describe("CC chunk C ruling 2: a cap-only gap — the generator fills up to the cap, then the counting bound certifies the rest", () => {
  /** Register 10:00 AM – 9:00 PM (11 h = 44 q) needs one head all day; the default cap is 10.5 h (42 q). */
  const longRegister = () => onePosition((s) => {
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 40, serviceCloseQ: 84, outEarliestQ: 84, outLatestQ: 88 };
    s.positions[I.$REG] = { ...s.positions[I.$REG]!, openQ: 40, trimQ: 84, closeQ: 84 };
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      s.crews[t].prepUntilQ = 40;
      s.crews[t].waves = { setup: { heads: 1, atQ: 40 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } };
    }
  });

  it("one eligible person: a 10.5 h shift, and the 30-minute remainder is a `structure` gap with rule max_shift (never unresolved_search)", () => {
    const s = longRegister();
    const out = buildWeek(fixture({ structure: s, specs: [{ id: "u-e", role: "employee", skills: { [I.$REG]: [0.8, 0.7] } }], days: [day(MON, {}, s)] }));
    expectClean(out);
    expect(out.shifts.map((x) => x.endQ - x.startQ)).toEqual([42]);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0]).toMatchObject({ code: "coverage_gap", positionId: I.$REG, cause: "structure",
      certificate: { rule: "max_shift", detail: { runFromQ: 40, runToQ: 84, maxShiftQ: 42, requiredQ: 44, peopleIds: ["u-e"], coverableQ: 42, shortQ: 2 } } });
    expect(out.gaps[0]!.toQ - out.gaps[0]!.fromQ).toBe(2);
    expect(out.problems.filter((p) => p.code === "uncertified_gap" || p.code === "undeclared_gap")).toEqual([]);
  });

  it("two eligible people: covered end to end, no gap (the overlong run alone is never a proof)", () => {
    const s = longRegister();
    const out = buildWeek(fixture({ structure: s, specs: [{ id: "u-e", role: "employee" }, { id: "u-f", role: "employee" }], days: [day(MON, {}, s)] }));
    expectClean(out);
    expect(out.gaps).toEqual([]);
  });
});

describe("CC chunk D rulings 1 + 2: a salaried manager STAYS LONGER — a zero-hourly-cost fill within the cap and the floor limit", () => {
  /** Register 10:00 AM – 9:00 PM (44 q) needs one head; the GM (any hours, Register in their cover list) is the only person. */
  const longRegister = (over: (s: ScheduleStructure) => void = () => {}) => onePosition((s) => {
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 40, serviceCloseQ: 84, outEarliestQ: 84, outLatestQ: 88 };
    s.positions[I.$REG] = { ...s.positions[I.$REG]!, openQ: 40, trimQ: 84, closeQ: 84 };
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      s.crews[t].prepUntilQ = 40;
      s.crews[t].waves = { setup: { heads: 1, atQ: 40 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } };
    }
    over(s);
  });
  const gmOnly: PersonSpec[] = [{ id: "u-gm", role: "gm", leader: "mix", cover: [I.$REG] }];
  const floorQ = (out: GeneratorOutput, userId: string) => out.shifts.filter((x) => x.userId === userId).reduce((n, x) => n + x.segments.filter((g) => g.positionId !== "mod").reduce((m, g) => m + g.endQ - g.startQ, 0), 0);
  const reasonKeys = (out: GeneratorOutput, userId: string) => Object.entries(out.reasons).filter(([k]) => k.includes(`|${userId}|`)).flatMap(([, r]) => r.shift.map((x) => x.key));

  it("ON (the default): the GM stays up to the 10.5 h cap at zero hourly cost, the board names it, and only the cap's 30 minutes remain (max_shift)", () => {
    const s = longRegister();
    expect(s.limits.salariedStayLonger).toBe(true);
    const out = buildWeek(fixture({ structure: s, specs: gmOnly, days: [day(MON, {}, s)] }));
    expectClean(out);
    const gm = out.shifts.filter((x) => x.userId === "u-gm");
    expect(gm.map((x) => x.endQ - x.startQ)).toEqual([42]);
    expect(out.stats.hourlyHours).toBe(0);
    expect(reasonKeys(out, "u-gm")).toContain("salaried_extension");
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0]).toMatchObject({ cause: "structure", certificate: { rule: "max_shift", detail: { shortQ: 2 } } });
  });

  it("OFF: the GM is never extended, and no stay-longer fill is offered to the certificates", () => {
    const s = longRegister((x) => { x.limits.salariedStayLonger = false; });
    const out = buildWeek(fixture({ structure: s, specs: gmOnly, days: [day(MON, {}, s)] }));
    expectClean(out);
    expect(out.shifts.filter((x) => x.userId === "u-gm").map((x) => x.endQ - x.startQ)).toEqual([16]);
    expect(reasonKeys(out, "u-gm")).not.toContain("salaried_extension");
    const schedule = { locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days };
    for (const g of out.gaps) expect(zeroCostCovers(g, schedule, out.context).filter((c) => c.extend)).toEqual([]);
  });

  it("the extension's floor time counts against the WEEKLY floor limit (6 h → the GM's floor time stops at 24 q, no manager_floor_exceeded)", () => {
    const s = longRegister((x) => { x.limits.managerFloorH = 6; });
    const out = buildWeek(fixture({ structure: s, specs: gmOnly, days: [day(MON, {}, s)] }));
    expectClean(out);
    expect(floorQ(out, "u-gm")).toBe(24);
    expect(out.problems.filter((p) => p.code === "manager_floor_exceeded")).toEqual([]);
  });

  it("budget 0: a GM who may stay to the close takes 2:00–3:00 PM at zero hourly cost — no gap, no hourly hour (an opens-only GM cannot: chunk B P1-1 above)", () => {
    const s = onePosition();
    const specs: PersonSpec[] = [{ id: "u-e", role: "employee", skills: { [I.$REG]: [0.9, 0.7] } }, { id: "u-gm", role: "gm", leader: "mix", cover: [I.$REG] }];
    const out = buildWeek(fixture({ structure: s, specs, days: oneDay(s), budgetByDate: Object.fromEntries(DATES.map((d) => [d, d === MON ? 0 : null])) }));
    expectClean(out);
    expect(out.gaps).toEqual([]);
    expect(out.stats.hourlyHours).toBe(0);
    const gm = out.shifts.find((x) => x.userId === "u-gm")!;
    expect([gm.startQ, gm.endQ]).toEqual([40, 60]);
  });

  it("the budget certificate is REFUSED while a stay-longer fill exists; zeroCostCovers names it; OFF → no such fill", () => {
    const s = onePosition();
    const specs: PersonSpec[] = [{ id: "u-e", role: "employee" }, { id: "u-gm", role: "gm", leader: "mix", cover: [I.$REG] }];
    const out = buildWeek(fixture({ structure: s, specs, days: oneDay(s), budgetByDate: Object.fromEntries(DATES.map((d) => [d, d === MON ? 0 : null])) }));
    // Hand-made: the GM leaves at 2:00 PM (56); 2:00–3:00 PM is open.
    const shifts = [{ userId: "u-gm", date: MON, startQ: 40, endQ: 56, segments: [{ positionId: "mod", startQ: 40, endQ: 44 }, { positionId: I.$REG, startQ: 44, endQ: 56 }], closingManager: false, flex: false, pinned: false }];
    const schedule = { locationId: out.context.locationId, weekStart: out.context.weekStart, shifts, gaps: [], days: out.days };
    const subject = { code: "coverage_gap" as const, date: MON, positionId: I.$REG, fromQ: 56, toQ: 60 };
    expect(zeroCostCovers(subject, schedule, out.context)).toEqual([{ userId: "u-gm", fromQ: 56, toQ: 60, extend: "after" }]);
    const cert = { ...subject, cause: "budget" as const, certificate: { budgetedDates: [MON], budgetHours: 0, usedHours: 0, essentialHours: 0, hoursNeeded: 4 } };
    for (const hoursNeeded of [0, 1, 4]) expect(checkCertificate({ ...cert, certificate: { ...cert.certificate, hoursNeeded } }, schedule, out.context)).toBe(false);
    const off = structuredClone(out.context);
    off.days[MON]!.structure.limits.salariedStayLonger = false;
    expect(zeroCostCovers(subject, schedule, off)).toEqual([]);
  });

  it("the money strip keeps salaried cost FIXED: the GM's extension adds no hourly hour and no hourly $", () => {
    const s = longRegister();
    const out = buildWeek(fixture({ structure: s, specs: gmOnly, days: [day(MON, {}, s)] }));
    const strip = moneyStrip({ dates: out.context.dates, shifts: out.shifts, ctx: out.context, wageCentsByUser: { "u-gm": null }, forecastWeekCents: 1_000_000, salariedWeeklyCents: 150_000 }, { canSeeMoney: true });
    expect(strip.hours.hourlyHours).toBe(0);
    expect(strip.money).toMatchObject({ hourlyCostCents: 0, salariedFixedCents: 150_000 });
    expect(strip.hours.managerFloorHours).toBe(floorQ(out, "u-gm") / 4);
  });
});
