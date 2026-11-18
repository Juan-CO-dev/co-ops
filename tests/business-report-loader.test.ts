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
type FakeOpts = {
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
function fakeClient(o: FakeOpts = {}) {
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
    expect(dto.servers.find((s) => s.key === "srv-1")).toMatchObject({ label: "Ana", cents: 7_000, checks: 7 });
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
    // Fix round 2, P2: a rebuilding week keeps its quarter HOURS; only the money and the % are withheld.
    const oldQ = dto.quarters!.find((q) => q.date === "2026-10-03" && q.quarterStartAt === "2026-10-03T16:00:00.000Z")!;
    expect(oldQ).toMatchObject({ laborMinutes: 30, straightCents: null, pct: null });
    const newQ = dto.quarters!.find((q) => q.date === "2026-10-04" && q.quarterStartAt === "2026-10-04T16:00:00.000Z")!;
    expect(newQ).toMatchObject({ laborMinutes: 30, straightCents: 900, pct: 90 });
  });
  it("fix round 3: a rebuild that commits DURING the labor reads is 'rebuilding', never old money under the new generation", async () => {
    // The costs/people/quarters were read from the company-scope (labor-v1) build; the per_shop rebuild commits
    // right after. A single coverage read taken alongside would see per_shop and pass the old overtime as ready.
    const old = [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1", built_at: "2026-11-01T00:00:00Z", source_fingerprint: "a".repeat(32) },
      { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) }];
    const fresh = [{ ...old[0]!, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-17T12:00:00Z" }, old[1]!];
    const f = fakeClient({ weeks: old, weeksAfterRebuild: fresh });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null });
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
    expect(dto.people[0]).toMatchObject({ weeksSuppressed: 1, straightCostCents: null });
    expect(dto.total.labor).toMatchObject({ pct: null, state: "rebuilding" });
    expect(dto.quarters!.find((q) => q.date === "2026-10-03" && q.quarterStartAt === "2026-10-03T16:00:00.000Z")).toMatchObject({ laborMinutes: 30, straightCents: null, pct: null });
  });
  it("fix round 3: a same-generation rebuild (new built_at only) during the reads is still 'rebuilding'", async () => {
    const old = [{ week_start: "2026-09-27", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "a".repeat(32) },
      { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) }];
    const f = fakeClient({ weeks: old, weeksAfterRebuild: [{ ...old[0]!, built_at: "2026-11-17T12:00:00Z", source_fingerprint: "c".repeat(32) }, old[1]!] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor.state).toBe("rebuilding");
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
  });
  it("fix round 3: a week built for the first time during the reads is 'rebuilding', not ready", async () => {
    const built = { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) };
    const f = fakeClient({ weeks: [built], weeksAfterRebuild: [{ ...built, week_start: "2026-09-27", source_fingerprint: "a".repeat(32) }, built] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor).toMatchObject({ state: "rebuilding", pct: null });
  });
  it("a rebuilding week's labor-only quarter (no sales) is still listed with its minutes", async () => {
    const f = fakeClient({
      weeks: [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1" }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }],
      rpcRows: { business_report_labor_quarters: (args) => [{ business_date: "2026-10-03", week_start: null, quarter_start_at: "2026-10-03T13:00:00.000Z", wall_quarter: 36, fold: 0,
        minutes: 45, hourly_minutes: 45, salaried_minutes: 0, straight_cents: 1_200, estimated_minutes: 0 }].filter(() => String(args.p_from) <= "2026-10-03" && String(args.p_to) >= "2026-10-03") },
    });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.quarters!.find((q) => q.quarterStartAt === "2026-10-03T13:00:00.000Z")).toMatchObject({ laborMinutes: 45, straightCents: null, pct: null, toastCents: 0 });
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

// Fix round 1, P1: a table-returning RPC is read to completion (paged, exact count) or refused by name —
// never cut at PostgREST's 1,000-row cap.
describe("table-returning reads page to completion (never the 1,000-row cap)", () => {
  const month = resolveBusinessRange({ range: "last30" }, TODAY);
  const weeks = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"]
    .map((w) => ({ week_start: w, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }));
  const dates = (from: string, to: string) => {
    const out: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  // 40 occupied quarters a day x 30 days = 1,200 rows in one window.
  const quarters = (args: Record<string, unknown>) => dates(String(args.p_from), String(args.p_to)).flatMap((d) =>
    Array.from({ length: 40 }, (_, i) => ({ business_date: d, week_start: null, quarter_start_at: new Date(Date.parse(`${d}T12:00:00.000Z`) + i * 900_000).toISOString(),
      wall_quarter: 32 + i, fold: 0, minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 10, estimated_minutes: 0 })));
  // 40 gift-card rows a day ahead of each day's two sale rows: the late days' sales fall past row 1,000 unpaged.
  const cuts = (args: Record<string, unknown>) => dates(String(args.p_from), String(args.p_to)).flatMap((d) => [
    ...Array.from({ length: 40 }, (_, i) => ({ business_date: d, quarter_start_at: `${d}T15:00:00.000Z`, wall_quarter: 44, fold: 0, et_date: d, channel: "gift_card",
      provider: `g${String(i).padStart(2, "0")}`, server_guid: null, server_label: null, sale_class: "gift_card", checks: 1, amount_cents: 500, amount_missing: 0, large_checks: 0, large_cents: 0 })),
    { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
      server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
    { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: 2_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
  ]);
  const people = (args: Record<string, unknown>) => Array.from({ length: 1_300 }, (_, i) => ({ week_start: "2026-09-27",
    person_key: `toast:${String(i).padStart(5, "0")}`, user_id: null, person_label: null, role_key: 0, source: "toast", pay_class: "hourly",
    minutes: args.p_from === month.from ? 1 : 0, ot_minutes: 0, straight_cents: 0 }));

  it("1,200 labor quarters, 1,260 cut rows and 1,300 people in one window all arrive", async () => {
    const f = fakeClient({ weeks, rpcRows: { business_report_labor_quarters: quarters, business_report_check_cuts: cuts, business_report_labor_people: people } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON });
    expect(dto.days.every((d) => d.cuts === "ok")).toBe(true);
    const laborQuarters = dto.quarters!.filter((q) => q.laborMinutes !== null);
    expect(laborQuarters).toHaveLength(30 * 40);
    expect(laborQuarters.reduce((s, q) => s + q.laborMinutes!, 0)).toBe(30 * 40 * 15);
    expect(dto.people).toHaveLength(1_300);
    expect(f.calls.filter((c) => c.fn === "business_report_labor_quarters").length).toBeGreaterThan(1);
  });
  it("a server whose max-rows is below the page still delivers everything (exact count decides the end)", async () => {
    const f = fakeClient({ weeks, maxRows: 300, rpcRows: { business_report_labor_quarters: quarters } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON });
    expect(dto.quarters!.filter((q) => q.laborMinutes !== null)).toHaveLength(30 * 40);
  });
  it("a read that cannot be completed is refused by name, never a partial report", async () => {
    const f = fakeClient({ weeks, countBias: 5, rpcRows: { business_report_labor_quarters: quarters } });
    await expect(loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON }))
      .rejects.toMatchObject({ status: 503, code: "business_reads_incomplete" });
  });
});

// Fix round 1, P2: the quarter denominator is ALL that quarter's Toast check sales, catering channel included;
// only the rush detector leaves catering out. Checks with no opened quarter are an unassigned bucket.
describe("quarter sales include ordinary Toast catering; unassigned is shown", () => {
  const D = "2026-10-07";
  const one = resolveBusinessRange({ range: "yesterday" }, TODAY);
  const daily = () => ({ classes: [{ business_date: D, sale_class: "sale", checks: 3, amount_cents: 52_500, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 52_500, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [D], ezcater: [] });
  const cut = (channel: string, at: string | null, cents: number) => ({ business_date: D, quarter_start_at: at, wall_quarter: at ? 48 : null, fold: at ? 0 : null,
    et_date: at ? D : null, channel, provider: null, server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: cents, amount_missing: 0, large_checks: 0, large_cents: 0 });
  const cuts = (args: Record<string, unknown>) => String(args.p_to) < D ? [] : [
    cut("dine_in", `${D}T16:00:00.000Z`, 10_000), cut("catering", `${D}T16:00:00.000Z`, 40_000), cut("dine_in", null, 2_500)];
  const labor = () => [{ business_date: D, week_start: null, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0,
    minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 5_000, estimated_minutes: 0 }];

  it("$100 ordinary + $400 unlinked Toast catering, $50 straight time = 10%, not 50%", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.days[0]!.cuts).toBe("ok");
    const q = dto.quarters!.find((x) => x.quarterStartAt === `${D}T16:00:00.000Z`)!;
    expect(q).toMatchObject({ toastCents: 50_000, checks: 2, straightCents: 5_000, pct: 10 });
  });
  it("quarters plus the unassigned bucket recompose to the day's Toast check sales", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.quartersUnassigned).toEqual([{ date: D, toastCents: 2_500, checks: 1 }]);
    const sum = dto.quarters!.filter((x) => x.date === D).reduce((s, x) => s + (x.toastCents ?? 0), 0) + dto.quartersUnassigned![0]!.toastCents;
    expect(sum).toBe(dto.days[0]!.sales.toastChecksCents);
  });
});

// Fix round 2, P2: a quarter holding a check of UNKNOWN amount has unknown sales — no labor %, and it never
// takes part in a rush comparison (today or as history). The day still recomposes (the missing counts match).
describe("a quarter with an unknown check amount has no labor %", () => {
  const D = "2026-10-07";
  const one = resolveBusinessRange({ range: "yesterday" }, TODAY);
  const daily = () => ({ classes: [{ business_date: D, sale_class: "sale", checks: 2, amount_cents: 10_000, tax_cents: 0, amount_missing: 1, tax_missing: 0,
    gross_cents: 10_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [D], ezcater: [] });
  const cuts = (args: Record<string, unknown>) => String(args.p_to) < D ? [] : [
    { business_date: D, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: D, channel: "dine_in", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 2, amount_cents: 10_000, amount_missing: 1, large_checks: 0, large_cents: 0 }];
  const labor = () => [{ business_date: D, week_start: null, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0,
    minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 5_000, estimated_minutes: 0 }];

  it("$100 known + one unknown check, $50 straight time = no % (not 50%); the missing count is carried", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.days[0]!.cuts).toBe("ok");
    const q = dto.quarters!.find((x) => x.quarterStartAt === `${D}T16:00:00.000Z`)!;
    expect(q).toMatchObject({ toastCents: 10_000, checks: 2, amountMissing: 1, straightCents: 5_000, pct: null });
  });
});
