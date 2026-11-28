/**
 * Digests round 3, PR 4: hand-built LABOR-MONEY facts for the composers' tests. Synthetic only (shops "Shop A" /
 * "Shop B", made-up ids, roles "Line" / "Prep"). The figures are REAL: every `LaborFigures` is made by the business
 * report's own pricer (`laborDayFigures` / `laborRangeFigures`) over small inputs, so a test sees exactly the states,
 * reasons and qualifications the report would produce.
 *
 * Day D = 2026-10-07 (Wed; tests/fixtures/digest-staffing.ts). D's payroll week = Sun 2026-10-04 … Sat 10-10. The
 * latest final day = Tue 2026-10-06; the week so far = Oct 4 → Oct 6; the last full payroll week = Sep 27 → Oct 3.
 */
import { businessAccessFor, type BusinessAccess, type GmVisibility } from "@/lib/business-access-shared";
import { daySalesFrom, laborDayFigures, laborRangeFigures, type LaborFigures } from "@/lib/business-report-shared";
import type { LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { digestAccessFor, type DigestAccess, type DigestDelivery } from "@/lib/report-digests-access-shared";
import type { HourlyLaborFacts, LaborMoneyStore, LaborTarget, RoleBucket, RoleLaborFacts, SpanPart } from "@/lib/report-digests-labor-shared";
import type { LinkViewer } from "@/lib/report-digests-links";
import type { DailyRaw } from "@/lib/sales-reports-shared";
import type { RoleCode } from "@/lib/roles";
import { A, D } from "./digest-staffing";

export const LATEST = "2026-10-06";
export const WEEK_START = "2026-10-04";
export const LAST_FROM = "2026-09-27";
export const LAST_TO = "2026-10-03";
/** The last finished day at send time (the closing digest of D goes out after D: D is not finished). */
export const FINISHED_THROUGH = LATEST;

const READY = { ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION };

/** One day of sales_report_daily: $1,000.00 of Toast net by default (10 checks), captured. */
export function dailyRaw(date: string, o: { toast?: number; captured?: boolean } = {}): DailyRaw {
  const toast = o.toast ?? 100_000;
  return {
    classes: [{ business_date: date, sale_class: "sale", checks: 10, amount_cents: toast, tax_cents: 0, amount_missing: 0, tax_missing: 0,
      gross_cents: toast, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: o.captured === false ? [] : [date], ezcater: [],
  };
}
const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** One fact_labor_cost row ($180.00 straight, 10 h by default; no salary unless given). */
export function costRow(week: string, o: Partial<LaborCostRow> = {}): LaborCostRow {
  return { week_start: week, location_id: A, hourly_straight_cents: 18_000, ot_premium_cents: 0, salaried_cents: null, salary_basis: "unknown",
    burden_pct: 12, burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 600, ot_minutes: 0, salaried_minutes: 0,
    ot_state: "assessed", range_days: 1, days_covered: 1, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0,
    salaried_people: 0, salary_unplaced_people: 0, salary_missing_wage_people: 0, ...o };
}
/** A salary (wages) so fully loaded prices: $50.00 of salaries, burden at the 12% estimate. */
export const SALARIED: Partial<LaborCostRow> = { salaried_cents: 5_000, salary_basis: "wages", salaried_people: 1 };

/** The latest final day's figures through the report's own day pricer. */
export function dayFigures(o: Partial<LaborCostRow> = {}, sales: { toast?: number; captured?: boolean } = {}, target: LaborTarget = 18, loadedTarget: LaborTarget = 28): LaborFigures {
  const day = daySalesFrom([dailyRaw(LATEST, sales)], LATEST, LATEST)[0]!;
  return laborDayFigures(day, costRow(WEEK_START, { ...SALARIED, ...o }), READY, target, loadedTarget);
}
/** A span's figures (several days, one row per payroll week) through the report's own range pricer. */
export function rangeFigures(from: string, to: string, o: Partial<LaborCostRow> = {}, target: LaborTarget = 18, loadedTarget: LaborTarget = 28): LaborFigures {
  const days = eachDay(from, to);
  const sales = daySalesFrom(days.map((d) => dailyRaw(d)), from, to);
  const week = from >= WEEK_START ? WEEK_START : LAST_FROM;
  const row = costRow(week, { ...SALARIED, range_days: days.length, days_covered: days.length, hourly_straight_cents: 18_000 * days.length,
    hourly_minutes: 600 * days.length, salaried_cents: 5_000 * days.length, ...o });
  return laborRangeFigures(sales, [row], new Map([[week, READY]]), { hourly: target, loaded: loadedTarget });
}

export const ok = (from: string, to: string, labor: LaborFigures, target: LaborTarget = 18, loadedTarget: LaborTarget = 28): SpanPart =>
  ({ kind: "ok", span: { from, to, labor, target, loadedTarget } });
export const UNAVAILABLE: SpanPart = { kind: "unavailable" };
export const UPDATING: SpanPart = { kind: "updating" };

/** A healthy run: every part ok, every figure under target. */
export function hourlyFacts(over: Partial<HourlyLaborFacts> = {}): HourlyLaborFacts {
  return {
    day: D,
    latestFinalDay: ok(LATEST, LATEST, dayFigures()),
    weekSoFar: ok(WEEK_START, LATEST, rangeFigures(WEEK_START, LATEST)),
    lastFullWeek: ok(LAST_FROM, LAST_TO, rangeFigures(LAST_FROM, LAST_TO)),
    roleStep: { date: LATEST, weekStart: WEEK_START, generation: { week_start: WEEK_START, ...READY }, dayStraightCents: 18_000, wageEstimated: false },
    ...over,
  };
}
/** F1 over target ($250.00 straight on $1,000.00 = 25% against 18%: `watch`). */
export const overTargetDay = () => ok(LATEST, LATEST, dayFigures({ hourly_straight_cents: 25_000 }));

export const bucket = (kind: RoleBucket["kind"], name: string | null, cents: number): RoleBucket => ({ kind, name, cents });
export function roleFacts(over: Partial<Extract<RoleLaborFacts, { kind: "ok" }>> = {}): RoleLaborFacts {
  return { kind: "ok", date: LATEST, buckets: [bucket("role", "Line", 9_000), bucket("role", "Prep", 6_000), bucket("other", null, 2_000), bucket("pool", null, 1_000)],
    roundedSeparately: false, wageEstimated: false, ...over };
}

/** A sealed store: one entry per shop (every shop gets the same facts unless `byShop` says otherwise), for day D. */
export function laborStore(hourly: HourlyLaborFacts | null, roles: RoleLaborFacts | null, byShop: Record<string, { hourly?: HourlyLaborFacts | null; roles?: RoleLaborFacts | null }> = {}): LaborMoneyStore {
  return {
    hourly: (loc, day) => (day !== D ? null : loc in byShop && byShop[loc]!.hourly !== undefined ? byShop[loc]!.hourly! : hourly),
    roles: (loc, day) => (day !== D ? null : loc in byShop && byShop[loc]!.roles !== undefined ? byShop[loc]!.roles! : roles),
  };
}

/**
 * A recipient as the engine builds them: the link viewer (with `business` when the run decided one) and the data
 * access. `business` = the labor-money access (null = none); `enabled` = the three report switches.
 */
export function recipient(role: string, memberships: readonly string[], digest: DigestDelivery | null, business: BusinessAccess | null,
  o: { enabled?: boolean; finishedThrough?: string } = {}): { viewer: LinkViewer; access: DigestAccess | null } {
  const level = { owner: 9, cgs: 9, moo: 8, gm: 7 }[role] ?? 6;
  const viewer: LinkViewer = { role, level, locations: [...memberships],
    ...(business ? { business: { access: business, finishedThrough: o.finishedThrough ?? FINISHED_THROUGH, enabled: o.enabled ?? true } } : {}) };
  return { viewer, access: digestAccessFor(viewer, digest, business) };
}
/** The business access of a role (a GM: `settings`, null = the defaults). */
export const businessOf = (role: RoleCode, settings: GmVisibility | null = null) => businessAccessFor(role, settings);
