/** Item 2 PR 2c: THE two-view labor pricer, pure (labor plan r6 §3 P0, P2 #3). SQL (0338
 * fact_labor_cost) returns per (week, shop) only COMPONENTS and flags; the views, percentages, targets
 * and tones are worked out here, in one tested place. Juan 2026-11-16:
 *   pure_hourly  = hourly straight time + overtime premium                      (target 18%)
 *   fully_loaded = pure_hourly + salaried fixed cost + burden (taxes/benefits)  (target <= 28%)
 *   burden       = burden % x (pure_hourly + salaried), per shop, its own % (12% default = `estimated`)
 * Null rules: an unknown salary makes fully_loaded (and its burden) null and leaves pure_hourly valid;
 * unknown sales make every % null. Never one blended stored number. */
import type { RoleCode } from "@/lib/roles";
import { laborTone, type LaborTone } from "@/lib/scheduling/board-shared";
import { LABOR_TARGET_HOURLY_PCT, LABOR_TARGET_LOADED_PCT } from "./labor-config-shared";

export interface LaborCostRow {
  week_start: string; location_id: string;
  hourly_straight_cents: number; ot_premium_cents: number;
  salaried_cents: number | null; salary_basis: "estimate" | "wages" | "unknown";
  burden_pct: number; burden_basis: "estimated" | "payroll";
  /** hourly minutes priced at the shop estimate (no wage, or Q5 = dc_minimum) */
  estimated_rate_minutes: number;
  hourly_minutes: number; ot_minutes: number; salaried_minutes: number;
  ot_state: "assessed" | "lower_bound" | "week_open" | "unbuilt";
  range_days: number;
  days_covered: number; days_pending: number; days_fallback: number; days_incomplete: number; days_missing: number;
}
export interface LaborWeekView {
  weekStart: string;
  hourlyStraightCents: number; otPremiumCents: number; pureHourlyCents: number;
  salariedCents: number | null; burdenCents: number | null; fullyLoadedCents: number | null;
  salaryUnknown: boolean; burdenEstimated: boolean; rateEstimated: boolean;
  otState: LaborCostRow["ot_state"]; coverageComplete: boolean;
}

/** A fact_labor_cost row as returned by PostgREST or pg: bigint / numeric may arrive as strings, dates
 * as Date objects. Never coerces an unknown salary to 0. */
export function toLaborCostRow(r: Record<string, unknown>): LaborCostRow {
  const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const n = (v: unknown) => Number(v);
  return {
    week_start: ymd(r.week_start), location_id: String(r.location_id), hourly_straight_cents: n(r.hourly_straight_cents), ot_premium_cents: n(r.ot_premium_cents),
    salaried_cents: r.salaried_cents === null || r.salaried_cents === undefined ? null : n(r.salaried_cents),
    salary_basis: r.salary_basis as LaborCostRow["salary_basis"], burden_pct: n(r.burden_pct), burden_basis: r.burden_basis as LaborCostRow["burden_basis"],
    estimated_rate_minutes: n(r.estimated_rate_minutes), hourly_minutes: n(r.hourly_minutes), ot_minutes: n(r.ot_minutes), salaried_minutes: n(r.salaried_minutes),
    ot_state: r.ot_state as LaborCostRow["ot_state"], range_days: n(r.range_days), days_covered: n(r.days_covered), days_pending: n(r.days_pending),
    days_fallback: n(r.days_fallback), days_incomplete: n(r.days_incomplete), days_missing: n(r.days_missing),
  };
}

const OT_RANK: Record<LaborCostRow["ot_state"], number> = { assessed: 0, lower_bound: 1, week_open: 2, unbuilt: 3 };

/** Rows of one or more shops, summed per week (each shop's burden on its own pay). */
export function laborWeekViews(rows: readonly LaborCostRow[]): LaborWeekView[] {
  const byWeek = new Map<string, LaborCostRow[]>();
  for (const r of rows) (byWeek.get(r.week_start) ?? byWeek.set(r.week_start, []).get(r.week_start)!).push(r);
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([weekStart, rs]) => {
    const straight = rs.reduce((s, r) => s + Number(r.hourly_straight_cents), 0);
    const premium = rs.reduce((s, r) => s + Number(r.ot_premium_cents), 0);
    const salaryUnknown = rs.some((r) => r.salaried_cents === null);
    const salaried = salaryUnknown ? null : rs.reduce((s, r) => s + Number(r.salaried_cents), 0);
    const burden = salaryUnknown ? null : rs.reduce((s, r) =>
      s + Math.round((Number(r.burden_pct) / 100) * (Number(r.hourly_straight_cents) + Number(r.ot_premium_cents) + Number(r.salaried_cents))), 0);
    const pure = straight + premium;
    return {
      weekStart, hourlyStraightCents: straight, otPremiumCents: premium, pureHourlyCents: pure,
      salariedCents: salaried, burdenCents: burden, fullyLoadedCents: salaried === null || burden === null ? null : pure + salaried + burden,
      salaryUnknown, burdenEstimated: rs.some((r) => r.burden_basis === "estimated"), rateEstimated: rs.some((r) => Number(r.estimated_rate_minutes) > 0),
      otState: rs.map((r) => r.ot_state).sort((a, b) => OT_RANK[b] - OT_RANK[a])[0]!,
      coverageComplete: rs.every((r) => r.days_pending + r.days_fallback + r.days_incomplete + r.days_missing === 0),
    };
  });
}

export interface LaborTarget { pct: number; source: "structure" | "default" }
export interface LaborTargets { loaded: LaborTarget; hourly: LaborTarget }
/** The structure in force at the week's start decides which view its targetPct is for (its `basis`). */
export function laborTargetsFor(structure: { labor: { targetPct: number; basis: "hourly" | "total" } } | null): LaborTargets {
  const loaded: LaborTarget = { pct: LABOR_TARGET_LOADED_PCT, source: "default" };
  const hourly: LaborTarget = { pct: LABOR_TARGET_HOURLY_PCT, source: "default" };
  if (!structure) return { loaded, hourly };
  return structure.labor.basis === "total"
    ? { loaded: { pct: structure.labor.targetPct, source: "structure" }, hourly }
    : { loaded, hourly: { pct: structure.labor.targetPct, source: "structure" } };
}
/** A range's targets: one number when every week agrees, else `target_varies` (never an average). */
export function rangeTargets(weeks: readonly LaborTargets[]): { loaded: number | "target_varies"; hourly: number | "target_varies" } {
  const one = (xs: number[]) => (new Set(xs).size === 1 ? xs[0]! : "target_varies" as const);
  return { loaded: one(weeks.map((w) => w.loaded.pct)), hourly: one(weeks.map((w) => w.hourly.pct)) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
export interface LaborPercents { pureHourlyPct: number | null; pureHourlyTone: LaborTone; fullyLoadedPct: number | null; fullyLoadedTone: LaborTone }
export function laborPercents(v: LaborWeekView, netSalesCents: number | null, t: LaborTargets): LaborPercents {
  const pct = (c: number | null) => (c === null || netSalesCents === null || netSalesCents <= 0 ? null : round1((100 * c) / netSalesCents));
  const h = pct(v.pureHourlyCents), f = pct(v.fullyLoadedCents);
  return { pureHourlyPct: h, pureHourlyTone: laborTone(h, t.hourly.pct), fullyLoadedPct: f, fullyLoadedTone: laborTone(f, t.loaded.pct) };
}

/** Juan Q2: the salaried weekly cost spread evenly over the shop's open quarters (for hour readers);
 * the remainder cents go to the earliest quarters so the parts sum exactly. */
export function spreadSalariedOverQuarters(weeklyCents: number, openQuarters: readonly string[]): Map<string, number> {
  const keys = [...new Set(openQuarters)].sort();
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const base = Math.floor(weeklyCents / keys.length);
  let rest = weeklyCents - base * keys.length;
  for (const k of keys) { out.set(k, base + (rest > 0 ? 1 : 0)); if (rest > 0) rest--; }
  return out;
}

/** Who may read what from the labor facts (the reader enforces it before any I/O; the AGM's payload
 * carries nothing money-derivable). GM: both views for their own shops; MoO+: per-person cost. */
export type LaborFactAccess = "none" | "hours_only" | "shop_money" | "person_money";
export function laborFactAccess(role: RoleCode): LaborFactAccess {
  if (role === "moo" || role === "owner" || role === "cgs") return "person_money";
  if (role === "gm") return "shop_money";
  if (role === "agm") return "hours_only";
  return "none";
}
