/**
 * Digest labor money (PR 4, packet H): the PURE certify rules of lib/business-labor-hourly-shared.ts.
 *
 * What is proved here, from hand-written ledgers (no I/O, no runner):
 *   - the usable-week rule (§11.2.2, L6): W1 ready AND W2 ready AND X unmoved, every combination; a week missing from a
 *     coverage read is `unbuilt` (Opus P3-3); a null fingerprint is `stale_source` (§13.2.5);
 *   - `chooseLatestFinalDay`: the newest hours-complete day of a ready week; ONE missing day cost = no choice, never an
 *     older day;
 *   - each line's own state, and: structures not in the ledger → no default target anywhere (Opus N2); an empty ledger →
 *     every part `unavailable`, never a 0.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { targetsForWeek, type StructureRow } from "@/lib/business-report";
import { laborWeekState, type LaborWeekCoverageRow, type LaborWeekGenerationRow } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import type { LaborCostRow } from "@/lib/facts/labor-cost-shared";
import {
  canonicalRoleKey, certifyHourly, certifyRoleLedger, chooseLatestFinalDay, emptyHourlyLedger, hourlyFrame, weekUsable, weekVerdicts,
  type HourlyLedger, type WeekVerdicts,
} from "@/lib/business-labor-hourly-shared";
import type { DailyRaw } from "@/lib/sales-reports-shared";

const D = "2026-10-08"; // a Thursday
const WD = "2026-10-04", WP = "2026-09-27";
const FP = "f".repeat(32);
const gen = (week_start: string, extra: Partial<LaborWeekGenerationRow> = {}): LaborWeekGenerationRow =>
  ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-10-08T05:00:00.000Z", source_fingerprint: FP, ...extra });

function sales(from: string, to: string): DailyRaw {
  const dates: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  return {
    classes: dates.map((d) => ({ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
      gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 })),
    tips: [], discounts: [], refunds: [], captured_days: dates,
    ezcater: dates.map((d) => ({ business_date: d, orders: 1, subtotal_cents: 2_000, amount_missing: 0 })),
  } as unknown as DailyRaw;
}
function cost(days: number, extra: Partial<LaborCostRow> = {}): LaborCostRow {
  return { week_start: WP, location_id: "loc", hourly_straight_cents: 900 * days, ot_premium_cents: 0, salaried_cents: 4_000, salary_basis: "wages",
    burden_pct: 12, burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 30 * days, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed",
    range_days: days, days_covered: days, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0,
    salaried_people: 1, salary_unplaced_people: 0, salary_missing_wage_people: 0, days_planned: 0, salary_projected: false, ot_planned: false, ...extra };
}
const cov = (over: Partial<Record<string, Partial<LaborWeekGenerationRow> | null>> = {}) =>
  [WP, WD].flatMap((w) => (over[w] === null ? [] : [gen(w, over[w] ?? {})]));

/** A ledger where everything answered and both weeks are ready and unmoved. */
function full(o: { dayCost?: (d: string) => LaborCostRow | null; structures?: StructureRow[] } = {}): HourlyLedger<StructureRow> {
  const l = emptyHourlyLedger<StructureRow>(D);
  const { days } = hourlyFrame(D);
  l.coverageBefore1 = cov();
  l.sales = [sales(WP, D)];
  l.structures = o.structures ?? [];
  for (const d of days) l.dayCosts.set(d, o.dayCost ? o.dayCost(d) : cost(1));
  l.coverageAfter1 = cov();
  l.fingerprints1 = new Map([[WP, FP], [WD, FP]]);
  l.coverageBefore2 = cov();
  l.weekSoFarTo = "2026-10-07";
  l.weekSoFarRow = cost(4, { week_start: WD });
  l.lastFullWeekRow = cost(7);
  l.coverageAfter2 = cov();
  l.fingerprints2 = new Map([[WP, FP], [WD, FP]]);
  return l;
}
const certify = (l: HourlyLedger<StructureRow>) => certifyHourly(l, targetsForWeek);

/** Every key name anywhere in a value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

describe("the usable-week rule (§11.2.2, L6; §13.2.5; Opus P3-3)", () => {
  const state = (s: string): LaborWeekCoverageRow | undefined =>
    s === "ready" ? { ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }
      : s === "rebuilding" ? { ot_scope: "company", builder_version: "labor-v1" }
        : s === "stale_source" ? { ot_scope: "stale_source", builder_version: "stale_source" }
          : s === "moved" ? { ot_scope: "moved_during_read", builder_version: "moved_during_read" } : undefined;
  const STATES = ["ready", "rebuilding", "stale_source", "moved", "absent"] as const;
  const XS = ["same", "moved", "absent"] as const;
  const verdicts = (a: string, b: string, x: string): WeekVerdicts => {
    const m = (s: string) => { const r = state(s); return new Map(r ? [[WD, r]] : []); };
    return { w1: m(a), w2: m(b), x: m(x === "same" ? "ready" : x) };
  };
  it("hand-written: only (ready, ready, unmoved) is usable", () => {
    expect(weekUsable(verdicts("ready", "ready", "same"), WD)).toBe(true);
    expect(weekUsable(verdicts("ready", "ready", "moved"), WD)).toBe(false);
    expect(weekUsable(verdicts("ready", "ready", "absent"), WD)).toBe(false);
    expect(weekUsable(verdicts("ready", "stale_source", "same"), WD)).toBe(false);
    expect(weekUsable(verdicts("stale_source", "ready", "same"), WD)).toBe(false);
    expect(weekUsable(verdicts("rebuilding", "ready", "same"), WD)).toBe(false);
    expect(weekUsable(verdicts("ready", "absent", "same"), WD)).toBe(false);
    expect(weekUsable(verdicts("absent", "absent", "absent"), WD)).toBe(false);
  });
  it("every combination of W1 / W2 / X (75): usable exactly once", () => {
    const usable: string[] = [];
    for (const a of STATES) for (const b of STATES) for (const x of XS) if (weekUsable(verdicts(a, b, x), WD)) usable.push(`${a}/${b}/${x}`);
    expect(usable).toEqual(["ready/ready/same"]);
  });
  it("a bracket whose coverage read is missing certifies nothing", () => {
    expect(weekUsable({ w1: null, w2: verdicts("ready", "ready", "same").w2, x: verdicts("ready", "ready", "same").x }, WD)).toBe(false);
    expect(weekUsable({ ...verdicts("ready", "ready", "same"), x: null }, WD)).toBe(false);
  });
  it("Opus P3-3: a week missing from a coverage read is unbuilt, never usable", () => {
    const l = full();
    l.coverageBefore1 = cov({ [WD]: null }); l.coverageAfter1 = cov({ [WD]: null });
    const v = weekVerdicts(l);
    expect(laborWeekState(v.w1!.get(WD))).toBe("unbuilt");
    expect(weekUsable(v, WD)).toBe(false);
    expect(weekUsable(v, WP)).toBe(true);
  });
  it("a null (or absent) fingerprint is stale_source", () => {
    const l = full();
    l.fingerprints1 = new Map([[WP, FP], [WD, null]]);
    l.fingerprints2 = new Map([[WP, FP]]);
    const v = weekVerdicts(l);
    expect(v.w1!.get(WD)).toEqual({ ot_scope: "stale_source", builder_version: "stale_source" });
    expect(v.w2!.get(WD)).toEqual({ ot_scope: "stale_source", builder_version: "stale_source" });
    expect(weekUsable(v, WP)).toBe(true);
  });
});

describe("chooseLatestFinalDay (bracket 1 only)", () => {
  it("the newest hours-complete day of a ready week", () => {
    expect(chooseLatestFinalDay(full(), targetsForWeek)).toMatchObject({ kind: "day", date: "2026-10-07", week: WD });
  });
  it("a newer day in a rebuilding week is skipped: the previous week's newest day", () => {
    const l = full();
    l.coverageBefore1 = cov({ [WD]: { builder_version: "labor-v2" } }); l.coverageAfter1 = cov({ [WD]: { builder_version: "labor-v2" } });
    expect(chooseLatestFinalDay(l, targetsForWeek)).toMatchObject({ kind: "day", date: "2026-10-03", week: WP });
  });
  it("an incomplete day is skipped (open punch, pending, missing row)", () => {
    for (const bad of [cost(1, { open_punches: 1 }), cost(1, { days_pending: 1 }), null, cost(1, { ot_state: "unbuilt" })]) {
      const l = full({ dayCost: (d) => (d === "2026-10-07" ? bad : cost(1)) });
      expect(chooseLatestFinalDay(l, targetsForWeek)).toMatchObject({ kind: "day", date: "2026-10-06" });
    }
  });
  it("a day whose SALES are unknown is still final (hours complete; the % carries its own reason)", () => {
    const l = full();
    l.sales = [sales(WP, "2026-10-06")]; // 10-07 has no sales row: sales_not_covered
    const c = chooseLatestFinalDay(l, targetsForWeek);
    expect(c).toMatchObject({ kind: "day", date: "2026-10-07" });
    expect(c.kind === "day" && c.labor.state).toBe("sales_not_covered");
  });
  it("none of the seven → none", () => {
    expect(chooseLatestFinalDay(full({ dayCost: () => cost(1, { open_punches: 1 }) }), targetsForWeek)).toEqual({ kind: "none" });
  });
  it("Opus R-1: both bracket-1 fingerprints null → updating, never none", () => {
    const l = full();
    l.fingerprints1 = new Map([[WP, null], [WD, null]]);
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "updating" });
    const f = certify(l);
    expect(f.latestFinalDay).toEqual({ kind: "updating" });
    expect(f.roleStep).toBeNull();
    // Absent from the map is the same as null (stale_source).
    l.fingerprints1 = new Map();
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "updating" });
  });
  it("Opus R-1: previous week ready with no hours-complete day and the current week stale → updating", () => {
    const l = full({ dayCost: () => cost(1, { open_punches: 1 }) });
    l.fingerprints1 = new Map([[WP, FP], [WD, null]]);
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "updating" });
    const f = certify(l);
    expect(f.latestFinalDay).toEqual({ kind: "updating" });
    expect(f.weekSoFar).toEqual({ kind: "updating" }); // D's week is not usable: its own rule
    // The current week ready, the previous week rebuilding in bracket 1: also updating.
    const m = full({ dayCost: () => cost(1, { open_punches: 1 }) });
    m.coverageBefore1 = cov({ [WP]: { builder_version: "labor-v2" } }); m.coverageAfter1 = cov({ [WP]: { builder_version: "labor-v2" } });
    expect(chooseLatestFinalDay(m, targetsForWeek)).toEqual({ kind: "updating" });
    // D's week usable and no final day in it: week so far keeps its own answer.
    expect(certify(m).weekSoFar).toEqual({ kind: "no_final_day_this_week" });
  });
  it("Opus R-1: both weeks ready and no hours-complete day → none", () => {
    const l = full({ dayCost: () => cost(1, { days_pending: 1 }) });
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "none" });
    expect(certify(l).latestFinalDay).toEqual({ kind: "none" });
  });
  it("Opus R-1: a Sunday D (one week in the window) ready with no final day → none; that week stale → updating", () => {
    const l = full({ dayCost: () => cost(1, { days_pending: 1 }) });
    (l as { day: string }).day = WD;
    for (const d of hourlyFrame(WD).days) l.dayCosts.set(d, cost(1, { days_pending: 1 }));
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "none" });
    l.fingerprints1 = new Map([[WD, FP]]); // WP (the only week of the window) did not answer
    expect(chooseLatestFinalDay(l, targetsForWeek)).toEqual({ kind: "updating" });
  });
  it("Opus R-1: a ready previous week with a final day and a stale current week → still that day (unchanged)", () => {
    const l = full();
    l.fingerprints1 = new Map([[WP, FP], [WD, null]]);
    expect(chooseLatestFinalDay(l, targetsForWeek)).toMatchObject({ kind: "day", date: "2026-10-03", week: WP });
  });
  it("ONE missing day cost → cannot choose (unavailable), never an older day", () => {
    for (const missing of ["2026-10-07", "2026-10-04", "2026-10-01"]) {
      const l = full();
      l.dayCosts.delete(missing);
      expect(chooseLatestFinalDay(l, targetsForWeek), missing).toEqual({ kind: "unavailable" });
    }
  });
  it("bracket 1 without its sales, structures or either coverage read → unavailable", () => {
    for (const drop of ["sales", "structures", "coverageBefore1", "coverageAfter1"] as const) {
      const l = full();
      delete l[drop];
      expect(chooseLatestFinalDay(l, targetsForWeek), drop).toEqual({ kind: "unavailable" });
    }
  });
});

describe("each line's own state", () => {
  it("all ready: three ok spans, the role step from the day row and bracket 2's generation", () => {
    const f = certify(full({ dayCost: (d) => cost(1, { estimated_rate_minutes: d === "2026-10-07" ? 5 : 0 }) }));
    expect(f.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-07", to: "2026-10-07", target: 18, loadedTarget: 28, labor: { state: "ok", pureHourlyCents: 900 } } });
    expect(f.weekSoFar).toMatchObject({ kind: "ok", span: { from: WD, to: "2026-10-07", labor: { state: "ok", pureHourlyCents: 3_600 } } });
    expect(f.lastFullWeek).toMatchObject({ kind: "ok", span: { from: WP, to: "2026-10-03", labor: { state: "ok", pureHourlyCents: 6_300 } } });
    expect(f.roleStep).toEqual({ date: "2026-10-07", weekStart: WD, generation: gen(WD), dayStraightCents: 900, wageEstimated: true });
  });
  it("latest final day in the previous week with a ready current week → no_final_day_this_week", () => {
    const f = certify(full({ dayCost: (d) => (d >= WD ? cost(1, { open_punches: 1 }) : cost(1)) }));
    expect(f.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(f.weekSoFar).toEqual({ kind: "no_final_day_this_week" });
    expect(f.lastFullWeek.kind).toBe("ok");
  });
  it("no final day in seven: F1 none; F2 no_final_day_this_week (D's week usable); F3 stands", () => {
    const f = certify(full({ dayCost: () => cost(1, { days_pending: 1 }) }));
    expect(f.latestFinalDay).toEqual({ kind: "none" });
    expect(f.weekSoFar).toEqual({ kind: "no_final_day_this_week" });
    expect(f.lastFullWeek.kind).toBe("ok");
    expect(f.roleStep).toBeNull();
  });
  it("an incomplete day inside an otherwise ready week-so-far span → ok with the pricer's hours_unknown, while F1 stands", () => {
    const l = full();
    l.weekSoFarRow = cost(4, { week_start: WD, days_incomplete: 1 });
    const f = certify(l);
    expect(f.weekSoFar).toMatchObject({ kind: "ok", span: { labor: { state: "hours_unknown", pct: null, tone: "none" } } });
    expect(f.latestFinalDay).toMatchObject({ kind: "ok", span: { labor: { state: "ok" } } });
  });
  it("GLM part 2 F3: a day straight-cents that is not a finite, non-negative integer → no role step (never a NaN)", () => {
    for (const bad of [Number.NaN, "abc" as unknown as number, -1, 1.5, Number.POSITIVE_INFINITY]) {
      const f = certify(full({ dayCost: (d) => cost(1, d === "2026-10-07" ? { hourly_straight_cents: bad } : {}) }));
      expect(f.roleStep, String(bad)).toBeNull();
      expect(f.latestFinalDay, String(bad)).toMatchObject({ kind: "ok", span: { to: "2026-10-07" } });
      expect(JSON.stringify(f)).not.toMatch(/NaN/);
    }
    // A numeric string is a number (PostgREST may hand bigint as a string): the role step stands.
    expect(certify(full({ dayCost: () => cost(1, { hourly_straight_cents: "900" as unknown as number }) })).roleStep).toMatchObject({ dayStraightCents: 900 });
  });
  it("a moved generation between the brackets → that week's parts updating (F1 not re-chosen), the other week's stand", () => {
    const l = full();
    l.coverageBefore2 = cov({ [WD]: { built_at: "2026-10-08T06:00:00.000Z" } });
    l.coverageAfter2 = cov({ [WD]: { built_at: "2026-10-08T06:00:00.000Z" } });
    const f = certify(l);
    expect(f.latestFinalDay).toEqual({ kind: "updating" });
    expect(f.weekSoFar).toEqual({ kind: "updating" });
    expect(f.lastFullWeek.kind).toBe("ok");
    expect(f.roleStep).toBeNull();
  });
  it("a second fingerprint that differs with identical coverage rows → updating; the other week stands", () => {
    const l = full();
    l.fingerprints2 = new Map([[WP, FP], [WD, "e".repeat(32)]]);
    const f = certify(l);
    expect([f.latestFinalDay, f.weekSoFar]).toEqual([{ kind: "updating" }, { kind: "updating" }]);
    expect(f.lastFullWeek.kind).toBe("ok");
  });
  it("a second fingerprint missing → updating; the other week stands", () => {
    const l = full();
    l.fingerprints2 = new Map([[WP, FP]]);
    const f = certify(l);
    expect([f.latestFinalDay, f.weekSoFar]).toEqual([{ kind: "updating" }, { kind: "updating" }]);
    expect(f.lastFullWeek.kind).toBe("ok");
  });
  it("the previous week moved: F3 updating; a latest final day in the current week stands", () => {
    const l = full();
    l.fingerprints2 = new Map([[WD, FP]]);
    const f = certify(l);
    expect(f.lastFullWeek).toEqual({ kind: "updating" });
    expect(f.latestFinalDay.kind).toBe("ok");
    expect(f.weekSoFar.kind).toBe("ok");
  });
  it("Opus N2: structures not in the ledger → lastFullWeek unavailable and NO default target anywhere in the facts", () => {
    const l = full();
    delete l.structures;
    const f = certify(l);
    expect(f).toEqual({ day: D, latestFinalDay: { kind: "unavailable" }, weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" }, roleStep: null });
    expect([...keysDeep(f)].filter((k) => /target/i.test(k))).toEqual([]);
  });
  it("Opus N2: sales not in the ledger → lastFullWeek unavailable", () => {
    const l = full();
    delete l.sales;
    expect(certify(l).lastFullWeek).toEqual({ kind: "unavailable" });
  });
  it("a structures read that FINISHED with no row is the report's default (18 / 28)", () => {
    expect(certify(full({ structures: [] })).lastFullWeek).toMatchObject({ kind: "ok", span: { target: 18, loadedTarget: 28 } });
  });
  it("a span not accepted → its part unavailable; F1 and F3 stand", () => {
    const l = full();
    delete l.weekSoFarRow;
    const f = certify(l);
    expect(f.weekSoFar).toEqual({ kind: "unavailable" });
    expect([f.latestFinalDay.kind, f.lastFullWeek.kind]).toEqual(["ok", "ok"]);
    const m = full();
    delete m.lastFullWeekRow;
    expect(certify(m).lastFullWeek).toEqual({ kind: "unavailable" });
  });
  it("a week-so-far row asked for another day than the one chosen is never used", () => {
    const l = full();
    l.weekSoFarTo = "2026-10-06";
    expect(certify(l).weekSoFar).toEqual({ kind: "unavailable" });
  });
  it("a coverage read of bracket 2 missing → every figure withheld (unavailable)", () => {
    for (const drop of ["coverageBefore2", "coverageAfter2"] as const) {
      const l = full();
      delete l[drop];
      const f = certify(l);
      expect([f.latestFinalDay, f.weekSoFar, f.lastFullWeek], drop).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }, { kind: "unavailable" }]);
      expect(f.roleStep).toBeNull();
    }
  });
  it("a coverage-AFTER read of bracket 1 missing → every figure withheld", () => {
    const l = full();
    delete l.coverageAfter1;
    const f = certify(l);
    expect([f.latestFinalDay, f.weekSoFar, f.lastFullWeek]).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }, { kind: "unavailable" }]);
  });
  it("an EMPTY ledger → every part unavailable, never a 0", () => {
    const f = certify(emptyHourlyLedger<StructureRow>(D));
    expect(f).toEqual({ day: D, latestFinalDay: { kind: "unavailable" }, weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" }, roleStep: null });
    expect(JSON.stringify(f)).not.toMatch(/\d+(?=[,}])/);
  });
  it("a non-default target on both bases names the week's own targets", () => {
    const total: StructureRow = { structure: { labor: { targetPct: 30, basis: "total", hourlyTargetPct: 20 } }, created_at: "2026-01-01T00:00:00.000Z" };
    expect(certify(full({ structures: [total] })).lastFullWeek).toMatchObject({ kind: "ok", span: { target: 20, loadedTarget: 30 } });
    const hourly: StructureRow = { structure: { labor: { targetPct: 15, basis: "hourly" } }, created_at: "2026-01-01T00:00:00.000Z" };
    expect(certify(full({ structures: [hourly] })).latestFinalDay).toMatchObject({ kind: "ok", span: { target: 15, loadedTarget: 28 } });
  });
  it("a Sunday D: the seven days are all in the previous week; D's week so far is empty", () => {
    const l = full();
    (l as { day: string }).day = WD;
    for (const d of hourlyFrame(WD).days) l.dayCosts.set(d, cost(1));
    const f = certify(l);
    expect(hourlyFrame(WD).days.every((d) => d < WD)).toBe(true);
    expect(f.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(f.weekSoFar).toEqual({ kind: "no_final_day_this_week" });
  });
});

describe("the role step's gate (§11.2.3)", () => {
  const step = { date: "2026-10-07", weekStart: WD, generation: gen(WD), dayStraightCents: 900, wageEstimated: false };
  const people = [{ personKey: "p1", roleKey: "11", source: "7shifts", payClass: "hourly", straightCents: 900 }];
  const ok = { coverageBefore: [gen(WD)], coverageAfter: [gen(WD)], fingerprint: FP, people, roleNames: new Map([["11", "Line"]]) };
  it("ready in its own bracket and unmoved since bracket 2 → certified", () => {
    expect(certifyRoleLedger(ok, step)).toMatchObject({ kind: "certified", people });
  });
  it("a generation moved since bracket 2 → unavailable", () => {
    const moved = gen(WD, { built_at: "2026-10-08T07:00:00.000Z" });
    expect(certifyRoleLedger({ ...ok, coverageBefore: [moved], coverageAfter: [moved] }, step)).toEqual({ kind: "unavailable" });
  });
  it("a fingerprint missing or different, a coverage read missing, the people or the names missing → unavailable", () => {
    for (const l of [{ ...ok, fingerprint: undefined }, { ...ok, fingerprint: "x" }, { ...ok, coverageAfter: undefined }, { ...ok, coverageBefore: undefined },
      { ...ok, people: undefined }, { ...ok, roleNames: undefined }, { ...ok, coverageAfter: [] }]) {
      expect(certifyRoleLedger(l, step)).toEqual({ kind: "unavailable" });
    }
  });
  it("canonicalRoleKey: 0 / null = no role; ids canonical; anything else refused", () => {
    expect([0, "0", null, undefined, "000"].map(canonicalRoleKey)).toEqual([null, null, null, null, null]);
    expect([11, "11", "0011", BigInt("9007199254740993")].map(canonicalRoleKey)).toEqual(["11", "11", "11", "9007199254740993"]);
    expect([-1, 1.5, "x", "", {}, "1e3"].map(canonicalRoleKey)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
