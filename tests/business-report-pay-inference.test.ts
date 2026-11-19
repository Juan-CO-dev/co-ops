// Business report access, plan r5: THE MODEL CHECK of what the grouping of the switches protects.
//
// DOMAIN (this is a design check, not a proof about every report): the relations of tests/helpers/pay-inference-model.ts
// (H1-H3, I1-I5), the fixtures F1-F5 at three pay vectors, one rate per hourly person, and a viewer who knows every
// visible term exactly plus net sales, the burden rate and everyone's minutes.
//
// THE TWO STATEMENTS (contract point 2):
//   2a  hourly_cost OFF  =>  no pay input (no rate, no salaried share) can be worked out;
//   2b  loaded OFF       =>  no salaried share can be worked out.
// NOT PROMISED (point 3): a hidden FIGURE may be computable from visible ones (a $0 premium when nobody worked
// overtime; burden = hourly cost x the rate setting when nobody is salaried). Each such case is asserted BY NAME below.
// THE RESIDUAL (point 4): with hourly labor dollars ON, rates can be worked out. Asserted, so nobody reads this file
// as a claim that they cannot.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { businessAccessFor, gmVisibilityCombinations, LABOR_BASE_KEYS, LABOR_HOURLY_KEYS, LABOR_LOADED_KEYS } from "@/lib/business-access-shared";
import { loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { A, fakeClient } from "./helpers/business-report-fake";
import {
  F1, F2, F3, F4, F5, FIGURE_TERMS, FIXTURES, PAYS, TERM_GROUP, determined, div, eq, evaluate, isPayInput, isWhole, isZero, mul, num, personStraight, q,
  relations, visibleTerms, type Fixture, type Pay, type Q,
} from "./helpers/pay-inference-model";

const HOURLY_OFF = { hourlyCost: false, loaded: false }, LOADED_OFF = { hourlyCost: true, loaded: false }, ALL_ON = { hourlyCost: true, loaded: true };
/** What breaks statement 2a or 2b when a viewer of `groups` sees `visible`. */
function violations(f: Fixture, pay: Pay, groups: { hourlyCost: boolean; loaded: boolean }, visible: ReadonlySet<string>, extra: Parameters<typeof determined>[3] = []): string[] {
  const found = [...determined(f, pay, visible, extra).keys()];
  return [
    ...(groups.hourlyCost ? [] : found.filter(isPayInput).map((t) => `2a: ${t} worked out with hourly cost off`)),
    ...(groups.loaded ? [] : found.filter((t) => t.startsWith("share[")).map((t) => `2b: ${t} worked out with fully loaded off`)),
  ];
}
const names = (m: Map<string, Q>) => [...m.keys()].sort();

describe("(a) the model describes the fixtures", () => {
  it("every relation holds exactly, at every pay vector, and every figure is whole cents", () => {
    for (const f of FIXTURES) for (const pay of PAYS) {
      const v = evaluate(f, pay);
      for (const r of relations(f)) {
        const total = Object.entries(r.terms).reduce((s, [t, c]) => s + num(mul(c, v[t]!)), 0);
        expect(Math.abs(total), `${f.name}: ${r.name}`).toBeLessThan(1e-6);
      }
      for (const t of ["straight", "premium", "hourly", "salaries", "burden", "loaded"]) expect(isWhole(v[t]!), `${f.name}: ${t}`).toBe(true);
      expect(f.burdenPct).toBeGreaterThan(0);
      expect(f.netCents).toBeGreaterThan(0);
    }
  });
  it("F2 is the reviewer's counterexample: hourly $2,375, premium $125, and premium x 19 = hourly at ANY pay", () => {
    const v = evaluate(F2, PAYS[0]!);
    expect([num(v.hourly!), num(v.premium!)]).toEqual([237_500, 12_500]);
    for (const pay of PAYS) { const x = evaluate(F2, pay); expect(eq(mul(q(19), x.premium!), x.hourly!)).toBe(true); }
  });
});

describe("(b) the two statements, for every coherent combination of the switches", () => {
  it("2a and 2b hold on F1-F5 at every pay vector", () => {
    const states = new Map(gmVisibilityCombinations().map((s) => { const a = businessAccessFor("gm", s); return [`${a.hourlyCost}|${a.loaded}`, { hourlyCost: a.hourlyCost, loaded: a.loaded }]; }));
    expect([...states.keys()].sort()).toEqual(["false|false", "true|false", "true|true"]);
    for (const groups of states.values()) for (const f of FIXTURES) for (const pay of PAYS) {
      expect(violations(f, pay, groups, visibleTerms(groups)), `${f.name} ${JSON.stringify(groups)}`).toEqual([]);
    }
  });
});

describe("(c) contract point 3: hidden figures that CAN be computed, by name (none of them reveals a pay input)", () => {
  it("F3 (no overtime), hourly cost off: the premium is known to be $0, and nothing else of that group", () => {
    for (const pay of PAYS) {
      const d = determined(F3, pay, visibleTerms(HOURLY_OFF));
      expect(names(d)).toEqual(["premium"]);
      expect(isZero(d.get("premium")!)).toBe(true);
    }
  });
  it("F4 (no hours, nobody salaried), hourly cost off: every figure is known to be 0; there is no pay input at all", () => {
    for (const pay of PAYS) {
      const d = determined(F4, pay, visibleTerms(HOURLY_OFF));
      expect(names(d)).toEqual([...FIGURE_TERMS].sort());
      expect([...d.values()].every(isZero)).toBe(true);
    }
  });
  it("F2 and F5 (nobody salaried), hourly on and fully loaded off: salaries $0, and burden / fully loaded follow from the visible hourly total", () => {
    for (const f of [F2, F5]) for (const pay of PAYS) {
      const v = evaluate(f, pay), d = determined(f, pay, visibleTerms(LOADED_OFF));
      expect(names(d).filter((t) => TERM_GROUP[t as keyof typeof TERM_GROUP] === "loaded")).toEqual(["burden", "loaded", "loadedPct", "salaries"]);
      expect(isZero(d.get("salaries")!)).toBe(true);
      expect(eq(d.get("burden")!, mul(q(f.burdenPct, 100), v.hourly!))).toBe(true);
      expect(eq(d.get("loaded")!, mul(q(100 + f.burdenPct, 100), v.hourly!))).toBe(true);
      expect(eq(d.get("loadedPct")!, div(mul(q(100), d.get("loaded")!), q(f.netCents)))).toBe(true);
    }
  });
  it("F1 and F3 (someone salaried), hourly on and fully loaded off: NONE of salaries, burden, fully loaded, loaded % can be computed", () => {
    for (const f of [F1, F3]) for (const pay of PAYS) {
      const d = determined(f, pay, visibleTerms(LOADED_OFF));
      for (const t of ["salaries", "burden", "loaded", "loadedPct", "share[0]"]) expect(d.has(t), `${f.name}: ${t}`).toBe(false);
    }
  });
  it("F1, F2, F5 (people worked), hourly cost off: no figure of the hourly group can be computed", () => {
    for (const f of [F1, F2, F5]) for (const pay of PAYS) {
      const d = determined(f, pay, visibleTerms(HOURLY_OFF));
      for (const t of ["hourly", "premium", "pct", "straight"]) expect(d.has(t), `${f.name}: ${t}`).toBe(false);
    }
  });
});

describe("(d) the checker goes RED on a wrong grouping (negative controls)", () => {
  it("plan r2's grouping (premium hidden beside a visible hourly total) on F2: the premium IS worked out, through the hours", () => {
    for (const pay of PAYS) {
      const d = determined(F2, pay, new Set(["hourly", "pct"]));
      expect(d.has("premium")).toBe(true);
      expect(eq(d.get("premium")!, evaluate(F2, pay).premium!)).toBe(true);
    }
  });
  it("the premium shown while hourly cost is off, on F5: the person's rate is worked out (2a fails)", () => {
    expect(violations(F5, PAYS[0]!, HOURLY_OFF, new Set(["premium"]))).toEqual(["2a: rate[0] worked out with hourly cost off"]);
  });
  it("salaries shown while fully loaded is off, on F1: the salaried share is worked out (2b fails)", () => {
    expect(violations(F1, PAYS[0]!, LOADED_OFF, new Set(["hourly", "premium", "pct", "salaries"]))).toEqual(["2b: share[0] worked out with fully loaded off"]);
  });
  it("one person's straight-time cost shown while hourly cost is off, on F1: that person's rate is worked out (2a fails)", () => {
    const probe = personStraight(F1, 0);
    expect(violations(F1, PAYS[0]!, HOURLY_OFF, new Set([probe.term]), [probe])).toEqual(["2a: rate[0] worked out with hourly cost off"]);
  });
});

describe("(e) contract point 4, the residual: with hourly labor dollars ON, rates can be worked out", () => {
  it("F5 (one person): their rate. F1 (two people, different overtime ratios): both rates", () => {
    for (const pay of PAYS) {
      for (const groups of [LOADED_OFF, ALL_ON]) {
        expect(eq(determined(F5, pay, visibleTerms(groups)).get("rate[0]")!, pay.rates[0]!)).toBe(true);
        const d = determined(F1, pay, visibleTerms(groups));
        expect([eq(d.get("rate[0]")!, pay.rates[0]!), eq(d.get("rate[1]")!, pay.rates[1]!)]).toEqual([true, true]);
      }
    }
  });
  it("and with everything on at a shop with one salaried person, that person's share (the salaried total IS the share)", () => {
    expect(eq(determined(F1, PAYS[0]!, visibleTerms(ALL_ON)).get("share[0]")!, PAYS[0]!.shares[0]!)).toBe(true);
  });
});

// ── (f) Model to serialized: the DTO's own arithmetic, through the REAL loader ──────────────────
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const DAY = "2026-10-05";
const round1 = (x: number) => Math.round(x * 10) / 10;
/** One day whose labor row is `row` and whose net sales are exactly `netCents` (Toast gross + ezCater). */
function priced(row: { straight: number; premium: number; salaried: number; minutes: number; ot: number }, netCents: number) {
  const toast = netCents - 200_000;
  return fakeClient({ rpcRows: {
    sales_report_daily: () => ({ classes: [{ business_date: DAY, sale_class: "sale", checks: 2, amount_cents: toast, tax_cents: 0, amount_missing: 0, tax_missing: 0,
      gross_cents: toast, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
      tips: [], discounts: [], refunds: [], captured_days: [DAY], ezcater: [{ business_date: DAY, orders: 1, subtotal_cents: 200_000, amount_missing: 0 }] }),
    fact_labor_cost: () => [{ week_start: "2026-10-04", location_id: A, hourly_straight_cents: row.straight, ot_premium_cents: row.premium, salaried_cents: row.salaried,
      salary_basis: "wages", burden_pct: 12, burden_basis: "payroll", estimated_rate_minutes: 0, hourly_minutes: row.minutes, ot_minutes: row.ot, salaried_minutes: 0,
      ot_state: "assessed", range_days: 1, days_covered: 1, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 }],
  } });
}
const load = async (f: ReturnType<typeof priced>) =>
  (await loadBusinessReport(moo, { locationId: A, range: resolveBusinessRange({ range: "custom", from: DAY, to: DAY }, "2026-10-08") }, { client: f.client, env: ON })).total.labor;

describe("(f) model to serialized: integer cents, per-row rounded burden, percentages of the DTO's own cents", () => {
  it("F1 priced: the DTO's cents and minutes ARE the model's terms; loaded = its own three parts; % = round1 of its own cents", async () => {
    const v = evaluate(F1, PAYS[1]!);
    const l = await load(priced({ straight: num(v.straight!), premium: num(v.premium!), salaried: num(v.salaries!), minutes: 85 * 60, ot: 5 * 60 }, F1.netCents));
    expect(l).toMatchObject({ state: "ok", pureHourlyCents: num(v.hourly!), otPremiumCents: num(v.premium!), salariedCents: num(v.salaries!), minutes: 85 * 60, otMinutes: 5 * 60 });
    expect(l.denominator.cents).toBe(F1.netCents);
    expect(Math.abs(l.burdenCents! - num(v.burden!))).toBeLessThanOrEqual(0.5); // one priced row
    expect(l.fullyLoadedCents).toBe(l.pureHourlyCents! + l.salariedCents! + l.burdenCents!);
    expect(l.pct).toBe(round1((100 * l.pureHourlyCents!) / l.denominator.cents!));
    expect(l.loadedPct).toBe(round1((100 * l.fullyLoadedCents!) / l.denominator.cents!));
  });
  it("NONZERO burden rounding: 101 cents at 12% is 12 in the DTO (12.12 in the model), and fully loaded is the DTO's 113, not 113.12", async () => {
    const l = await load(priced({ straight: 101, premium: 0, salaried: 0, minutes: 60, ot: 0 }, 1_000_000));
    expect([l.burdenCents, l.fullyLoadedCents]).toEqual([12, 113]);
    expect(Math.abs(l.burdenCents! - 0.12 * 101)).toBeLessThanOrEqual(0.5);
    expect(l.fullyLoadedCents).toBe(l.pureHourlyCents! + l.salariedCents! + l.burdenCents!);
  });
  it("a % is one decimal of percent, not a fraction: 237,500 over 1,000,000 is 23.8", async () => {
    const v = evaluate(F2, PAYS[0]!);
    const l = await load(priced({ straight: num(v.straight!), premium: num(v.premium!), salaried: 0, minutes: 90 * 60, ot: 10 * 60 }, 1_000_000));
    expect([l.pureHourlyCents, l.pct]).toEqual([237_500, 23.8]);
    expect([l.burdenCents, l.fullyLoadedCents, l.loadedPct]).toEqual([28_500, 266_000, 26.6]);
  });
});

describe("(g) every labor key of the report is placed", () => {
  it("each key of the labor figures is a term of the model, or a declared non-figure, and in exactly one access list", async () => {
    const l = await load(priced({ straight: 101, premium: 0, salaried: 0, minutes: 60, ot: 0 }, 1_000_000));
    const TERM_OF: Record<string, string> = { pureHourlyCents: "hourly", otPremiumCents: "premium", pct: "pct", salariedCents: "salaries", burdenCents: "burden",
      fullyLoadedCents: "loaded", loadedPct: "loadedPct" };
    /** Not a money figure: states, flags, tones, hours and net sales (known constants of the model). */
    const NON_FIGURES = ["state", "minutes", "otMinutes", "denominator", "hoursUnverified", "tone", "wageEstimated", "loadedState", "loadedTone", "burdenEstimated",
      "salaryEstimated", "salaryGaps"];
    const placed = [...LABOR_BASE_KEYS, ...LABOR_HOURLY_KEYS, ...LABOR_LOADED_KEYS].filter((k) => !k.includes("."));
    expect(Object.keys(l).sort()).toEqual([...placed].sort());
    for (const k of Object.keys(l)) expect(k in TERM_OF || NON_FIGURES.includes(k), k).toBe(true);
    for (const [key, term] of Object.entries(TERM_OF)) {
      const group = TERM_GROUP[term as keyof typeof TERM_GROUP];
      expect((group === "hourlyCost" ? LABOR_HOURLY_KEYS : LABOR_LOADED_KEYS) as readonly string[], key).toContain(key);
    }
  });
});
