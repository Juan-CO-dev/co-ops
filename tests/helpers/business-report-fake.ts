// Item 9: the fake PostgREST client the business-report tests share (loader, export). Extracted from
// tests/business-report-loader.test.ts unchanged.
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";

export const A = "aaaaaaaa-0000-4000-8000-00000000000a";

type Call = { fn: string; args: Record<string, unknown> };
export type FakeOpts = {
  weeks?: Array<{ week_start: string; ot_scope: string; builder_version: string }>; facts?: string[]; failCuts?: boolean;
  /** Replace an RPC's rows (per call args). */
  rpcRows?: Record<string, (args: Record<string, unknown>) => unknown>;
  /** PostgREST's max-rows (default 1,000): any response, ranged or not, is cut to this many rows. */
  maxRows?: number;
  /** Lie about the exact count (simulates a short page the server swears is not the end). */
  countBias?: number;
  /** Fix round 3: a rebuild COMMITS the moment the first fact_labor_cost read is answered; coverage reads
   *  answer a macrotask later and see these rows from then on (the cost reads already saw the old generation). */
  weeksAfterRebuild?: Array<{ week_start: string; ot_scope: string; builder_version: string; built_at?: string; source_fingerprint?: string }>;
};
export function fakeClient(o: FakeOpts = {}) {
  const calls: Call[] = [];
  const tables: string[] = [];
  let rebuilt = false;
  const day = (d: string) => ({ classes: [{ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [d], ezcater: [{ business_date: d, orders: 1, subtotal_cents: 2_000, amount_missing: 0 }] });
  const dates = (from: string, to: string) => {
    const out: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const client = {
    rpc: (fn: string, args: Record<string, unknown>, opts?: { count?: string }) => {
      calls.push({ fn, args });
      let lo = 0, hi = Number.POSITIVE_INFINITY;
      const answer = () => {
        const r = produce(fn, args) as { data: unknown; error: unknown };
        if (fn === "fact_labor_cost") rebuilt = true;
        if (r.error || !Array.isArray(r.data)) return r;
        const all = r.data as unknown[];
        const cap = o.maxRows ?? 1_000;
        const page = all.slice(lo, Math.min(hi + 1, lo + cap));
        return { data: page, error: null, count: opts?.count === "exact" ? all.length + (o.countBias ?? 0) : null };
      };
      const b = {
        range: (a: number, z: number) => { lo = a; hi = z; return b; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej),
      };
      return b;
    },
  };
  function produce(fn: string, args: Record<string, unknown>): { data: unknown; error: unknown } {
    {
      const from = String(args.p_from), to = String(args.p_to);
      let data: unknown = null;
      if (o.rpcRows?.[fn]) return { data: o.rpcRows[fn]!(args), error: null };
      if (fn === "sales_report_daily") {
        const raws = dates(from, to).map(day);
        data = { classes: raws.flatMap((r) => r.classes), tips: [], discounts: [], refunds: [], captured_days: dates(from, to), ezcater: raws.flatMap((r) => r.ezcater) };
      } else if (fn === "business_report_check_cuts") {
        if (o.failCuts) return { data: null, error: { code: "PGRST202", message: "x" } };
        data = dates(from, to).flatMap((d) => [
          { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
            server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
          { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
            server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: "2000", amount_missing: 0, large_checks: 0, large_cents: 0 },
        ]);
      } else if (fn === "business_report_labor_quarters") {
        data = dates(from, to).map((d) => ({ business_date: d, week_start: null, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0,
          minutes: 30, hourly_minutes: 30, salaried_minutes: 0, straight_cents: 900, estimated_minutes: 0 }));
      } else if (fn === "business_report_labor_people") {
        data = [{ week_start: "2026-09-27", person_key: "u:11111111-1111-4111-8111-111111111111", user_id: "11111111-1111-4111-8111-111111111111",
          person_label: "Ana", role_key: 0, source: "7shifts", pay_class: "hourly", minutes: 600, ot_minutes: 0, straight_cents: 18_000 }];
      } else if (fn === "fact_labor_cost") {
        data = [{ week_start: "2026-09-27", location_id: A, hourly_straight_cents: 900, ot_premium_cents: 0, salaried_cents: null, salary_basis: "unknown",
          burden_pct: 12, burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 30, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed",
          range_days: dates(from, to).length, days_covered: dates(from, to).length, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 }];
      }
      return { data, error: null };
    }
  }
  Object.assign(client, {
    from: (table: string) => {
      tables.push(table);
      const coverage = () => (rebuilt && o.weeksAfterRebuild ? o.weeksAfterRebuild : null);
      const rowsNow = () => table === "labor_week_coverage" ? (coverage() ?? o.weeks ?? [{ week_start: "2026-09-27", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }])
        : table === "fact_day_coverage" ? (o.facts ?? dates("2026-08-01", "2026-10-07")).map((d) => ({ business_date: d, state: "covered" }))
        : table === "schedule_structures" ? [] : [];
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gte", "lte", "lt", "in", "order", "range", "abortSignal", "limit"]) q[k] = () => q;
      let lo = 0, hi = Number.POSITIVE_INFINITY;
      q.range = (a: number, z: number) => { lo = a; hi = z; return q; };
      q.then = (res: (v: unknown) => unknown) => {
        const answer = () => { const rows = rowsNow(); return { data: rows.slice(lo, Math.min(hi + 1, lo + (o.maxRows ?? 1_000))), error: null, count: rows.length }; };
        // A coverage read answers a macrotask later (read at answer time), so the interleaving is real.
        return (table === "labor_week_coverage" && o.weeksAfterRebuild ? new Promise((r) => setTimeout(() => r(answer()), 0)) : Promise.resolve(answer())).then(res);
      };
      return q;
    },
  });
  return { client: client as never, calls, tables };
}
