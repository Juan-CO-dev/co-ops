// Item 9 PR 9a: the business report's authorized READ boundary (lib/business-report.ts). Failing-first.
// Every refusal happens BEFORE any I/O (switch off = 503, below GM / SMM / other shop = 403, zero calls).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { BusinessReportError, loadBusinessReport, BUSINESS_REPORT_DTO_PATHS } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { summarizeSales } from "@/lib/sales-reports-shared";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TODAY = "2026-10-08";
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const gm = { userId: "u-gm", level: 7, role: "gm" as const, locations: [A] };
const agm = { userId: "u-agm", level: 6, role: "agm" as const, locations: [A] };
const smm = { userId: "u-smm", level: 6, role: "social_media_mgr" as const, locations: [A] };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };

type Call = { fn: string; args: Record<string, unknown> };
function fakeClient(o: { weeks?: Array<{ week_start: string; ot_scope: string; builder_version: string }>; facts?: string[]; failCuts?: boolean } = {}) {
  const calls: Call[] = [];
  const tables: string[] = [];
  const day = (d: string) => ({ classes: [{ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [d], ezcater: [{ business_date: d, orders: 1, subtotal_cents: 2_000, amount_missing: 0 }] });
  const dates = (from: string, to: string) => {
    const out: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const from = String(args.p_from), to = String(args.p_to);
      let data: unknown = null;
      if (fn === "sales_report_daily") {
        const raws = dates(from, to).map(day);
        data = { classes: raws.flatMap((r) => r.classes), tips: [], discounts: [], refunds: [], captured_days: dates(from, to), ezcater: raws.flatMap((r) => r.ezcater) };
      } else if (fn === "business_report_check_cuts") {
        if (o.failCuts) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "x" } });
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
      return Promise.resolve({ data, error: null });
    },
    from: (table: string) => {
      tables.push(table);
      const rows = table === "labor_week_coverage" ? (o.weeks ?? [{ week_start: "2026-09-27", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }])
        : table === "fact_day_coverage" ? (o.facts ?? dates("2026-08-01", "2026-10-07")).map((d) => ({ business_date: d, state: "covered" }))
        : table === "schedule_structures" ? [] : [];
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gte", "lte", "lt", "in", "order", "range", "abortSignal", "limit"]) q[k] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return q;
    },
  };
  return { client: client as never, calls, tables };
}

beforeEach(() => vi.clearAllMocks());
const range = resolveBusinessRange({}, TODAY);

describe("refusals run before any I/O", () => {
  it("switch off (any of the three) = 503 business_report_unavailable, zero calls", async () => {
    for (const env of [{}, { ...ON, BUSINESS_REPORT: "0" }, { ...ON, FACT_LAYER: undefined }, { ...ON, FACT_LAYER_LABOR: "" }]) {
      const f = fakeClient();
      await expect(loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env })).rejects.toMatchObject({ status: 503, code: "business_report_unavailable" });
      expect(f.calls).toHaveLength(0);
      expect(f.tables).toHaveLength(0);
    }
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("AGM and SMM see NOTHING (403), and a GM at another shop is 403; zero calls", async () => {
    for (const [viewer, loc] of [[agm, A], [smm, A], [gm, B]] as const) {
      const f = fakeClient();
      const err = await loadBusinessReport(viewer, { locationId: loc, range }, { client: f.client, env: ON }).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessReportError);
      expect(err.status).toBe(403);
      expect(f.calls).toHaveLength(0);
      expect(f.tables).toHaveLength(0);
    }
  });
  it("'all' and junk are not a shop (400)", async () => {
    const f = fakeClient();
    await expect(loadBusinessReport(moo, { locationId: "all", range }, { client: f.client, env: ON })).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
  it("a missing 0341 read is 503 business_reads_not_installed, never an empty report", async () => {
    const f = fakeClient({ failCuts: true });
    await expect(loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON })).rejects.toMatchObject({ status: 503, code: "business_reads_not_installed" });
  });
});

describe("the report a GM and a MoO get", () => {
  it("GM own shop: hours per person and sales per server, NO person cost; day % uses Toast net + ezCater", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.access).toEqual({ personCost: false });
    expect(dto.people[0]).toEqual({ personKey: "u:11111111-1111-4111-8111-111111111111", label: "Ana", source: "7shifts", payClass: "hourly", minutes: 600, otMinutes: 0, weeksSuppressed: 0 });
    expect(JSON.stringify(dto)).not.toMatch(/straight_cents|costCents|rate/);
    // Each day: $30 Toast + $20 ezCater = $50 net; labor $9 => 18%.
    expect(dto.days[0]!.labor).toMatchObject({ pureHourlyCents: 900, pct: 18, state: "ok", denominator: { cents: 5_000, state: "ok" } });
    expect(dto.servers.find((s) => s.key === "srv-1")).toMatchObject({ label: "Ana", cents: 1_000 });
  });
  it("MoO: the same plus straight-time cost per person (one named constant decides)", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.access).toEqual({ personCost: true });
    expect(dto.people[0]).toMatchObject({ straightCostCents: 18_000 });
  });
  it("serialized payload paths are an allowlist per role (an unknown path fails)", async () => {
    const paths = (v: unknown, prefix = ""): string[] => v === null || typeof v !== "object" ? [prefix]
      : Array.isArray(v) ? v.flatMap((x) => paths(x, `${prefix}[]`)) : Object.entries(v).flatMap(([k, x]) => paths(x, prefix ? `${prefix}.${k}` : k));
    for (const viewer of [gm, moo]) {
      const dto = await loadBusinessReport(viewer, { locationId: A, range }, { client: fakeClient().client, env: ON });
      const allowed = new Set(BUSINESS_REPORT_DTO_PATHS[viewer.role === "gm" ? "shop_money" : "person_money"]);
      const unknown = [...new Set(paths(dto))].filter((p) => !allowed.has(p.replace(/\[\]/g, "[]")));
      expect(unknown).toEqual([]);
    }
    expect(BUSINESS_REPORT_DTO_PATHS.shop_money).not.toContain("people[].straightCostCents");
    expect(BUSINESS_REPORT_DTO_PATHS.person_money).toContain("people[].straightCostCents");
  });
  it("company-scope (labor-v1) weeks are suppressed as 'rebuilding'", async () => {
    const f = fakeClient({ weeks: [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1" }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    const old = dto.days.find((d) => d.date === "2026-10-03")!;
    expect(old.labor).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null });
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
    expect(dto.people[0]).toMatchObject({ weeksSuppressed: 1 });
    expect(dto.people[0]!.straightCostCents).toBeNull();
    expect(dto.total.labor).toMatchObject({ pct: null, state: "rebuilding" });
  });
  it("day money is the Sales report's own (parity with summarizeSales over sales_report_daily)", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    const daily = await (f.client as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: never }> })
      .rpc("sales_report_daily", { p_location_id: A, p_from: range.from, p_to: range.to });
    const buckets = summarizeSales([daily.data], range.from, range.to, "day").buckets;
    expect(dto.days.map((d) => [d.date, d.sales.totalCents, d.sales.toastNetCents])).toEqual(buckets.map((b) => [b.from, b.totalCents, b.toastNetCents]));
    expect(dto.days.every((d) => d.cuts === "ok")).toBe(true);
  });
  it("92 days = three <=31-day windows per read; quarters are returned only for ranges <= 31 days", async () => {
    const wide = resolveBusinessRange({ range: "last90" }, TODAY);
    const f = fakeClient();
    const dto = await loadBusinessReport(moo, { locationId: A, range: wide }, { client: f.client, env: ON });
    const windows = f.calls.filter((c) => c.fn === "sales_report_daily");
    expect(windows).toHaveLength(3);
    for (const w of f.calls.filter((c) => c.fn !== "fact_labor_cost")) {
      expect(Date.parse(String(w.args.p_to)) - Date.parse(String(w.args.p_from))).toBeLessThanOrEqual(30 * 86_400_000);
    }
    expect(dto.quarters).toBeNull();
    expect(dto.quartersReason).toBe("range_too_wide");
    const narrow = await loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
    expect(narrow.quarters?.length).toBeGreaterThan(0);
    expect(narrow.quarters![0]).toMatchObject({ basis: "toast_only_straight_time", pct: 90 });
  });
});
