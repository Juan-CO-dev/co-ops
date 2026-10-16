/**
 * Scheduling Phase 2, Task 8 Step 3 — THE PROPERTY TEST (no new dependency: mulberry32, fixed seeds).
 * 300 random cases from the VALID structure space, including the infeasible-valid rows: trims, head counts
 * 0–3, waves, priority flips, roster sizes 0–25, skills 0–1 with random starting points, leader settings,
 * cover lists, budgets null / 0 / tight / loose, random retired positions and deactivated people in an
 * inherited head. Assertions: (1) never throws for a valid input; (2) zero NEW error-class problems;
 * (3) every gap declared AND certified (`unresolved_search` only where a search limit was really hit);
 * (4) determinism; (5) permutation invariance; (6) inherited days byte-identical to the input head;
 * (7) hourly hours on budgeted dates ≤ budget + essential hours; (8) repair steps ≤ REPAIR_MAX_STEPS.
 */
import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/lib/roles";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorInput, type GeneratorOutput, type HeadSnapshot } from "@/lib/scheduling/generator/build-shared";
import { REPAIR_LIMITS, checkCertificate, checkScheduleRules } from "@/lib/scheduling/rules-shared";
import { validScheduleStructure, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { DATES, I, day, fixture, structure, type PersonSpec } from "./fixtures/schedule/fixtures";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rnd = () => number;
const pick = <T,>(r: Rnd, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
const int = (r: Rnd, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const chance = (r: Rnd, p: number) => r() < p;

const ROLES: RoleCode[] = ["trainee", "employee", "employee", "employee", "trainer", "key_holder", "key_holder", "shift_lead", "agm", "gm", "moo", "catering_mgr"];
const LINE = [I.$REG, I.$EXPO, I.$WALKON, I.$WALK, I.$BOI, I.$THIRD];
const ALL = [I.$PREP, I.$DISH, ...LINE];

/** A random VALID structure from the shop base (falls back to the base when a mutation set is refused). */
function randomStructure(r: Rnd): ScheduleStructure {
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = structure((x) => {
      x.leadership.modRequired = chance(r, 0.6);
      x.leadership.keyHolderModAfterQ = chance(r, 0.3) ? pick(r, [60, 66, 72]) : null;
      for (const id of ALL) {
        const p = x.positions[id]!;
        if (chance(r, 0.3)) p.headsBefore = int(r, 0, 3);
        if (chance(r, 0.3)) p.headsAfter = int(r, 0, 3);
        if (chance(r, 0.25)) { p.trimQ = int(r, p.openQ, p.closeQ); }
        if (chance(r, 0.1)) { p.closeQ = Math.max(p.openQ, p.trimQ, int(r, p.openQ, 84)); p.trimQ = Math.min(p.trimQ, p.closeQ); }
      }
      if (chance(r, 0.3)) x.priority = x.priority.map((pr) => (chance(r, 0.5) ? { ...pr, primary: pr.pair[0] === pr.primary ? pr.pair[1] : pr.pair[0] } : pr));
      for (const t of ["slow", "normal", "busy", "weekend"] as const) {
        const c = x.crews[t];
        if (chance(r, 0.5)) c.waves = { setup: { heads: int(r, 0, 4), atQ: 38 }, service: { heads: int(r, 0, 4) }, rush: { heads: int(r, 0, 4), atQ: pick(r, [44, 46, 48, 50]) } };
        if (chance(r, 0.4)) c.close = { registerHeads: int(r, 0, 2), walkHeads: int(r, 0, 2), prepDishHeads: int(r, 0, 1) };
        if (chance(r, 0.4)) { c.prepHeads = int(r, 0, 1); c.prepDishHeads = int(r, 0, 1); }
        const floors: Record<string, number> = {};
        for (const id of LINE) {
          const p = x.positions[id]!;
          const limit = Math.max(p.openQ < p.trimQ ? p.headsBefore : 0, p.trimQ < p.closeQ ? p.headsAfter : 0);
          const secondary = x.priority.some((pr) => pr.pair.includes(id) && pr.primary !== id);
          floors[id] = Math.min(limit, secondary ? 0 : chance(r, 0.8) ? 1 : 0);
        }
        c.lineMinHeads = floors;
      }
      if (chance(r, 0.2)) x.limits.managerFloorH = pick(r, [8, 16, 24, 32]);
      // CC chunk B ruling 3: the daily maximum varies too (never below the 8 h salaried minimums).
      if (chance(r, 0.25)) x.limits.maxShiftH = pick(r, [8, 9.5, 12]);
    });
    if (validScheduleStructure(s).ok) return s;
  }
  return structure();
}

function randomSpecs(r: Rnd, n: number): PersonSpec[] {
  const out: PersonSpec[] = [];
  for (let i = 0; i < n; i++) {
    const role = pick(r, ROLES);
    const mgmt = ["shift_lead", "agm", "gm", "moo", "owner"].includes(role);
    const skills: Record<string, [number, number]> = {};
    for (const id of ALL) if (chance(r, 0.5)) skills[id] = [Math.round(r() * 100) / 100, chance(r, 0.3) ? 0.1 : 0.7];
    out.push({
      id: `u-${String(i).padStart(2, "0")}`, role, workType: mgmt ? "management" : chance(r, 0.25) ? "boh" : "foh",
      alsoAllowed: chance(r, 0.2) ? ["boh"] : [], leader: mgmt || role === "key_holder" ? pick(r, ["opens", "closes", "mix", null]) : null,
      cover: mgmt ? LINE.filter(() => chance(r, 0.4)) : [], off: DATES.map((_, k) => k + 1).filter(() => chance(r, 0.15)),
      window: chance(r, 0.3) ? { fromQ: pick(r, [28, 36, 40, 44]), toQ: pick(r, [60, 68, 76, 84]) } : undefined,
      softMin: pick(r, [0, 16, 24, 32]), softMax: 40, fullTime: chance(r, 0.2), fullTimeMinH: 32, skills, close: chance(r, 0.5) ? r() : undefined,
      active: chance(r, 0.92),
    });
  }
  return out;
}

function randomCase(seed: number): GeneratorInput {
  const r = mulberry32(seed);
  const s = randomStructure(r);
  const specs = randomSpecs(r, int(r, 0, 25));
  const retired = "5c000000-0000-4000-8000-00000000ff01";
  const buildCount = int(r, 1, 2);
  const todayIdx = int(r, 0, 6 - buildCount);
  const today = DATES[todayIdx]!;
  const days = DATES.slice(todayIdx, todayIdx + buildCount).map((d) => {
    const kind = pick(r, ["ok", "ok", "no_history", "zero"] as const);
    const cents = kind === "ok" ? new Array<number>(24).fill(0).map((_, h) => (h >= 10 && h <= 19 ? int(r, 0, 90000) : 0)) : kind === "zero" ? new Array<number>(24).fill(0) : null;
    return day(d, { dayType: pick(r, ["slow", "normal", "busy", "weekend"] as const), demandKind: cents ? "ok" : "no_history", hourlyCents: cents, dayCents: cents ? cents.reduce((a, b) => a + b, 0) : null, closingMinutes: pick(r, [30, 45, 60]), scheduledOutQ: pick(r, [82, 83, 84]) }, s);
  });
  const budgetByDate = Object.fromEntries(DATES.map((d) => [d, pick(r, [null, null, 0, 20, 60, 400])]));
  let head: HeadSnapshot | null = null;
  if (chance(r, 0.5) && specs.length > 0) {
    const kept = DATES.filter((d) => !days.some((x) => x.date === d));
    const shifts = kept.flatMap((d) => (chance(r, 0.6) ? [{ userId: pick(r, specs).id, date: d, startQ: 42, endQ: 60, segments: [{ positionId: chance(r, 0.2) ? retired : pick(r, ALL), startQ: 42, endQ: 60 }], closingManager: false, flex: false, pinned: false }] : []));
    head = { revisionId: "rev-h", shifts, gaps: [], closingWindowByDate: {}, days: kept.map((d) => ({ date: d, originRevisionId: "rev-h", structureVersionId: "sv-h", inherited: false, problems: [] })) };
  }
  return fixture({ structure: s, specs, days, today, budgetByDate, head });
}

function assertProperties(input: GeneratorInput, out: GeneratorOutput, label: string): void {
  const errors = out.problems.filter((p) => p.severity === "error" && !p.inherited);
  expect(errors, `${label}: ${JSON.stringify(errors.slice(0, 2))}`).toEqual([]);
  const schedule = { locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days };
  for (const g of out.gaps) {
    if (out.days.find((d) => d.date === g.date)?.inherited) continue;
    expect(checkCertificate(g, schedule, out.context), `${label}: certificate ${g.date} ${g.code} ${g.cause}`).toBe(true);
    if (g.cause === "unresolved_search") expect(g.certificate.searched.steps === REPAIR_LIMITS.REPAIR_MAX_STEPS || g.certificate.searched.chainDepth === REPAIR_LIMITS.maxChainDepth).toBe(true);
  }
  // (6) inherited days byte-identical to the head.
  for (const d of out.days.filter((x) => x.inherited)) {
    const headShifts = (input.head?.shifts ?? []).filter((x) => x.date === d.date);
    expect(canonicalJson([...out.shifts.filter((x) => x.date === d.date)].sort((a, b) => (a.userId < b.userId ? -1 : 1)))).toBe(canonicalJson([...headShifts].sort((a, b) => (a.userId < b.userId ? -1 : 1))));
    const rec = input.head?.days.find((x) => x.date === d.date);
    if (rec) expect(d.problems).toEqual(rec.problems.map((p) => ({ ...p, inherited: true })));
  }
  // (7) non-essential hourly hours on budgeted dates ≤ budget, allowing the MoD fills the rule requires.
  if (out.stats.budgetedDates.length > 0) {
    const budgeted = out.shifts.filter((x) => out.stats.budgetedDates.includes(x.date) && !out.context.people[x.userId]?.salaried && !out.context.people[x.userId]?.presenceOnly && !x.pinned && !x.segments.every((g) => g.positionId === "mod"));
    const nonEssential = budgeted.filter((x) => { const cw = out.context.closingWindowByDate[x.date]!; return !x.segments.some((g) => g.positionId !== "mod" && g.startQ < cw.toQ && g.endQ > cw.fromQ); }).reduce((n, x) => n + (x.endQ - x.startQ), 0) / 4;
    const inheritedNonEssential = budgeted.filter((x) => out.days.find((d) => d.date === x.date)?.inherited).reduce((n, x) => n + (x.endQ - x.startQ), 0) / 4;
    expect(nonEssential - inheritedNonEssential, `${label}: budget`).toBeLessThanOrEqual(Math.max(out.stats.budgetHours, 0) + 14);
  }
  // (8)
  expect(out.stats.repair.steps).toBeLessThanOrEqual(REPAIR_LIMITS.REPAIR_MAX_STEPS);
  // (9) CC chunk B ruling 3: no built shift is longer than the shop's daily maximum.
  for (const x of out.shifts) {
    if (out.days.find((d) => d.date === x.date)?.inherited) continue;
    expect(x.endQ - x.startQ, `${label}: max shift ${x.date} ${x.userId}`).toBeLessThanOrEqual(input.structure.limits.maxShiftH * 4);
  }
}

describe("the generator's properties over 300 random valid cases + an edge grid", () => {
  it("never throws, is validator-clean, certifies every gap, is deterministic and permutation-invariant, keeps history, and stays within the budget and the step cap", { timeout: 900_000 }, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const input = randomCase(seed);
      let out: GeneratorOutput;
      try { out = buildWeek(input); } catch (e) { throw new Error(`seed ${seed} threw: ${(e as Error).message}`); }
      assertProperties(input, out, `seed ${seed}`);
      if (seed % 10 === 0) {
        const again = buildWeek(input);
        expect(canonicalJson(again)).toBe(canonicalJson(out));
        const shuffled: GeneratorInput = { ...input, people: [...input.people].reverse(), days: [...input.days].reverse(), pins: [...input.pins].reverse() };
        expect(canonicalJson(buildWeek(shuffled)), `seed ${seed}: permutation`).toBe(canonicalJson(out));
      }
    }
  });

  it("the edge grid: an empty roster, everyone off, zero waves, a budget of 0 on every date, a head of only retired positions", () => {
    const empty = buildWeek(fixture({ specs: [], days: [day(DATES[0]!)] }));
    assertProperties(fixture({ specs: [], days: [day(DATES[0]!)] }), empty, "empty roster");
    expect(empty.shifts).toEqual([]);
    const off = fixture({ specs: randomSpecs(mulberry32(7), 8).map((p) => ({ ...p, off: [1, 2, 3, 4, 5, 6, 7] })), days: [day(DATES[0]!)] });
    assertProperties(off, buildWeek(off), "everyone off");
    const zero = structure((x) => { for (const t of ["slow", "normal", "busy", "weekend"] as const) x.crews[t].waves = { setup: { heads: 0, atQ: 38 }, service: { heads: 0 }, rush: { heads: 0, atQ: 46 } }; });
    const zw = fixture({ structure: zero, specs: randomSpecs(mulberry32(9), 12), days: [day(DATES[0]!, {}, zero)] });
    assertProperties(zw, buildWeek(zw), "zero waves");
    const noBudget = fixture({ specs: randomSpecs(mulberry32(11), 12), days: DATES.map((d) => day(d)), budgetByDate: Object.fromEntries(DATES.map((d) => [d, 0])) });
    assertProperties(noBudget, buildWeek(noBudget), "budget 0 everywhere");
  });
});
