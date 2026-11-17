/** Item 2 PR 2b: the parity probe's pure half. Rebuilds the `classes` and `refunds` arrays of
 * sales_report_daily (0239 shape, 0247 refund set) from the facts' READ helpers (0337
 * fact_sales_check_classes / fact_sales_refund_rows, which classify through sales_report_class), so the
 * probe can prove the facts carry the same money. This is the probe's comparator, not a report path. */
import { etYmdMinusDays } from "@/lib/operational-day";

export interface FactCheckClassRow {
  business_date: string; order_guid: string; check_guid: string; sale_class: string;
  amount_cents: number | null; tax_cents: number | null; gross_cents: number | null; discounts_comps_cents: number | null;
  voids_cents: number | null; service_charges_cents: number | null; pre_refund_cents: number | null;
}
export interface FactRefundReadRow {
  order_business_date: string; refund_business_date: string | null;
  refund_cents: number | null; refund_tip_cents: number | null; sales_refund_cents: number | null;
}
type Obj = Record<string, unknown>;
export interface DailyMoney { classes: Obj[]; refunds: Obj[] }

const n = (v: unknown): number | null => v === null || v === undefined ? null : Number(v);
const sum = (vals: (number | null)[]) => vals.reduce<number>((a, v) => a + (v ?? 0), 0);
const sumOrNull = (vals: (number | null)[]) => vals.some((v) => v === null) ? null : sum(vals);

export function factDaily(checks: FactCheckClassRow[], refunds: FactRefundReadRow[], from: string, to: string): DailyMoney {
  const groups = new Map<string, FactCheckClassRow[]>();
  for (const c of checks) {
    const key = `${c.business_date}|${c.sale_class}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const classes = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, rows]) => {
    const [business_date, sale_class] = key.split("|");
    const col = (k: keyof FactCheckClassRow) => rows.map((r) => n(r[k]));
    return {
      business_date, sale_class, checks: rows.length,
      amount_cents: sum(col("amount_cents")), tax_cents: sum(col("tax_cents")),
      gross_cents: sumOrNull(col("gross_cents")), discounts_comps_cents: sumOrNull(col("discounts_comps_cents")),
      voids_cents: sumOrNull(col("voids_cents")), service_charges_cents: sumOrNull(col("service_charges_cents")),
      accounting_missing: rows.filter((r) => [r.gross_cents, r.discounts_comps_cents, r.voids_cents, r.service_charges_cents, r.pre_refund_cents]
        .some((v) => v === null)).length,
      amount_missing: rows.filter((r) => r.amount_cents === null).length,
      tax_missing: rows.filter((r) => r.tax_cents === null).length,
    };
  });
  const out: Obj[] = [];
  const dated = new Map<string, FactRefundReadRow[]>();
  for (const r of refunds) {
    if (r.refund_business_date && r.refund_business_date >= from && r.refund_business_date <= to) {
      dated.set(r.refund_business_date, [...(dated.get(r.refund_business_date) ?? []), r]);
    }
  }
  for (const [day, rows] of dated) {
    const sales = rows.map((r) => n(r.sales_refund_cents));
    out.push({ business_date: day, count: rows.length, refund_cents: sum(rows.map((r) => n(r.refund_cents))),
      refund_tip_cents: sum(rows.map((r) => n(r.refund_tip_cents))), sales_refund_cents: sumOrNull(sales),
      sales_refund_missing: sales.filter((v) => v === null).length });
  }
  // 0239: an undated refund is uncertainty on every report day on/after greatest(order day, from).
  const undated = refunds.filter((r) => r.refund_business_date === null && r.order_business_date <= to);
  for (let day = from; day <= to; day = etYmdMinusDays(day, -1)) {
    const missing = undated.filter((r) => (r.order_business_date > from ? r.order_business_date : from) <= day).length;
    if (missing > 0) out.push({ business_date: day, count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: missing });
  }
  return { classes, refunds: out.sort(byCanonical) };
}

const TEXT_KEYS = new Set(["business_date", "sale_class"]);
/** PostgREST may render a bigint sum as a string; money and counts compare as numbers. */
const value = (k: string, v: unknown) => v === null || v === undefined ? null : TEXT_KEYS.has(k) ? String(v) : Number(v);
const canonical = (o: Obj) => JSON.stringify(Object.keys(o).sort().map((k) => [k, value(k, o[k])]));
const byCanonical = (a: Obj, b: Obj) => { const x = canonical(a), y = canonical(b); return x < y ? -1 : x > y ? 1 : 0; };

/** Differences between the report and the facts, as readable lines. Empty = parity. */
export function compareDaily(report: Partial<DailyMoney>, facts: DailyMoney): string[] {
  const diffs: string[] = [];
  for (const key of ["classes", "refunds"] as const) {
    const a = (report[key] ?? []).map(canonical).sort(), b = facts[key].map(canonical).sort();
    const onlyReport = a.filter((x) => !b.includes(x)), onlyFacts = b.filter((x) => !a.includes(x));
    for (const x of onlyReport) diffs.push(`${key} report-only ${x}`);
    for (const x of onlyFacts) diffs.push(`${key} facts-only ${x}`);
  }
  return diffs;
}

export function summarizeStale(rows: { day_location_id: string; day_business_date: string }[]) {
  const byShopMonth: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.day_location_id} ${r.day_business_date.slice(0, 7)}`;
    byShopMonth[key] = (byShopMonth[key] ?? 0) + 1;
  }
  return { total: rows.length, byShopMonth };
}
