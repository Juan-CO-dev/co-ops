// Business report access: ONE mathematically consistent report for the payload and export proofs
// (tests/business-report-gm-payload.test.ts, tests/business-report-export-access.test.ts).
//
// It is fixture F1 of the pay model (tests/helpers/pay-inference-model.ts) priced at PAYS[1], as ONE business day:
//   two hourly people (45 h with 5 h overtime at $24/h; 40 h at $18/h) and one salaried person ($1,000.00);
//   straight time $1,800.00 = 108,000 + 72,000 (per person) = 105,000 + 75,000 (per 15 minutes);
//   overtime premium $60.00; hourly $1,860.00; burden 12% of (1,860 + 1,000) = $343.20; fully loaded $3,203.20;
//   net sales $10,000.00 (Toast $7,500.00 in two checks + ezCater $2,500.00): hourly 18.6%, fully loaded 32%.
// Every money figure is a different number, so a hidden one can be searched for in a payload or a file.
import { A, fakeClient, type FakeOpts } from "./business-report-fake";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";

export const DAY = "2026-10-05";
export const WEEK = "2026-10-04";
export const TODAY = "2026-10-08";
export const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
export const gm = { userId: "u-gm", level: 7, role: "gm" as const, locations: [A] };
export const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
export const owner = { userId: "u-owner", level: 9, role: "owner" as const, locations: [] as string[] };
export const cgs = { userId: "u-cgs", level: 10, role: "cgs" as const, locations: [] as string[] };
export const RANGE = resolveBusinessRange({ range: "custom", from: DAY, to: DAY }, TODAY);

/** The figures of the day, in cents (the model's terms). `scale` prices another period (Compare's earlier one). */
export function figuresOf(scale = 1) {
  const straight = 180_000 * scale, premium = 6_000 * scale, salaried = 100_000 * scale;
  const hourly = straight + premium, burden = Math.round(0.12 * (hourly + salaried));
  return { straight, premium, hourly, salaried, burden, loaded: hourly + salaried + burden, people: [108_000 * scale, 72_000 * scale], quarters: [105_000 * scale, 75_000 * scale],
    toast: 750_000, ezcater: 250_000, net: 1_000_000 };
}

/** The fake client priced as above for `days` (default: DAY at scale 1). Any other date has no sales, cuts or labor. */
export function pricedFake(o: FakeOpts = {}, days: Record<string, number> = { [DAY]: 1 }) {
  const within = (args: Record<string, unknown>) => Object.keys(days).filter((d) => d >= String(args.p_from) && d <= String(args.p_to));
  return fakeClient({
    facts: Object.keys(days),
    weeks: [...new Set(Object.keys(days).map(weekOf))].map((week_start) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION })),
    ...o,
    rpcRows: {
      sales_report_daily: (args) => {
        const ds = within(args);
        return { classes: ds.map((d) => ({ business_date: d, sale_class: "sale", checks: 2, amount_cents: 750_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
          gross_cents: 750_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 })),
          tips: [], discounts: [], refunds: [], captured_days: ds, ezcater: ds.map((d) => ({ business_date: d, orders: 1, subtotal_cents: 250_000, amount_missing: 0 })) };
      },
      business_report_check_cuts: (args) => within(args).flatMap((d) => [
        { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
          server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 450_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
        { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
          server_guid: "srv-2", server_label: "Ben", sale_class: "sale", checks: 1, amount_cents: 300_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
      ]),
      business_report_labor_quarters: (args) => within(args).flatMap((d) => { const f = figuresOf(days[d]); return [
        { business_date: d, week_start: null, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, minutes: 3_000, hourly_minutes: 3_000, salaried_minutes: 0,
          straight_cents: f.quarters[0], estimated_minutes: 0 },
        { business_date: d, week_start: null, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, minutes: 2_100, hourly_minutes: 2_100, salaried_minutes: 0,
          straight_cents: f.quarters[1], estimated_minutes: 0 },
      ]; }),
      business_report_labor_people: (args) => within(args).flatMap((d) => { const f = figuresOf(days[d]); const person = (n: number, label: string, pay: string, minutes: number, ot: number, cents: number | null) =>
        ({ week_start: weekOf(d), person_key: `u:${String(n).repeat(8)}-1111-4111-8111-111111111111`, user_id: null, person_label: label, role_key: 0, source: "7shifts", pay_class: pay,
          minutes, ot_minutes: ot, straight_cents: cents });
      return [person(1, "Ana", "hourly", 2_700, 300, f.people[0]!), person(2, "Ben", "hourly", 2_400, 0, f.people[1]!), person(3, "Cy", "salaried", 2_400, 0, null)]; }),
      fact_labor_cost: (args) => {
        const ds = within(args);
        if (ds.length === 0) return [];
        const f = figuresOf(days[ds[0]!]);
        return [{ week_start: weekOf(ds[0]!), location_id: A, hourly_straight_cents: f.straight, ot_premium_cents: f.premium, salaried_cents: f.salaried, salary_basis: "wages",
          burden_pct: 12, burden_basis: "payroll", estimated_rate_minutes: 0, hourly_minutes: 5_100, ot_minutes: 300, salaried_minutes: 2_400, ot_state: "assessed",
          range_days: 1, days_covered: 1, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 }];
      },
      ...o.rpcRows,
    },
  });
}
function weekOf(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}

/** Every leaf of a JSON value with its path (`x[]` = each element of x). */
export function leaves(v: unknown, prefix = ""): Array<{ path: string; value: unknown }> {
  if (v === null || typeof v !== "object") return [{ path: prefix, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => leaves(x, `${prefix}[]`));
  return Object.entries(v).flatMap(([k, x]) => leaves(x, prefix ? `${prefix}.${k}` : k));
}
export const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
